import { describe, expect, it } from "vitest";
import {
  CALIBRATION_CONNECTION_GRACE_MS,
  collectSpeakerLabels,
  getCalibrationReconnectGraceDelay,
  getDominantSpeakerLabel,
  resetSpeakerCalibration,
  withoutSpeaker,
} from "./speakerCalibration.js";

describe("speaker calibration", () => {
  it("selects the dominant speaker from finalized calibration words", () => {
    const counts = new Map<string, number>();
    collectSpeakerLabels(counts, [
      { word: "I", speaker: 0 }, { word: "am", speaker: 0 }, { word: "ready", speaker: 0 },
      { word: "hello", speaker: 1 },
    ]);
    expect(getDominantSpeakerLabel(counts)).toBe("0");
  });

  it("fails calibration when no speaker metadata is present", () => {
    const counts = new Map<string, number>();
    collectSpeakerLabels(counts, [{ word: "hello" }, { word: "there" }]);
    expect(getDominantSpeakerLabel(counts)).toBeNull();
  });

  it("ignores a self-speaker-only segment", () => {
    expect(withoutSpeaker([{ word: "My", speaker: 0 }, { word: "answer", speaker: 0 }], "0")).toBe("");
  });

  it("retains an interviewer-only segment", () => {
    expect(withoutSpeaker([{ word: "Tell", speaker: 1 }, { word: "me", speaker: 1 }], "0")).toBe("Tell me");
  });

  it("does not pass an unlabeled word through the interviewer pipeline", () => {
    expect(withoutSpeaker([{ word: "unknown" }], "0")).toBe("");
  });

  it("removes only calibrated speaker words from a mixed segment", () => {
    expect(withoutSpeaker([
      { word: "My", speaker: 0 }, { word: "question", speaker: 1 }, { word: "is", speaker: 1 }, { word: "thanks", speaker: 0 },
    ], "0")).toBe("question is");
  });

  it("keeps a successful calibration through harmless setup events during the reconnect grace window", () => {
    const session = { isCalibrated: true, calibratedSpeakerLabel: "0", calibratedAt: 10_000 };
    expect(getCalibrationReconnectGraceDelay(session, 10_100)).toBe(CALIBRATION_CONNECTION_GRACE_MS - 100);
    expect(session).toMatchObject({ isCalibrated: true, calibratedSpeakerLabel: "0", calibratedAt: 10_000 });
  });

  it("allows a transient listener reconnect within 40 seconds without invalidating calibration", () => {
    const session = { isCalibrated: true, calibratedSpeakerLabel: "0", calibratedAt: 10_000 };
    expect(getCalibrationReconnectGraceDelay(session, 49_999)).toBe(1);
    expect(session.isCalibrated).toBe(true);
  });

  it("does not expire a stable calibration when the grace window ends", () => {
    const session = { isCalibrated: true, calibratedSpeakerLabel: "0", calibratedAt: 10_000 };
    expect(getCalibrationReconnectGraceDelay(session, 50_000)).toBeNull();
    expect(session).toMatchObject({ isCalibrated: true, calibratedSpeakerLabel: "0" });
  });
  it("invalidates calibration after a connection change", () => {
    const session = { isCalibrating: true, isCalibrated: true, calibratedSpeakerLabel: "0", calibratedAt: 1000, calibrationSpeakerCounts: new Map([["0", 5]]) };
    resetSpeakerCalibration(session);
    expect(session).toMatchObject({ isCalibrating: false, isCalibrated: false, calibratedSpeakerLabel: null, calibratedAt: null });
    expect(session.calibrationSpeakerCounts.size).toBe(0);
  });
});