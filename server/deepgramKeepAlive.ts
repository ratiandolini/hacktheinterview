export const DEEPGRAM_KEEP_ALIVE_INTERVAL_MS = 4_000;

export interface DeepgramKeepAliveConnection {
  sendKeepAlive(message: { type: "KeepAlive" }): void;
}

interface KeepAliveEntry {
  connection: DeepgramKeepAliveConnection;
  lastAudioAt: number;
  timer: ReturnType<typeof setInterval>;
}

export class DeepgramKeepAliveManager {
  private readonly entries = new Map<string, KeepAliveEntry>();

  constructor(private readonly onKeepAlive: (sessionId: string) => void = () => {}) {}

  start(sessionId: string, connection: DeepgramKeepAliveConnection): void {
    this.stop(sessionId);
    const entry = {
      connection,
      lastAudioAt: Date.now(),
      timer: undefined as unknown as ReturnType<typeof setInterval>,
    };
    entry.timer = setInterval(() => {
      if (this.entries.get(sessionId) !== entry) return;
      if (Date.now() - entry.lastAudioAt < DEEPGRAM_KEEP_ALIVE_INTERVAL_MS) return;
      try {
        entry.connection.sendKeepAlive({ type: "KeepAlive" });
        this.onKeepAlive(sessionId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.warn("[Deepgram] KeepAlive failed for session " + sessionId + ": " + message);
      }
    }, DEEPGRAM_KEEP_ALIVE_INTERVAL_MS);
    this.entries.set(sessionId, entry);
  }

  recordAudio(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry) entry.lastAudioAt = Date.now();
  }

  stop(sessionId: string, connection?: DeepgramKeepAliveConnection): void {
    const entry = this.entries.get(sessionId);
    if (!entry || (connection && entry.connection !== connection)) return;
    clearInterval(entry.timer);
    this.entries.delete(sessionId);
  }

  getConnection(sessionId: string): DeepgramKeepAliveConnection | undefined {
    return this.entries.get(sessionId)?.connection;
  }
}