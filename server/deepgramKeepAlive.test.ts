import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEEPGRAM_KEEP_ALIVE_INTERVAL_MS, DeepgramKeepAliveManager } from "./deepgramKeepAlive.js";

function connection() {
  return { sendKeepAlive: vi.fn() };
}

describe("Deepgram idle keepalive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("keeps the successful calibration connection active while no audio is sent", () => {
    const manager = new DeepgramKeepAliveManager();
    const calibratedConnection = connection();

    manager.start("session", calibratedConnection);
    vi.advanceTimersByTime(DEEPGRAM_KEEP_ALIVE_INTERVAL_MS);

    expect(calibratedConnection.sendKeepAlive).toHaveBeenCalledWith({ type: "KeepAlive" });
    expect(manager.getConnection("session")).toBe(calibratedConnection);
  });

  it("sends keepalive periodically while the connection is idle", () => {
    const manager = new DeepgramKeepAliveManager();
    const activeConnection = connection();

    manager.start("session", activeConnection);
    vi.advanceTimersByTime(DEEPGRAM_KEEP_ALIVE_INTERVAL_MS * 3);

    expect(activeConnection.sendKeepAlive).toHaveBeenCalledTimes(3);
  });

  it("uses only one keepalive timer for a connection", () => {
    const manager = new DeepgramKeepAliveManager();
    const activeConnection = connection();

    manager.start("session", activeConnection);
    manager.start("session", activeConnection);
    vi.advanceTimersByTime(DEEPGRAM_KEEP_ALIVE_INTERVAL_MS);

    expect(activeConnection.sendKeepAlive).toHaveBeenCalledTimes(1);
  });

  it("keeps using the same Deepgram connection when live audio resumes", () => {
    const manager = new DeepgramKeepAliveManager();
    const calibratedConnection = connection();

    manager.start("session", calibratedConnection);
    vi.advanceTimersByTime(DEEPGRAM_KEEP_ALIVE_INTERVAL_MS - 1);
    manager.recordAudio("session");
    vi.advanceTimersByTime(DEEPGRAM_KEEP_ALIVE_INTERVAL_MS - 1);

    expect(calibratedConnection.sendKeepAlive).not.toHaveBeenCalled();
    expect(manager.getConnection("session")).toBe(calibratedConnection);
  });

  it("clears the keepalive timer on explicit cleanup", () => {
    const manager = new DeepgramKeepAliveManager();
    const activeConnection = connection();

    manager.start("session", activeConnection);
    manager.stop("session");
    vi.advanceTimersByTime(DEEPGRAM_KEEP_ALIVE_INTERVAL_MS * 2);

    expect(activeConnection.sendKeepAlive).not.toHaveBeenCalled();
    expect(manager.getConnection("session")).toBeUndefined();
  });

  it("does not let an old connection cleanup stop a replacement timer", () => {
    const manager = new DeepgramKeepAliveManager();
    const oldConnection = connection();
    const replacementConnection = connection();

    manager.start("session", oldConnection);
    manager.start("session", replacementConnection);
    manager.stop("session", oldConnection);
    vi.advanceTimersByTime(DEEPGRAM_KEEP_ALIVE_INTERVAL_MS);

    expect(oldConnection.sendKeepAlive).not.toHaveBeenCalled();
    expect(replacementConnection.sendKeepAlive).toHaveBeenCalledTimes(1);
  });
});