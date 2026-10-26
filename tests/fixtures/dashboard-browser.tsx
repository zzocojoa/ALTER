import { createRoot } from "react-dom/client";
import { UsageDashboardClient } from "../../app/learn/usage-client";
import { LearningDashboardClient } from "../../app/learn/dashboard-client";
import "../../app/learn/dashboard.css";
const root = document.getElementById("dashboard-fixture");
if (!root) throw new Error("대시보드 검사 요소가 없습니다.");
createRoot(root).render(location.pathname === "/usage" ? <UsageDashboardClient /> : <LearningDashboardClient />);
