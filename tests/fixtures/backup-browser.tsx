import { createRoot } from "react-dom/client";
import { RestoreTargetClient } from "../../app/learn/backup/restore-target-client";
import { RestoreSourceClient } from "../../app/learn/backup/restore-source-client";
import { BackupClient } from "../../app/learn/backup/backup-client";
import "../../app/globals.css";
import "../../app/learn/backup/backup.css";
const root = document.getElementById("backup-fixture");
if (!root) throw new Error("백업 검사 요소가 없습니다.");
createRoot(root).render(<main className="site-shell"><h1>백업과 복원</h1>{location.pathname === "/restore-target" ? <RestoreTargetClient storageKey="alter-restore-test"/> : location.pathname === "/restore-source" ? <RestoreSourceClient/> : <BackupClient storageKey="alter-backup-test"/>}</main>);
