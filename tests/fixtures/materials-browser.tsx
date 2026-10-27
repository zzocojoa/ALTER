import { createRoot } from "react-dom/client";
import { MaterialLibraryClient } from "../../app/learn/materials/library-client";
import { libraryReply } from "../../app/learn/materials/client-api";
import { ShellFrame } from "../../components/alter/shell-frame";
import { PageHeader } from "../../components/alter/page-header";
import "../../app/globals.css";
import "../../app/styles/tokens.css";
import "../../app/styles/foundation.css";
import "../../app/styles/components.css";
import "../../app/styles/shell.css";

const root: HTMLElement | null = document.getElementById("materials-fixture");
const initial: HTMLElement | null = document.getElementById("initial-library");
if (root === null || initial === null) throw new Error("자료 브라우저 검증용 초기 화면이 없습니다.");
createRoot(root).render(<ShellFrame pathname="/learn/materials"><main id="learn-main" tabIndex={-1} className="site-shell material-page"><PageHeader title="자료 보관함" context="자료 · 나의 학습 서가" back={{ href: "/learn", label: "오늘로" }} action={null} /><MaterialLibraryClient initial={libraryReply.parse(JSON.parse(initial.textContent ?? ""))} initialSelectedId={new URLSearchParams(location.search).get("open")} /></main></ShellFrame>);
