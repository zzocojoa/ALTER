import { AccessHomeLink, AccessScreen } from "@/components/alter/access-screen";
import type { ReactElement, ReactNode } from "react";
import { AppShell } from "@/components/alter/app-shell";
import { getOwnerDecision } from "@/lib/owner-access";

export default async function LearningLayout({ children }: Readonly<{ children: ReactNode }>): Promise<ReactElement> {
  const decision = await getOwnerDecision();
  if (decision.kind === "restore-quarantined") return <AccessScreen title="복원을 확인하고 있어요" context="학습 공간 잠김" detail="자료와 학습 기록의 복원 검증과 활성화가 끝날 때까지 이 공간은 잠겨 있어요. AI 호출과 Google 연결도 실행되지 않아요."><a className="alter-link access-primary" href="/restore">복원 진행 상태 확인</a><AccessHomeLink/></AccessScreen>;
  if (decision.kind === "configuration-error") return <AccessScreen title="학습 공간 설정을 확인해 주세요" context="설정 확인 필요" detail="접근 권한을 확인할 설정이 아직 준비되지 않았어요. 설정을 마친 뒤 다시 열어 주세요."><AccessHomeLink/></AccessScreen>;
  if (decision.kind !== "owner") return <>{children}</>;
  return <AppShell>{children}</AppShell>;
}
