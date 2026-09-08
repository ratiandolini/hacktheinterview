import OpenAI from "openai";
import type { Session } from "./sessions.js";
import { broadcastToReaders } from "./sessions.js";

let client: OpenAI;
function getClient() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna";
export const MAX_COMPLETION_TOKENS = 100;
const RECENT_TRANSCRIPT_TURNS = 4;

function getReasoningEffort(model: string): "none" | "minimal" {
  return model === "gpt-5.6-luna" ? "none" : "minimal";
}

export function buildSystemPrompt(session: Session): string {
  let prompt = `You are an expert interview coach. The user is in a live ${session.interviewType} interview right now.

Your job: when you see an interviewer's question, provide a natural answer the user can speak immediately.

Rules:
- Answer directly in natural first person.
- Use 2 short sentences by default; use at most 3 only when genuinely needed. Usually write 25–60 words.
- Do not use bullets, headings, filler introductions, or repeated background.
- For coding questions, use a tiny code example only when it materially helps.
- If it is a follow-up, use the recent conversation context.
- Never use placeholders such as [Your Name], [City], or [Company].
- Never invent personal facts. If context does not provide a detail, remain natural and general rather than claiming it.`;
  if (session.customPrompt) prompt += `\n\nAdditional context from user:\n${session.customPrompt}`;
  if (session.resumeText) prompt += `\n\nUser's resume/background:\n${session.resumeText}`;
  return prompt;
}

export async function generateAnswer(session: Session, question: string, lastSegmentAt = Date.now()) {
  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const answerId = `${session.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const recentContext = session.transcript.slice(-RECENT_TRANSCRIPT_TURNS).join("\n");
  const requestStartedAt = Date.now();
  session.answers.push({ id: answerId, question, text: "", done: false });
  broadcastToReaders(session, { type: "answer_start", answerId, question });

  try {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
    console.log(`[OpenAI] Answer request started for session ${session.id} (answerId=${answerId}, model=${model}, turnToRequestMs=${requestStartedAt - lastSegmentAt})`);
    const stream = await getClient().chat.completions.create({
      model,
      messages: [
        { role: "system", content: buildSystemPrompt(session) },
        { role: "user", content: `Recent conversation context:\n${recentContext}\n\nLatest interviewer question/statement:\n"${question}"\n\nProvide a suggested answer:` },
      ],
      stream: true,
      reasoning_effort: getReasoningEffort(model),
      max_completion_tokens: MAX_COMPLETION_TOKENS,
    });

    let fullAnswer = "";
    let chunkCount = 0;
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (!content) continue;
      chunkCount += 1;
      fullAnswer += content;
      const storedAnswer = session.answers.find((answer) => answer.id === answerId);
      if (storedAnswer) storedAnswer.text += content;
      broadcastToReaders(session, { type: "answer_chunk", answerId, content });
      if (chunkCount === 1) {
        console.log(`[OpenAI] First answer chunk broadcast for session ${session.id} (answerId=${answerId}, turnToFirstChunkMs=${Date.now() - lastSegmentAt}, requestToFirstChunkMs=${Date.now() - requestStartedAt})`);
      }
    }

    if (!fullAnswer.trim()) throw new Error("OpenAI returned an empty answer");
    const completedAnswer = session.answers.find((answer) => answer.id === answerId);
    if (completedAnswer) completedAnswer.done = true;
    console.log(`[OpenAI] Answer stream completed for session ${session.id} (answerId=${answerId}, chunks=${chunkCount}, requestToCompleteMs=${Date.now() - requestStartedAt}, turnToCompleteMs=${Date.now() - lastSegmentAt})`);
    broadcastToReaders(session, { type: "answer_done", answerId, fullAnswer });
  } catch (error: any) {
    const failedAnswer = session.answers.find((answer) => answer.id === answerId);
    if (failedAnswer) {
      failedAnswer.done = true;
      failedAnswer.error = "Failed to generate answer";
    }
    console.error(`[LLM] Answer generation failed for session ${session.id} (answerId=${answerId}, status=${error?.status ?? "unknown"}, code=${error?.code ?? "unknown"}, message=${error?.message ?? "unknown"})`);
    broadcastToReaders(session, { type: "answer_error", answerId, error: "Failed to generate answer" });
  }
}