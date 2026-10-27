import { createRoot } from "react-dom/client";
import { reviewOverview } from "../../lib/reviews/view";
import { ReviewClient } from "../../app/learn/tutor/review-client";
import "../../app/styles/tokens.css";
import "../../app/styles/foundation.css";
import "../../app/styles/components.css";
import "../../app/learn/tutor/tutor.css";
const element=document.getElementById("review-fixture");const data=document.getElementById("review-initial");if(!element || !data) throw new Error("복습 화면 검사 입력이 없습니다.");
createRoot(element).render(<div data-alter-ui><ReviewClient initial={reviewOverview.parse(JSON.parse(data.textContent ?? ""))}/></div>);
