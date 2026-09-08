import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AMBIGUOUS_SILENCE_MS,
  CLEAR_ENDPOINT_GRACE_MS,
  InterviewerUtteranceBuffer,
} from "./utterance.js";

describe("InterviewerUtteranceBuffer", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps the real greeting and continuation failure as one turn", () => {
    vi.useFakeTimers();
    const completed: string[] = [];
    const buffer = new InterviewerUtteranceBuffer((text) => completed.push(text));

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

    expect(completed).toEqual(["Hello. Tell me your name and where. From."]);
  });

  it("merges a greeting followed by a question during its grace window", () => {
    vi.useFakeTimers();
    const completed: string[] = [];
    const buffer = new InterviewerUtteranceBuffer((text) => completed.push(text));

    buffer.addFinalSegment("Hello.");
    vi.advanceTimersByTime(1200);
    buffer.addFinalSegment("What is your name?");
    buffer.completeFromUtteranceEnd();
    vi.advanceTimersByTime(CLEAR_ENDPOINT_GRACE_MS);

    expect(completed).toEqual(["Hello. What is your name?"]);
  });

  it("keeps 'Hello. Tell me about' open through an endpoint for its continuation", () => {
    vi.useFakeTimers();
    const completed: string[] = [];
    const buffer = new InterviewerUtteranceBuffer((text) => completed.push(text));

    buffer.addFinalSegment("Hello. Tell me about");
    buffer.completeFromUtteranceEnd();
    vi.advanceTimersByTime(2200);
    expect(completed).toEqual([]);

    buffer.addFinalSegment("yourself and where do you live?");
    buffer.completeFromUtteranceEnd();
    vi.advanceTimersByTime(CLEAR_ENDPOINT_GRACE_MS);

    expect(completed).toEqual(["Hello. Tell me about yourself and where do you live?"]);
  });
  it("eventually completes a greeting after a long silence", () => {
    vi.useFakeTimers();
    const completed: string[] = [];
    const buffer = new InterviewerUtteranceBuffer((text) => completed.push(text));

    buffer.addFinalSegment("Hello.");
    vi.advanceTimersByTime(AMBIGUOUS_SILENCE_MS);

    expect(completed).toEqual(["Hello."]);
  });

  it("keeps two clear questions separate after a genuine longer pause", () => {
    vi.useFakeTimers();
    const completed: string[] = [];
    const buffer = new InterviewerUtteranceBuffer((text) => completed.push(text));

    buffer.addFinalSegment("What is your name?");
    buffer.completeFromUtteranceEnd();
    vi.advanceTimersByTime(CLEAR_ENDPOINT_GRACE_MS);
    buffer.addFinalSegment("Why should we hire you?");
    buffer.completeFromUtteranceEnd();
    vi.advanceTimersByTime(CLEAR_ENDPOINT_GRACE_MS);

    expect(completed).toEqual(["What is your name?", "Why should we hire you?"]);
  });

  it("does not duplicate when UtteranceEnd and timeout race", () => {
    vi.useFakeTimers();
    const completed: string[] = [];
    const buffer = new InterviewerUtteranceBuffer((text) => completed.push(text));

    buffer.addFinalSegment("What is your name?");
    buffer.completeFromUtteranceEnd();
    vi.advanceTimersByTime(CLEAR_ENDPOINT_GRACE_MS);
    vi.advanceTimersByTime(AMBIGUOUS_SILENCE_MS);

    expect(completed).toEqual(["What is your name?"]);
  });
});
