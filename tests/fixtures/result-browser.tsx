import { createRoot } from "react-dom/client";
import { resultDraft } from "../../lib/results/contracts";
import { ResultClient } from "../../app/learn/results/result-client";
import "../../app/learn/results/results.css";
const element=document.getElementById("result-fixture");const data=document.getElementById("result-initial");if(!element || !data) throw new Error("결과 화면 검사 입력이 없습니다.");
createRoot(element).render(<ResultClient initial={resultDraft.parse(JSON.parse(data.textContent ?? ""))}/>);
