import type { ReactElement } from "react";
import "./diagnostics.css";
import { MaterialAcceptanceCheck } from "../materials/acceptance-check";
import { MaterialDownloadCheck } from "../materials/download-check-panel";
import { AiSupportCheck } from "../ai-support-check";
import { AiLedgerCheck } from "../ai-ledger-check";
import { DataCheck } from "../data-check";
import { MaterialStateCheck } from "../material-state-check";
import { MaterialTextCheck } from "../material-text-check";
import { MaterialJpegCheck } from "../material-jpeg-check";
import { MaterialPngCheck } from "../material-png-check";

/** 기존 검사 버튼과 권한·비용 계약을 그대로 재배치하며 진입만으로 실행하지 않습니다. */
export function DiagnosticTools(): ReactElement {
  return <div className="diagnostic-tools"><section id="diagnostic-materials" tabIndex={-1} aria-label="자료 검사"><h2 className="alter-subheading">자료 등록과 원본</h2><p>검사 버튼에 따라 합성 자료·임시 파일·저장소 관측 기록을 만들 수 있어요.</p><MaterialAcceptanceCheck /><MaterialDownloadCheck /><MaterialPngCheck /><MaterialJpegCheck /><MaterialTextCheck /><MaterialStateCheck /></section><section id="diagnostic-data" tabIndex={-1} aria-label="데이터 검사"><h2 className="alter-subheading">학습 데이터 저장</h2><DataCheck /></section><section id="diagnostic-ai" tabIndex={-1} aria-label="AI 검사"><h2 className="alter-subheading">AI 연결과 비용 원장</h2><AiLedgerCheck /><AiSupportCheck /></section></div>;
}
