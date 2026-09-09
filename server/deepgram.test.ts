import { describe, expect, it, vi } from "vitest";
import { invalidateSpeakerCalibration } from "./deepgram.js";
import { createSession } from "./sessions.js";

function makeSocket() {
  return { readyState: 1, send: vi.fn() } as any;
}

describe("speaker calibration connection lifecycle", () => {
  it("keeps the initial Combined calibration lifecycle intact", () => {
    const session = createSession({ interviewType: "JS", customPrompt: "", resumeText: "" });
    const combinedSocket = makeSocket();
    session.listeners.add(combinedSocket);
    session.readers.add(combinedSocket);

    // Initial Combined WebSocket setup has no calibration to invalidate.
    invalidateSpeakerCalibration(session);
    expect(combinedSocket.send).not.toHaveBeenCalled();

    // The current Deepgram calibration connection opens while calibration is in progress.
    session.isCalibrating = true;
    session.calibrationSpeakerCounts.set("0", 5);
    invalidateSpeakerCalibration(session);
    expect(session).toMatchObject({ isCalibrating: true, isCalibrated: false, calibratedSpeakerLabel: null });
    expect(session.calibrationSpeakerCounts).toEqual(new Map([["0", 5]]));
    expect(combinedSocket.send).not.toHaveBeenCalled();

    // Completing calibration is an ordinary setup transition, not a reconnect.
    session.isCalibrating = false;
    session.isCalibrated = true;
    session.calibratedSpeakerLabel = "0";
    expect(combinedSocket.send).not.toHaveBeenCalled();
  });

  it("invalidates a calibrated speaker label after a genuine new speech connection replaces it, even during the grace window", () => {
    const session = createSession({ interviewType: "JS", customPrompt: "", resumeText: "" });
    const combinedSocket = makeSocket();
    session.listeners.add(combinedSocket);
    session.readers.add(combinedSocket);
    session.isCalibrated = true;
    session.calibratedSpeakerLabel = "0";
    session.calibratedAt = Date.now();

    invalidateSpeakerCalibration(session);

    expect(session).toMatchObject({ isCalibrating: false, isCalibrated: false, calibratedSpeakerLabel: null, calibratedAt: null });
    expect(combinedSocket.send).toHaveBeenCalledTimes(1);
    expect(combinedSocket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"calibration_required"'));
  });
});