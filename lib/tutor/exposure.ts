import { z } from "zod";

export const tutorExposureCounts = z.object({ currentQuestionCount: z.number().int().nonnegative(), sessionCount: z.number().int().nonnegative() }).strict().refine((value): boolean => value.currentQuestionCount <= value.sessionCount, "현재 질문의 원본 열기 기록 수가 전체보다 많습니다.");
export type TutorExposureCounts = Readonly<z.infer<typeof tutorExposureCounts>>;
