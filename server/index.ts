import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { WebSocketServer, WebSocket } from "ws";
import { createSession, getSession, broadcastToAll, type Session } from "./sessions.js";
import { startTranscription, sendAudio, stopTranscription } from "./deepgram.js";
import { getCalibrationReconnectGraceDelay, getDominantSpeakerLabel, resetSpeakerCalibration } from "./speakerCalibration.js";
import { fetchLinkedInProfile } from "./linkedin.js";
import { parseResumeText } from "./resume.js";

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
    resumeText = await parseResumeText(buffer);
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
const listenerReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearListenerReconnectTimer(sessionId: string) {
  const timer = listenerReconnectTimers.get(sessionId);
  if (timer) clearTimeout(timer);
  listenerReconnectTimers.delete(sessionId);
}

function stopSessionSpeechConnection(session: Session) {
  session.isLive = false;
  stopTranscription(session);
  broadcastToAll(session, { type: "live_stopped" });
}

function handleLastListenerDisconnect(session: Session) {
  const graceDelay = getCalibrationReconnectGraceDelay(session);
  if (graceDelay === null) {
    stopSessionSpeechConnection(session);
    return;
  }

  console.log("[Calibration] Retaining the calibrated Deepgram connection for " + graceDelay + "ms while the Listener reconnects for session " + session.id);
  listenerReconnectTimers.set(session.id, setTimeout(() => {
    listenerReconnectTimers.delete(session.id);
    if (session.listeners.size === 0 && session.isCalibrated) stopSessionSpeechConnection(session);
  }, graceDelay));
}

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
    clearListenerReconnectTimer(session.id);
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
          resetSpeakerCalibration(session);
          session.isCalibrating = true;
          console.log("[Calibration] Starting Deepgram calibration for session " + session.id);
          startTranscription(session).then(() => {
            ws.send(JSON.stringify({ type: "calibration_started" }));
          }).catch((err) => {
            const message = err instanceof Error ? err.message : "Unknown error";
            console.error("[Calibration] Failed to start for session " + session.id + ": " + message);
            resetSpeakerCalibration(session);
            broadcastToAll(session, { type: "calibration_error", error: "Calibration could not start. Please try again." });
          });
        } else if (msg.type === "end_calibration") {
          setTimeout(() => {
            if (!session.isCalibrating) return;
            const speakerLabel = getDominantSpeakerLabel(session.calibrationSpeakerCounts);
            if (!speakerLabel) {
              console.warn("[Calibration] No reliable diarization speaker label for session " + session.id);
              resetSpeakerCalibration(session);
              broadcastToAll(session, { type: "calibration_error", error: "We could not identify your voice. Speak continuously during calibration and try again." });
              return;
            }
            session.isCalibrating = false;
            session.isCalibrated = true;
            session.calibratedSpeakerLabel = speakerLabel;
            session.calibratedAt = Date.now();
            session.calibrationSpeakerCounts.clear();
            console.log("[Calibration] Speaker label calibrated for session " + session.id);
            broadcastToAll(session, { type: "calibration_done" });
            broadcastToAll(session, { type: "calibrated" });
          }, 400);
        } else if (msg.type === "start_live") {
          if (!session.isCalibrated || !session.calibratedSpeakerLabel) {
            broadcastToAll(session, { type: "calibration_required", error: "Calibrate your voice before going live." });
            return;
          }
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
        if (session.isLive || session.isCalibrating) {
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
      if (session.listeners.size === 0 && (session.isLive || session.isCalibrated || session.isCalibrating)) {
        handleLastListenerDisconnect(session);
      }
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
