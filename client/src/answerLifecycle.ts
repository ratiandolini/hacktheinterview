export interface AnswerEntry {
  id: string;
  question: string;
  text: string;
  done: boolean;
  error?: string;
}

export type AnswerEvent =
  | { type: "answer_start"; answerId: string; question: string }
  | { type: "answer_chunk"; answerId: string; content: string }
  | { type: "answer_done"; answerId: string }
  | { type: "answer_error"; answerId: string; error?: string };

export function applyAnswerEvent(answers: AnswerEntry[], event: AnswerEvent): AnswerEntry[] {
  switch (event.type) {
    case "answer_start":
      return answers.some((answer) => answer.id === event.answerId)
        ? answers
        : [...answers, { id: event.answerId, question: event.question, text: "", done: false }];
    case "answer_chunk":
      return answers.map((answer) =>
        answer.id === event.answerId ? { ...answer, text: answer.text + event.content } : answer
      );
    case "answer_done":
      return answers.map((answer) =>
        answer.id === event.answerId ? { ...answer, done: true } : answer
      );
    case "answer_error":
      return answers.map((answer) =>
        answer.id === event.answerId
          ? { ...answer, done: true, error: event.error || "Failed to generate answer. Please try the next question." }
          : answer
      );
  }
}
