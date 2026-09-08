export const AMBIGUOUS_SILENCE_MS = 2600;
export const CLEAR_SILENCE_MS = 1600;
export const CLEAR_ENDPOINT_GRACE_MS = 650;

export type UtteranceCompletionReason = "Deepgram UtteranceEnd" | "silence timeout";

function normalizeUtterance(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\s+([,.;!?])/g, "$1").trim();
}

function isAmbiguousTurn(text: string): boolean {
  const normalized = normalizeUtterance(text);
  const words = normalized.toLowerCase().replace(/[^a-z0-9' ]/g, "").trim().split(/\s+/).filter(Boolean);
  const phrase = words.join(" ");
  const greeting = /^(hello|hi|hey|okay|ok|so|right|well|great)$/;
  const incompleteEnding = /\b(and|or|but|because|so|if|when|where|from|to|with|of|for|about|the|a|an|your|my|our|their)$/;
  const incompleteLead = /\b(tell me(?: about)?|what about|how about|where do|where are|what is|what are|how do|how did|can you|could you|would you)\??$/;

  return greeting.test(phrase) || (!normalized.endsWith("?") && words.length < 3) || incompleteEnding.test(phrase) || incompleteLead.test(phrase);
}

export class InterviewerUtteranceBuffer {
  private segments: string[] = [];
  private completionTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSegmentAt = 0;

  constructor(private readonly onComplete: (utterance: string, reason: UtteranceCompletionReason, lastSegmentAt: number) => void) {}

  addFinalSegment(segment: string) {
    const normalized = normalizeUtterance(segment);
    if (!normalized) return;
    this.segments.push(normalized);
    this.lastSegmentAt = Date.now();
    this.schedule("silence timeout", this.getSilenceDelay());
  }

  completeFromUtteranceEnd() {
    if (!this.segments.length) return;
    this.schedule("Deepgram UtteranceEnd", this.getEndpointGraceDelay());
  }

  dispose() {
    if (this.completionTimer) clearTimeout(this.completionTimer);
    this.completionTimer = null;
    this.segments = [];
  }

  private get utterance() { return normalizeUtterance(this.segments.join(" ")); }
  private getSilenceDelay() { return isAmbiguousTurn(this.utterance) ? AMBIGUOUS_SILENCE_MS : CLEAR_SILENCE_MS; }
  private getEndpointGraceDelay() { return isAmbiguousTurn(this.utterance) ? AMBIGUOUS_SILENCE_MS : CLEAR_ENDPOINT_GRACE_MS; }

  private schedule(reason: UtteranceCompletionReason, delayMs: number) {
    if (this.completionTimer) clearTimeout(this.completionTimer);
    this.completionTimer = setTimeout(() => this.complete(reason), delayMs);
  }

  private complete(reason: UtteranceCompletionReason) {
    this.completionTimer = null;
    const utterance = this.utterance;
    const lastSegmentAt = this.lastSegmentAt;
    this.segments = [];
    if (utterance) this.onComplete(utterance, reason, lastSegmentAt);
  }
}