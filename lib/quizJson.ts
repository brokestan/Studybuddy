import { z } from "zod";

// The model is asked for strict JSON, but models drift: code fences, trailing
// prose, wrong option counts. Everything is validated here and unusable output
// is rejected (the caller retries once) rather than shown to a student.

export function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object in model output");
  return JSON.parse(cleaned.slice(start, end + 1));
}

const Question = z.object({
  q: z.string().min(5).max(400),
  options: z.array(z.string().min(1).max(200)).length(4),
  answerIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(5).max(500),
  concept: z.string().min(2).max(80),
});
export const QuizSchema = z.object({
  title: z.string().min(2).max(120),
  questions: z.array(Question).min(1).max(10),
});
export type Quiz = z.infer<typeof QuizSchema>;

export const CardsSchema = z.object({
  title: z.string().min(2).max(120),
  cards: z
    .array(z.object({ front: z.string().min(1).max(200), back: z.string().min(1).max(500), hint: z.string().max(200).optional() }))
    .min(1)
    .max(20),
});
export type Cards = z.infer<typeof CardsSchema>;

/** Models love putting the right answer first. Shuffle so position leaks nothing. */
export function shuffleQuiz(quiz: Quiz, rnd: () => number = Math.random): Quiz {
  return {
    ...quiz,
    questions: quiz.questions.map((qn) => {
      const order = [0, 1, 2, 3];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      return { ...qn, options: order.map((i) => qn.options[i]), answerIndex: order.indexOf(qn.answerIndex) };
    }),
  };
}

export const parseQuiz = (text: string): Quiz => QuizSchema.parse(extractJson(text));
export const parseCards = (text: string): Cards => CardsSchema.parse(extractJson(text));
