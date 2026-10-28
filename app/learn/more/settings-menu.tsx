import type { ReactElement } from "react";

type SettingsLink = Readonly<{ label: string; href: string }>;
type SettingsGroup = Readonly<{ id: string; title: string; detail: string; links: readonly SettingsLink[] }>;
const groups: readonly SettingsGroup[] = [
  { id: "connection", title: "Google 연결", detail: "연결한 계정과 권한을 확인하고, 선택한 자료와 일정을 관리해요.", links: [{ label: "Google 연결 관리", href: "/learn/google" }, { label: "선택한 Google 참고 자료", href: "/learn/google/references" }, { label: "학습·복습 일정 관리", href: "/learn/calendar" }] },
  { id: "budget", title: "비용과 사용량", detail: "확정 비용·미확정 결제 예약·AI 호출 제한을 각각 확인해요.", links: [{ label: "사용량과 비용 확인", href: "/learn#check-budget" }] },
  { id: "storage", title: "자료와 저장공간", detail: "원본 사용량과 업로드 예약을 확인하고 중단된 등록을 이어가요.", links: [{ label: "자료 보관함과 저장 공간 확인", href: "/learn/materials" }] },
  { id: "backup", title: "백업과 복원", detail: "백업을 받고 검증한 뒤, 별도 저장소의 복원 승인·격리 상태를 확인해요.", links: [{ label: "백업과 복원", href: "/learn/backup" }, { label: "별도 저장소 복원 관리", href: "/restore" }] },
  { id: "diagnostics", title: "소유자 진단", detail: "필요한 기능 검사를 직접 실행해요. AI 검사는 기존 승인·비용 제한을 따라요.", links: [{ label: "소유자 진단 열기", href: "/learn/diagnostics" }] },
];

/** 서버의 소유자 판정 뒤 표시하는 기존 관리 경로이며 이 메뉴는 작업을 실행하지 않습니다. */
export function SettingsMenu({ signOutPath }: Readonly<{ signOutPath: string }>): ReactElement {
  return <nav className="settings-menu" aria-label="관리 메뉴">
    <section id="settings-account" className="settings-group" aria-labelledby="settings-account-title"><h2 id="settings-account-title">계정</h2><p>이 학습 공간은 설정한 ChatGPT 소유자 계정만 이용해요. Google 계정 연결은 별도로 관리해요.</p><div className="settings-links"><a className="alter-link settings-link" href="/api/session">인증 상태 확인</a><a className="alter-link settings-link settings-signout" href={signOutPath} target="_top">로그아웃</a></div></section>
    {groups.map(group => <section key={group.id} id={`settings-${group.id}`} className="settings-group" aria-labelledby={`settings-${group.id}-title`}><h2 id={`settings-${group.id}-title`}>{group.title}</h2><p>{group.detail}</p><div className="settings-links">{group.links.map(link => <a key={link.href} className="alter-link settings-link" href={link.href}>{link.label}<span aria-hidden="true">↗</span></a>)}</div></section>)}
  </nav>;
}
