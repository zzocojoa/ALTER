import type { ReactElement } from "react";
import type { GoogleConnectionView } from "@/lib/google/view";
import { googleConnectionCanUseData } from "@/lib/google/view";
import { StatusBadge } from "@/components/alter/status";

/** 승인 범위와 현재 이용 조건을 구분하고 토큰이나 공급사 인증 응답은 표시하지 않습니다. */
export function GoogleConnectionDetails({ connection, configured }: Readonly<{ connection: NonNullable<GoogleConnectionView["connection"]>; configured: boolean }>): ReactElement {
  const usable: boolean = configured && googleConnectionCanUseData(connection);
  return <div className="google-connection-details">
    <section aria-label="연결 계정" className="google-card"><h3>연결 계정</h3><p className="google-account">{connection.email}</p><p>ChatGPT 로그인과 별도로 승인한 Google 계정이에요.</p></section>
    <section aria-label="허용 범위" className="google-card"><h3>허용 범위</h3><dl><div><dt>선택·생성한 파일</dt><dd><StatusBadge label={connection.filesAllowed ? "파일 권한 승인 기록 있음" : "파일 권한 필요"} tone={connection.filesAllowed ? "neutral" : "warning"}/></dd></div><div><dt>ALTER 전용 캘린더</dt><dd><StatusBadge label={connection.calendarAllowed ? "캘린더 권한 승인 기록 있음" : "캘린더 권한 필요"} tone={connection.calendarAllowed ? "neutral" : "warning"}/></dd></div></dl><p>{usable ? "파일 선택·일정 실행 시 서버가 현재 권한과 유효성을 다시 확인해요." : "현재 연결 상태에서는 파일·일정 실행을 사용할 수 없어요. 연결 준비와 인증 상태를 먼저 확인해 주세요."}</p></section>
    <section aria-label="인증 유효기간" className="google-card"><h3>인증 유효기간</h3>{connection.refreshExpiresAt === null ? <p>제공된 만료 시각이 없어요. 무기한 사용을 뜻하지 않으며 실행 시 서버가 확인해요.</p> : <p>동의 유효기간<br/><time dateTime={new Date(connection.refreshExpiresAt).toISOString()}>{new Date(connection.refreshExpiresAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</time> (서울)</p>}<p>다시 동의가 필요하거나 결과가 불확실하면 연결 상태를 새로 확인한 뒤 진행해요.</p></section>
  </div>;
}
