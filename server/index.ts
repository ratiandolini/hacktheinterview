import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { WebSocketServer, WebSocket } from "ws";
import { createSession, getSession, broadcastToAll } from "./sessions.js";
import { startTranscription, sendAudio, stopTranscription } from "./deepgram.js";
import { fetchLinkedInProfile } from "./linkedin.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

const app = new Hono();

// API routes
app.post("/api/session", async (c) => {
  const formData = await c.req.formData();
  const interviewType = (formData.get("interviewType") as string) || "general";
  const customPrompt = (formData.get("customPrompt") as string) || "";
  const resumeFile = formData.get("resume") as File | null;

  const linkedinUrl = (formData.get("linkedinUrl") as string) || "";

  let resumeText = "";
  if (resumeFile) {
    const buffer = Buffer.from(await resumeFile.arrayBuffer());
    try {
      const parsed = await (pdf as any)(buffer);
      resumeText = parsed.text;
    } catch (e) {
      console.error("PDF parse error:", e);
    }
  }

  // Fetch LinkedIn profile if URL provided
  let linkedinText = "";
  if (linkedinUrl) {
    try {
      linkedinText = await fetchLinkedInProfile(linkedinUrl);
    } catch (e: any) {
      console.error("LinkedIn fetch error:", e.message);
    }
  }

  // Combine resume + LinkedIn as context
  const fullResumeText = [resumeText, linkedinText].filter(Boolean).join("\n\n---\n\n");

  const session = createSession({ interviewType, customPrompt, resumeText: fullResumeText });
  return c.json({ sessionId: session.id });
});

app.get("/api/session/:id", (c) => {
  const session = getSession(c.req.param("id"));
  if (!session) return c.json({ error: "Session not found" }, 404);
  return c.json({
    id: session.id,
    interviewType: session.interviewType,
    isCalibrated: session.isCalibrated,
    isLive: session.isLive,
    transcript: session.transcript,
    answers: session.answers,
  });
});

// Serve static files (built client)
app.use("/*", serveStatic({ root: "./client/dist" }));

// SPA fallback
app.get("/*", async (c) => {
  try {
    const fs = await import("fs");
    const html = fs.readFileSync("./client/dist/index.html", "utf-8");
    return c.html(html);
  } catch {
    return c.text("Build the client first: npm run build:client", 404);
  }
});

const PORT = parseInt(process.env.PORT || "3001");

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
});

// WebSocket server on the same HTTP server
const wss = new WebSocketServer({ server: server as any });
const listenerAudioFrameCounts = new Map<string, number>();
const startingLiveSessions = new Set<string>();

wss.on("connection", (ws: WebSocket, req) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const sessionId = url.searchParams.get("sessionId");
  const role = url.searchParams.get("role"); // "listener" or "reader"

  if (!sessionId || !role || !["listener", "reader", "combined"].includes(role)) {
    ws.close(4000, "Missing or invalid sessionId/role");
    return;
  }

  const session = getSession(sessionId);
  if (!session) {
    ws.close(4001, "Session not found");
    return;
  }

  console.log(`[WS] ${role} connected to session ${sessionId}`);

  if (role === "listener" || role === "combined") {
    session.listeners.add(ws);

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        let msg: { type?: string };
        try {
          msg = JSON.parse(data.toString("utf8"));
        } catch {
          ws.send(JSON.stringify({ type: "calibration_error", error: "Invalid control message" }));
          return;
        }

        if (msg.type === "start_calibration") {
          session.isCalibrated = false;
          ws.send(JSON.stringify({ type: "calibration_started" }));
        } else if (msg.type === "end_calibration") {
          session.isCalibrated = true;
          ws.send(JSON.stringify({ type: "calibration_done" }));
          broadcastToAll(session, { type: "calibrated" });
        } else if (msg.type === "start_live") {
          if (session.isLive || startingLiveSessions.has(session.id)) return;
          startingLiveSessions.add(session.id);
          console.log("[Live] Starting Deepgram for session " + session.id);
          startTranscription(session).then(() => {
            session.isLive = true;
            console.log("[Live] Listener went live for session " + session.id);
            broadcastToAll(session, { type: "live_started" });
          }).catch((err) => {
            const message = err instanceof Error ? err.message : "Unknown error";
            console.error("[Deepgram] Failed to start transcription for session " + session.id + ": " + message);
            session.isLive = false;
            broadcastToAll(session, { type: "live_error", error: "Deepgram could not start. Check the server logs and try again." });
          }).finally(() => {
            startingLiveSessions.delete(session.id);
          });
        } else if (msg.type === "stop_live") {
          session.isLive = false;
          stopTranscription(session);
          broadcastToAll(session, { type: "live_stopped" });
        }
      } else {
        // Binary audio data — forward to Deepgram
        if (session.isLive) {
          const audioFrameCount = (listenerAudioFrameCounts.get(session.id) || 0) + 1;
          listenerAudioFrameCounts.set(session.id, audioFrameCount);
          if (audioFrameCount === 1 || audioFrameCount % 50 === 0) {
            console.log("[Live] Browser audio frame " + audioFrameCount + " received for session " + session.id);
          }
          sendAudio(session, data);
        }
      }
    });

    ws.on("close", () => {
      session.listeners.delete(ws);
      listenerAudioFrameCounts.delete(session.id);
      console.log(`[WS] ${role} audio connection disconnected from session ${sessionId}`);
    });
  }

  if (role === "reader" || role === "combined") {
    session.readers.add(ws);

    // Send current state
    ws.send(
      JSON.stringify({
        type: "sync",
        transcript: session.transcript,
        answers: session.answers,
        isLive: session.isLive,
        isCalibrated: session.isCalibrated,
      })
    );

    ws.on("close", () => {
      session.readers.delete(ws);
      console.log(`[WS] ${role} reader connection disconnected from session ${sessionId}`);
    });
  }
});
