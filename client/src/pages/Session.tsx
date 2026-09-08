import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useWebSocket } from "../hooks/useWebSocket.js";
import { useAudioCapture } from "../hooks/useAudioCapture.js";
import { applyAnswerEvent, type AnswerEntry } from "../answerLifecycle.js";

type Phase = "setup" | "calibrating" | "ready" | "live";

interface TranscriptEntry {
  text: string;
  isFinal: boolean;
}


export function Session() {
  const { sessionId, role: roleParam } = useParams<{ sessionId: string; role?: string }>();
  const navigate = useNavigate();
  const routeSessionId = sessionId || "";
  const listenerPath = "/session/" + encodeURIComponent(routeSessionId) + "/listener";
  const readerPath = "/session/" + encodeURIComponent(routeSessionId) + "/reader";
  const combinedPath = "/session/" + encodeURIComponent(routeSessionId) + "/combined";
  const role = roleParam === "listener" || roleParam === "reader" || roleParam === "combined" ? roleParam : null;
  const [phase, setPhase] = useState<Phase>("setup");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [interimText, setInterimText] = useState("");
  const [answers, setAnswers] = useState<AnswerEntry[]>([]);
  const [calibrationTimer, setCalibrationTimer] = useState(10);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const answersEndRef = useRef<HTMLDivElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const ws = useWebSocket(routeSessionId, role);
  const connectionLabel = ws.connected ? "● Connected — Ready" : ws.connectionState === "reconnecting" ? "◌ Reconnecting..." : "◌ Starting server...";
  const connectionColor = ws.connected ? "#4ade80" : "#fbbf24";

  const onAudioData = useCallback(
    (data: ArrayBuffer) => {
      ws.send(data);
    },
    [ws.send]
  );

  const audio = useAudioCapture(onAudioData);

  // Handle incoming WS messages
  useEffect(() => {
    return ws.addHandler((msg) => {
      switch (msg.type) {
        case "sync":
          if (msg.transcript) {
            setTranscript(msg.transcript.map((t: string) => ({ text: t, isFinal: true })));
          }
          if (msg.answers) {
            setAnswers(msg.answers.map((answer: AnswerEntry) => ({ ...answer, done: answer.done })));
          }
          if (msg.isLive && msg.isCalibrated) setPhase("live");
          else if (msg.isCalibrated) setPhase("ready");
          else {
            audio.stop();
            setPhase("setup");
          }
          break;
        case "calibration_started":
          setPhase("calibrating");
          break;
        case "calibration_done":
        case "calibrated":
          setCalibrationError(null);
          setPhase("ready");
          break;
        case "calibration_error":
          audio.stop();
          setCalibrationError(msg.error || "Calibration could not start. Please try again.");
          setPhase("setup");
          break;
        case "calibration_required":
          audio.stop();
          setCalibrationError(msg.error || "Calibrate your voice before going live.");
          setPhase("setup");
          break;
        case "live_started":
          setPhase("live");
          break;
        case "live_error":
        case "transcription_error":
          setCalibrationError(msg.error || "Live transcription failed. Check the server logs and try again.");
          setPhase("ready");
          audio.stop();
          break;
        case "live_stopped":
          audio.stop();
          setPhase("setup");
          break;
        case "transcript_interim":
          setInterimText(msg.text);
          break;
        case "transcript_final":
          setInterimText("");
          setTranscript((prev) => [...prev, { text: msg.text, isFinal: true }]);
          break;
        case "answer_start":
          if (msg.answerId && msg.question) {
            setAnswers((prev) => applyAnswerEvent(prev, { type: "answer_start", answerId: msg.answerId, question: msg.question }));
          }
          break;
        case "answer_chunk":
          if (msg.answerId && msg.content) {
            setAnswers((prev) => applyAnswerEvent(prev, { type: "answer_chunk", answerId: msg.answerId, content: msg.content }));
          }
          break;
        case "answer_done":
          if (msg.answerId) {
            setAnswers((prev) => applyAnswerEvent(prev, { type: "answer_done", answerId: msg.answerId }));
          }
          break;
        case "answer_error":
          if (msg.answerId) {
            setAnswers((prev) => applyAnswerEvent(prev, { type: "answer_error", answerId: msg.answerId, error: msg.error }));
          }
          break;
      }
    });
  }, [ws.addHandler]);

  // Auto-scroll
  useEffect(() => {
    answersEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [answers]);
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, interimText]);

  // Calibration countdown
  useEffect(() => {
    if (phase !== "calibrating") return;
    setCalibrationTimer(10);
    const interval = setInterval(() => {
      setCalibrationTimer((t) => {
        if (t <= 1) {
          clearInterval(interval);
          if (!ws.sendJSON({ type: "end_calibration" })) {
            setCalibrationError("WebSocket disconnected before calibration could finish. Please try again.");
          }
          audio.stop();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  const startCalibration = async () => {
    if (!ws.connected) {
      setCalibrationError("WebSocket is not connected. Wait for Connected, then try again.");
      return;
    }

    setCalibrationError(null);
    try {
      await audio.start();
      if (!ws.sendJSON({ type: "start_calibration" })) {
        audio.stop();
        throw new Error("WebSocket disconnected before calibration could start.");
      }
    } catch (error) {
      audio.stop();
      setCalibrationError(error instanceof Error ? error.message : "Microphone access failed. Check browser permissions and try again.");
    }
  };

  const goLive = async () => {
    if (!ws.connected) {
      setCalibrationError("WebSocket is not connected. Wait for Connected, then try again.");
      return;
    }

    setCalibrationError(null);
    try {
      await audio.start();
      if (!ws.sendJSON({ type: "start_live" })) {
        audio.stop();
        throw new Error("WebSocket disconnected before live transcription could start.");
      }
    } catch (error) {
      audio.stop();
      setCalibrationError(error instanceof Error ? error.message : "Microphone access failed. Check browser permissions and try again.");
    }
  };

  const stopLive = () => {
    ws.sendJSON({ type: "stop_live" });
    audio.stop();
  };

  // Role selection
  if (!role) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h2 style={styles.title}>Session: {sessionId}</h2>
          <p style={{ color: "#888", marginBottom: 24, fontSize: 14 }}>
            Choose your role for this device
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button onClick={() => navigate(combinedPath)} style={{ ...styles.roleBtn, flexBasis: "100%" }}>
              📱 Combined (Recommended)
              <span style={styles.roleSub}>Capture audio and read answers on this device</span>
            </button>
            <button onClick={() => navigate(listenerPath)} style={styles.roleBtn}>
              🎤 Listener
              <span style={styles.roleSub}>This device captures audio</span>
            </button>
            <button onClick={() => navigate(readerPath)} style={styles.roleBtn}>
              📖 Reader
              <span style={styles.roleSub}>This device shows answers</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Listener view
  if (role === "listener") {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.statusBar}>
            <span style={{ color: connectionColor }}>
              {connectionLabel}
            </span>
            {!ws.connected && <span aria-label="Loading server" style={styles.connectionSpinner}>↻</span>}
            <span style={{ color: "#888", fontSize: 12 }}>Session: {sessionId}</span>
          </div>

          <h2 style={{ ...styles.title, marginBottom: 24 }}>🎤 Listener Mode</h2>

          <button
            onClick={() => {
              console.info("[Session] Opening Reader", { sessionId: routeSessionId, readerPath });
              window.open(readerPath, "_blank", "noopener");
            }}
            style={{ ...styles.button, background: "#27272a", marginBottom: 16 }}
          >
            Open Reader
          </button>

          {(calibrationError || ws.error) && (
            <p role="alert" style={{ color: "#f87171", fontSize: 14, lineHeight: 1.5, marginBottom: 16 }}>
              {calibrationError || ws.error}
            </p>
          )}

          {phase === "setup" && (
            <div>
              <p style={styles.instructions}>
                Step 1: Calibrate your voice so we can filter it out and only transcribe the interviewer.
              </p>
              <button onClick={startCalibration} disabled={!ws.connected} style={{ ...styles.button, opacity: ws.connected ? 1 : 0.55, cursor: ws.connected ? "pointer" : "wait" }}>
                Start Voice Calibration
              </button>
            </div>
          )}

          {phase === "calibrating" && (
            <div style={{ textAlign: "center" }}>
              <div style={styles.timer}>{calibrationTimer}</div>
              <p style={styles.instructions}>
                Speak naturally for {calibrationTimer} seconds...
                <br />
                Say anything — introduce yourself, count numbers, read something aloud.
              </p>
              <div style={styles.pulseIndicator} />
            </div>
          )}

          {phase === "ready" && (
            <div>
              <p style={{ ...styles.instructions, color: "#4ade80" }}>
                ✓ Voice calibrated! Ready to go live.
              </p>
              <button onClick={goLive} disabled={!ws.connected} style={{ ...styles.button, background: "linear-gradient(135deg, #22c55e, #16a34a)", opacity: ws.connected ? 1 : 0.55, cursor: ws.connected ? "pointer" : "wait" }}>
                🔴 Go Live
              </button>
            </div>
          )}

          {phase === "live" && (
            <div style={{ textAlign: "center" }}>
              <div style={styles.liveIndicator}>● LIVE</div>
              <p style={styles.instructions}>
                Listening to interview... Keep this device near the audio source.
              </p>
              <button onClick={stopLive} style={{ ...styles.button, background: "#dc2626" }}>
                Stop
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Reader and combined view
  return (
    <div style={styles.readerContainer}>
      <div style={styles.statusBar}>
        <span style={{ color: connectionColor }}>
          {connectionLabel}
        </span>
        {!ws.connected && <span aria-label="Loading server" style={styles.connectionSpinner}>↻</span>}
        <span style={{
          color: phase === "live" ? "#f87171" : "#888",
          fontWeight: phase === "live" ? 700 : 400,
          fontSize: 13,
        }}>
          {phase === "live" ? "● LIVE" : phase === "ready" ? "Ready" : "Waiting..."}
        </span>
        <span style={{ color: "#666", fontSize: 12 }}>Session: {sessionId}</span>
      </div>

      {role === "combined" && (
        <div style={styles.combinedControls}>
          {(calibrationError || ws.error) && <p role="alert" style={styles.combinedError}>{calibrationError || ws.error}</p>}
          {phase === "setup" && <button onClick={startCalibration} disabled={!ws.connected} style={{ ...styles.button, opacity: ws.connected ? 1 : 0.55, cursor: ws.connected ? "pointer" : "wait" }}>Start Voice Calibration</button>}
          {phase === "calibrating" && <p style={styles.combinedStatus}>Calibrating… {calibrationTimer}s</p>}
          {phase === "ready" && <button onClick={goLive} disabled={!ws.connected} style={{ ...styles.button, background: "linear-gradient(135deg, #22c55e, #16a34a)", opacity: ws.connected ? 1 : 0.55, cursor: ws.connected ? "pointer" : "wait" }}>🔴 Go Live</button>}
          {phase === "live" && <button onClick={stopLive} style={{ ...styles.button, background: "#dc2626" }}>Stop Live</button>}
        </div>
      )}
      <div style={role === "combined" ? styles.combinedPanels : styles.readerPanels}>
        {/* Transcript panel */}
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Transcript</h3>
          <div style={styles.panelContent}>
            {transcript.map((t, i) => (
              <div key={i} style={styles.transcriptLine}>
                <span style={styles.transcriptBadge}>Q</span>
                {t.text}
              </div>
            ))}
            {interimText && (
              <div style={{ ...styles.transcriptLine, opacity: 0.5, fontStyle: "italic" }}>
                {interimText}
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>
        </div>

        {/* Answers panel */}
        <div style={role === "combined" ? { ...styles.panel, minHeight: 240 } : { ...styles.panel, flex: 2 }}>
          <h3 style={styles.panelTitle}>AI Answers</h3>
          <div style={styles.panelContent}>
            {answers.length === 0 && (
              <p style={{ color: "#555", textAlign: "center", marginTop: 40 }}>
                Waiting for interviewer questions...
              </p>
            )}
            {answers.map((a, i) => (
              <div key={a.id || i} style={styles.answerBlock}>
                <div style={styles.answerQuestion}>❓ {a.question}</div>
                <div style={styles.answerText}>
                  {a.text}
                  {a.error ? <span style={styles.answerError}>{a.error}</span> : !a.done && <span style={styles.cursor}>▊</span>}
                </div>
              </div>
            ))}
            <div ref={answersEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    background: "#141414",
    borderRadius: 16,
    padding: 40,
    maxWidth: 480,
    width: "100%",
    border: "1px solid #2a2a2a",
  },
  title: { fontSize: 22, fontWeight: 700, color: "#fff" },
  statusBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    fontSize: 13,
  },
  instructions: {
    color: "#aaa",
    fontSize: 14,
    lineHeight: 1.6,
    marginBottom: 20,
  },
  button: {
    width: "100%",
    padding: "14px 20px",
    borderRadius: 10,
    border: "none",
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    color: "#fff",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
  },
  roleBtn: {
    flex: 1,
    padding: 24,
    borderRadius: 12,
    border: "1px solid #333",
    background: "#1a1a1a",
    color: "#fff",
    fontSize: 18,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 8,
  },
  roleSub: {
    fontSize: 12,
    color: "#888",
    fontWeight: 400,
  },
  timer: {
    fontSize: 72,
    fontWeight: 700,
    color: "#6366f1",
    marginBottom: 12,
  },
  pulseIndicator: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    background: "#6366f1",
    margin: "20px auto",
    animation: "pulse 1s infinite",
  },
  liveIndicator: {
    fontSize: 24,
    fontWeight: 700,
    color: "#f87171",
    marginBottom: 16,
  },
  // Reader layout
  readerContainer: {
    height: "100vh",
    display: "flex",
    flexDirection: "column" as const,
    padding: 16,
    boxSizing: "border-box" as const,
    overflow: "hidden",
  },
  readerPanels: {
    flex: 1,
    display: "flex",
    gap: 16,
    overflow: "hidden",
  },
  combinedControls: {
    background: "#141414",
    border: "1px solid #2a2a2a",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  combinedStatus: {
    color: "#a5b4fc",
    margin: 0,
    textAlign: "center",
    fontWeight: 600,
  },
  combinedError: {
    color: "#f87171",
    fontSize: 13,
    lineHeight: 1.4,
    margin: "0 0 10px",
  },
  combinedPanels: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
    overflowY: "auto" as const,
  },
  panel: {
    flex: 1,
    background: "#141414",
    borderRadius: 12,
    border: "1px solid #2a2a2a",
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
  },
  panelTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "#888",
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    padding: "12px 16px",
    borderBottom: "1px solid #2a2a2a",
  },
  panelContent: {
    flex: 1,
    overflowY: "auto" as const,
    padding: 16,
    boxSizing: "border-box" as const,
    overflow: "hidden",
  },
  transcriptLine: {
    padding: "8px 0",
    borderBottom: "1px solid #1a1a1a",
    fontSize: 14,
    lineHeight: 1.5,
    color: "#ccc",
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
  },
  transcriptBadge: {
    background: "#6366f1",
    color: "#fff",
    borderRadius: 4,
    padding: "1px 6px",
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0,
    marginTop: 2,
  },
  answerBlock: {
    marginBottom: 24,
    background: "#1a1a1a",
    borderRadius: 10,
    padding: 16,
    boxSizing: "border-box" as const,
    overflow: "hidden",
    border: "1px solid #2a2a2a",
  },
  answerQuestion: {
    fontSize: 13,
    color: "#8b5cf6",
    fontWeight: 600,
    marginBottom: 8,
  },
  answerText: {
    fontSize: 15,
    lineHeight: 1.7,
    color: "#e0e0e0",
    whiteSpace: "pre-wrap" as const,
    overflowWrap: "anywhere" as const,
  },
  cursor: {
    color: "#6366f1",
    animation: "blink 1s infinite",
  },
  connectionSpinner: {
    color: "#fbbf24",
    animation: "blink 1s infinite",
  },
  answerError: {
    color: "#f87171",
    fontSize: 13,
  },
};
