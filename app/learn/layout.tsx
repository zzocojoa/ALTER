import type { ReactElement, ReactNode } from "react";
import { getOwnerDecision } from "@/lib/owner-access";

export default async function LearningLayout({ children }: Readonly<{ children: ReactNode }>): Promise<ReactElement> {
  const decision = await getOwnerDecision();
  if (decision.kind === "restore-quarantined") return <main className="site-shell"><h1>복원을 확인하고 있어요</h1><p>자료와 학습 기록의 복원 검증이 끝날 때까지 이 공간은 잠겨 있어요. AI 호출과 Google 연결도 실행되지 않아요.</p></main>;
  return <>{children}</>;
}
