import { mkdir,mkdtemp } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

// 회귀 검사는 새 D1·R2를 사용하고 기존 미리보기와 실패 증거를 보존합니다.
const root=path.resolve(".sites-runtime");
await mkdir(root,{recursive:true});
const state=await mkdtemp(path.join(root,"browser-state-"));
const environment={...process.env,ALTER_BROWSER_STATE_DIRECTORY:state,PLAYWRIGHT_BROWSERS_PATH:"0"};
console.log(JSON.stringify({event:"isolated_browser_state",path:state,existingPreviewPreserved:true}));
for(const args of [
  ["--import","./scripts/sites-env.mjs","scripts/prepare-browser-database.mts"],
  ["--import","./scripts/sites-env.mjs","scripts/prepare-librarian-browser.mts"],
  ["--import","./scripts/sites-env.mjs","scripts/prepare-review-browser.mts"],
  ["./node_modules/@playwright/test/cli.js","test",...process.argv.slice(2)],
]) {
  const result=spawnSync(process.execPath,args,{env:environment,stdio:"inherit"});
  if(result.error) throw result.error;
  if(result.signal || result.status!==0) {
    console.error(JSON.stringify({event:"browser_validation_failed",status:result.status,signal:result.signal,statePreserved:state}));
    process.exit(result.status ?? 1);
  }
}
