import { z } from "zod";
import { isValidCode, isValidRoomId, normalizeCode, normalizeRoomId } from "./identity";
import { LEVELS } from "./prompts";

// Every API route validates input here. The browser never names a namespace;
// it only presents its secret memory key, and the server derives the rest.
const code = z.string().transform(normalizeCode).refine(isValidCode, "Invalid memory key.");
const roomId = z.string().transform(normalizeRoomId).refine(isValidRoomId, "Invalid room code.");
const name = z.string().trim().max(30).transform((s) => s || "Student").default("Student");
const topic = z.string().trim().min(2, "Give a topic of at least 2 characters").max(120);

export const TutorBody = z.object({
  code,
  name,
  message: z.string().trim().min(1).max(2000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(24).default([]),
  level: z.enum(LEVELS).default("high"),
  provider: z.enum(["groq", "gemini"]).default("groq"),
});
export const OpenBody = z.object({ code, name });
export const QuizGenBody = z.object({ code, topic, count: z.number().int().min(3).max(8).default(5), difficulty: z.enum(["easy", "medium", "hard"]).default("medium") });
export const QuizSubmitBody = z.object({
  code,
  topic,
  results: z.array(z.object({ concept: z.string().trim().min(1).max(80), correct: z.boolean() })).min(1).max(10),
});
export const CardsGenBody = z.object({ code, topic, count: z.number().int().min(4).max(16).default(8) });
export const CardsReviewBody = z.object({
  code,
  topic,
  again: z.array(z.string().max(200)).max(20).default([]),
  hard: z.array(z.string().max(200)).max(20).default([]),
  good: z.array(z.string().max(200)).max(20).default([]),
  easy: z.array(z.string().max(200)).max(20).default([]),
});
export const LensBody = z.object({ code });
export const HistoryBody = z.object({ code });
export const RoomMessageBody = z.object({
  roomId,
  code,
  name,
  content: z.string().trim().min(1).max(1000),
  askBuddy: z.boolean().default(false),
  recentLines: z
    .array(z.object({ displayName: z.string().max(30), kind: z.enum(["user", "agent"]), content: z.string().max(300) }))
    .max(8)
    .default([]),
});
export const RecapBody = z.object({ roomId });
export const ProofBody = z.object({ code, roomId: roomId.optional() });
