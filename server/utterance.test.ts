import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AMBIGUOUS_SILENCE_MS,
  CLEAR_ENDPOINT_GRACE_MS,
  CONTINUATION_ENDPOINT_GRACE_MS,
  InterviewerUtteranceBuffer,
} from "./utterance.js";

function createBuffer() {
  const answerStart = vi.fn();
  const buffer = new InterviewerUtteranceBuffer((text) => answerStart(text));
  return { answerStart, buffer };
}

describe("InterviewerUtteranceBuffer", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps the real greeting and continuation failure as one turn", () => {
    vi.useFakeTimers();
    const { answerStart, buffer } = createBuffer();

    buffer.addFinalSegment("Hello.");
    vi.advanceTimersByTime(900);
    buffer.completeFromUtteranceEnd();
    vi.advanceTimersByTime(900);
    buffer.addFinalSegment("Tell me your name and where.");
    vi.advanceTimersByTime(900);
    buffer.completeFromUtteranceEnd();
    vi.advanceTimersByTime(900);
    buffer.addFinalSegment("From.");
    vi.advanceTimersByTime(AMBIGUOUS_SILENCE_MS);

    expect(answerStart).toHaveBeenCalledTimes(1);
    expect(answerStart).toHaveBeenCalledWith("Hello. Tell me your name and where. From.");
  });

  it("keeps segmented current-role question fragments as one turn and one answer start", () => {
    vi.useFakeTimers();
    const { answerStart, buffer } = createBuffer();

    buffer.addFinalSegment("Tell me about");
    buffer.completeFromUtteranceEnd();
    vi.advanceTimersByTime(1200);
    buffer.addFinalSegment("your current role");
    buffer.completeFromUtteranceEnd();
    vi.advanceTimersByTime(1200);
    buffer.addFinalSegment("and what your main responsibilities are.");
    buffer.completeFromUtteranceEnd();
    vi.advanceTimersByTime(CONTINUATION_ENDPOINT_GRACE_MS);

    expect(answerStart).toHaveBeenCalledTimes(1);
    expect(answerStart).toHaveBeenCalledWith("Tell me about your current role and what your main responsibilities are.");
  });

  it("keeps a segmented difficult-project question as one turn", () => {
    vi.useFakeTimers();
    const { answerStart, buffer } = createBuffer();

    buffer.addFinalSegment("Can you explain");
    buffer.completeFromUtteranceEnd();
    vi.advanceTimersByTime(1200);
    buffer.addFinalSegment("a difficult project");
    buffer.completeFromUtteranceEnd();
    vi.advanceTimersByTime(1200);
    buffer.addFinalSegment("and how you solved it?");
    buffer.completeFromUtteranceEnd();
    vi.advanceTimersByTime(CLEAR_ENDPOINT_GRACE_MS);

    expect(answerStart).toHaveBeenCalledTimes(1);
    expect(answerStart).toHaveBeenCalledWith("Can you explain a difficult project and how you solved it?");
  });

  it("keeps two complete questions separate after a genuine longer pause", () => {
    vi.useFakeTimers();
    const { answerStart, buffer } = createBuffer();

    buffer.addFinalSegment("What is your current role?");
    buffer.completeFromUtteranceEnd();
    vi.advanceTimersByTime(CLEAR_ENDPOINT_GRACE_MS);
    vi.advanceTimersByTime(2000);
    buffer.addFinalSegment("Why are you interested in this position?");
    buffer.completeFromUtteranceEnd();
    vi.advanceTimersByTime(CLEAR_ENDPOINT_GRACE_MS);

    expect(answerStart).toHaveBeenCalledTimes(2);
    expect(answerStart.mock.calls.map(([text]) => text)).toEqual([
      "What is your current role?",
      "Why are you interested in this position?",
    ]);
  });

  it("keeps a short complete question fast", () => {
    vi.useFakeTimers();
    const { answerStart, buffer } = createBuffer();

    buffer.addFinalSegment("Why us?");
    buffer.completeFromUtteranceEnd();
    vi.advanceTimersByTime(CLEAR_ENDPOINT_GRACE_MS);

    expect(answerStart).toHaveBeenCalledTimes(1);
    expect(answerStart).toHaveBeenCalledWith("Why us?");
  });

  it("merges a brief continuation after sentence punctuation before generating an answer", () => {
    vi.useFakeTimers();
    const { answerStart, buffer } = createBuffer();

    buffer.addFinalSegment("Tell me about yourself.");
    buffer.completeFromUtteranceEnd();
    vi.advanceTimersByTime(900);
    buffer.addFinalSegment("And what do you currently do?");
    buffer.completeFromUtteranceEnd();
    vi.advanceTimersByTime(CLEAR_ENDPOINT_GRACE_MS);

    expect(answerStart).toHaveBeenCalledTimes(1);
    expect(answerStart).toHaveBeenCalledWith("Tell me about yourself. And what do you currently do?");
  });

  it("eventually completes a greeting after a long silence", () => {
    vi.useFakeTimers();
    const { answerStart, buffer } = createBuffer();

    buffer.addFinalSegment("Hello.");
    vi.advanceTimersByTime(AMBIGUOUS_SILENCE_MS);

    expect(answerStart).toHaveBeenCalledWith("Hello.");
  });

  it("does not duplicate when UtteranceEnd and timeout race", () => {
    vi.useFakeTimers();
    const { answerStart, buffer } = createBuffer();

    buffer.addFinalSegment("What is your name?");
    buffer.completeFromUtteranceEnd();
    vi.advanceTimersByTime(CLEAR_ENDPOINT_GRACE_MS);
    vi.advanceTimersByTime(AMBIGUOUS_SILENCE_MS);

    expect(answerStart).toHaveBeenCalledTimes(1);
  });
});