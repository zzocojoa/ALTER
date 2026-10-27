"use client";
import Link from "next/link";
import type { ReactElement } from "react";
import { AccessScreen } from "@/components/alter/access-screen";
export type PageErrorProps = Readonly<{ error: Error & { digest?: string }; reset: () => void }>;
/** 원문 오류·세션·요청 값을 출력하지 않으며 조회 화면만 다시 렌더링합니다. */
export default function PageError({ reset }: PageErrorProps): ReactElement {
  return <AccessScreen title="화면을 불러오지 못했어요" context="다시 확인이 필요해요" detail="저장·전송 완료를 확인한 것은 아니에요. 다시 열거나 오늘 화면에서 같은 기록의 상태를 확인해 주세요."><button className="alter-control alter-button" data-tone="primary" type="button" onClick={reset}>화면 다시 열기</button><a className="alter-link" href="/learn">오늘 화면으로</a><Link className="alter-link" href="/">시작 화면으로</Link></AccessScreen>;
}
