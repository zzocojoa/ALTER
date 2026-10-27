import type { ReactElement } from "react";
import { AccessHomeLink, AccessScreen } from "@/components/alter/access-screen";
export default function NotFound(): ReactElement {
  return <AccessScreen title="요청한 화면을 찾지 못했어요" context="주소 확인 필요" detail="주소가 올바른지 확인하거나 오늘 화면에서 저장한 기록을 다시 찾아 주세요."><a className="alter-link access-primary" href="/learn">오늘 화면으로</a><AccessHomeLink/></AccessScreen>;
}
