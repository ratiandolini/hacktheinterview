export interface DiarizedWord {
  word?: unknown;
  speaker?: unknown;
}

export const MIN_CALIBRATION_WORDS = 3;
export const MIN_DOMINANT_SPEAKER_SHARE = 0.7;

function labelFor(word: DiarizedWord): string | null {
  if (typeof word.speaker !== "string" && typeof word.speaker !== "number") return null;
  return String(word.speaker);
}

function textFor(word: DiarizedWord): string | null {
  return typeof word.word === "string" && word.word.trim() ? word.word.trim() : null;
}

export function collectSpeakerLabels(counts: Map<string, number>, words: DiarizedWord[]): void {
  for (const word of words) {
    if (!textFor(word)) continue;
    const label = labelFor(word);
    if (label) counts.set(label, (counts.get(label) || 0) + 1);
  }
}

export function getDominantSpeakerLabel(counts: Map<string, number>): string | null {
  let total = 0;
  let dominantLabel: string | null = null;
  let dominantCount = 0;
  for (const [label, count] of counts) {
    total += count;
    if (count > dominantCount) {
      dominantLabel = label;
      dominantCount = count;
    }
  }
  if (!dominantLabel || total < MIN_CALIBRATION_WORDS || dominantCount / total < MIN_DOMINANT_SPEAKER_SHARE) return null;
  return dominantLabel;
}

export function withoutSpeaker(words: DiarizedWord[], excludedLabel: string): string {
  return words
    .filter((word) => { const label = labelFor(word); return label !== null && label !== excludedLabel; })
    .map(textFor)
    .filter((word): word is string => Boolean(word))
    .join(" ");
}
export function resetSpeakerCalibration(session: {
  isCalibrating: boolean;
  isCalibrated: boolean;
  calibratedSpeakerLabel: string | null;
  calibrationSpeakerCounts: Map<string, number>;
}): void {
  session.isCalibrating = false;
  session.isCalibrated = false;
  session.calibratedSpeakerLabel = null;
  session.calibrationSpeakerCounts.clear();
}