import { describe, expect, it } from "vitest";
import { applyAnswerEvent } from "./answerLifecycle.js";

describe("applyAnswerEvent", () => {
  it("keeps separate answer cards when two questions stream close together", () => {
    let answers = applyAnswerEvent([], { type: "answer_start", answerId: "first", question: "First question?" });
    answers = applyAnswerEvent(answers, { type: "answer_chunk", answerId: "first", content: "First answer." });
    answers = applyAnswerEvent(answers, { type: "answer_start", answerId: "second", question: "Second question?" });
    answers = applyAnswerEvent(answers, { type: "answer_chunk", answerId: "second", content: "Second answer." });
    answers = applyAnswerEvent(answers, { type: "answer_done", answerId: "second" });
    answers = applyAnswerEvent(answers, { type: "answer_done", answerId: "first" });

    expect(answers).toEqual([
      expect.objectContaining({ id: "first", text: "First answer.", done: true }),
      expect.objectContaining({ id: "second", text: "Second answer.", done: true }),
    ]);
  });

  it("marks only the failed answer card with its error", () => {
    let answers = applyAnswerEvent([], { type: "answer_start", answerId: "first", question: "First?" });
    answers = applyAnswerEvent(answers, { type: "answer_start", answerId: "second", question: "Second?" });
    answers = applyAnswerEvent(answers, { type: "answer_error", answerId: "first", error: "Failed to generate answer" });

    expect(answers[0]).toMatchObject({ id: "first", done: true, error: "Failed to generate answer" });
    expect(answers[1]).toMatchObject({ id: "second", done: false });
  });

  it("does not duplicate a card when answer_start is repeated", () => {
    const answers = applyAnswerEvent(
      applyAnswerEvent([], { type: "answer_start", answerId: "one", question: "Question?" }),
      { type: "answer_start", answerId: "one", question: "Question?" }
    );

    expect(answers).toHaveLength(1);
  });
});
