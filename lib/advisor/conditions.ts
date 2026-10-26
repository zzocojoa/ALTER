import { z } from "zod";
import { studyDate } from "../domain/contracts.ts";

export const learningConditions = z.object({
  title: z.string().trim().min(1, "학습 이름을 입력해 주세요.").max(200),
  domain: z.enum(["major", "certification", "practical"]),
  purpose: z.string().trim().min(1, "학습 목적을 입력해 주세요.").max(2000),
  selfReportedLevel: z.string().trim().min(1, "현재 수준을 직접 설명해 주세요.").max(2000),
  minutesPerWeek: z.number().int().min(1, "주간 학습 시간은 1분 이상이어야 해요.").max(10080),
  startDate: studyDate, endDate: studyDate,
  excludedScope: z.array(z.string().trim().min(1).max(300)).max(20),
}).strict().refine((value): boolean => value.endDate >= value.startDate, { path: ["endDate"], message: "종료일은 시작일보다 빠를 수 없어요." });
export type LearningConditions = Readonly<z.infer<typeof learningConditions>>;

/** 날짜는 서울 달력 날짜이며 양끝을 포함한 기간으로 시간 예산을 계산합니다. */
export function availableMinutes(conditions: LearningConditions): number {
  const checked: LearningConditions = learningConditions.parse(conditions);
  const days: number = (Date.parse(checked.endDate) - Date.parse(checked.startDate)) / 86400000 + 1;
  return Math.floor(days * checked.minutesPerWeek / 7);
}
