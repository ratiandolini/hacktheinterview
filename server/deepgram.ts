import { DeepgramClient } from "@deepgram/sdk";
import type { Session } from "./sessions.js";
import { broadcastToReaders } from "./sessions.js";
import { generateAnswer } from "./llm.js";
import { InterviewerUtteranceBuffer } from "./utterance.js";

const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

// Track active Deepgram connections per session
const activeConnections = new Map<string, any>();
const activeUtteranceBuffers = new Map<string, InterviewerUtteranceBuffer>();

export async function startTranscription(session: Session) {
  if (activeConnections.has(session.id)) return activeConnections.get(session.id);

  if (!process.env.DEEPGRAM_API_KEY) {
    throw new Error("DEEPGRAM_API_KEY is not configured");
  }

  const connection = await deepgram.listen.v1.connect({
    Authorization: "Token " + process.env.DEEPGRAM_API_KEY,
    model: "nova-2",
    language: "en",
    smart_format: "true",
    interim_results: "true",
    utterance_end_ms: 1000,
    vad_events: "true",
    diarize: "true",
    encoding: "linear16",
    sample_rate: 16000,
    channels: 1,
  });

  const utteranceBuffer = new InterviewerUtteranceBuffer((utterance, reason, lastSegmentAt) => {
    const elapsedMs = Date.now() - lastSegmentAt;
    console.log("[Live] Interviewer utterance complete for session " + session.id + " (reason=" + reason + ", elapsedMs=" + elapsedMs + ")");
    console.log("[Live] Final aggregated interviewer turn for session " + session.id + " (characters=" + utterance.length + ")");
    session.transcript.push(utterance);
    broadcastToReaders(session, { type: "transcript_final", text: utterance });
    console.log("[OpenAI] Generating answer once for aggregated turn in session " + session.id);
    void generateAnswer(session, utterance, lastSegmentAt);
  });
  activeUtteranceBuffers.set(session.id, utteranceBuffer);

  connection.on("open", () => {
    console.log("[Deepgram] Connection opened for session " + session.id);
  });

  connection.on("message", (data: any) => {
    if (data.type === "Results") {
      const transcript = data.channel?.alternatives?.[0]?.transcript;
      if (!transcript || transcript.trim() === "") return;

      const isFinal = data.is_final;
      console.log("[Deepgram] Transcript received for session " + session.id + " (final=" + Boolean(isFinal) + ")");

      // Calibration does not enroll a Deepgram speaker ID, so diarization labels cannot
      // safely identify the user. Keep all transcription instead of dropping speaker 0.

      if (isFinal) {
        console.log("[Live] Transcript segment buffered for session " + session.id);
        utteranceBuffer.addFinalSegment(transcript);
      } else {
        broadcastToReaders(session, { type: "transcript_interim", text: transcript });
      }
      return;
    }

    if (data.type === "UtteranceEnd") {
      utteranceBuffer.completeFromUtteranceEnd();
    }
  });

  connection.on("error", (err: Error) => {
    console.error("[Deepgram] Connection error for session " + session.id + ": " + err.message);
    broadcastToReaders(session, { type: "transcription_error", error: "Deepgram transcription failed. Check the server logs and try again." });
  });

  connection.on("close", () => {
    console.log("[Deepgram] Connection closed for session " + session.id);
    activeConnections.delete(session.id);
    activeUtteranceBuffers.get(session.id)?.dispose();
    activeUtteranceBuffers.delete(session.id);
  });

  connection.connect();
  await connection.waitForOpen();
  activeConnections.set(session.id, connection);
  console.log("[Deepgram] Ready for 16 kHz linear16 mono audio for session " + session.id);

  return connection;
}

const audioFrameCounts = new Map<string, number>();

export function sendAudio(session: Session, audioData: Buffer) {
  const connection = activeConnections.get(session.id);
  if (!connection) return;

  const count = (audioFrameCounts.get(session.id) || 0) + 1;
  audioFrameCounts.set(session.id, count);
  if (count === 1 || count % 50 === 0) {
    console.log("[Live] Received audio frame " + count + " for session " + session.id + " (" + audioData.length + " bytes)");
  }
  connection.sendMedia(audioData);
}

export function stopTranscription(session: Session) {
  const connection = activeConnections.get(session.id);
  if (connection) connection.close();
  activeConnections.delete(session.id);
  audioFrameCounts.delete(session.id);
  activeUtteranceBuffers.get(session.id)?.dispose();
  activeUtteranceBuffers.delete(session.id);
}
