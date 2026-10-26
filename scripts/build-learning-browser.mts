import { build } from "vite";
import { copyFile } from "node:fs/promises";
import path from "node:path";
const output:string=path.resolve(".sites-runtime/learning-flow-browser");
await build({configFile:false,logLevel:"warn",plugins:[{name:"flow-browser-wasm",enforce:"pre",resolveId(source:string){return source.endsWith(".wasm") ? {id:`./${path.basename(source)}`,external:true} : null;}}],ssr:{noExternal:true,external:["node:buffer","node:crypto","node:stream","node:stream/promises","node:zlib"],target:"webworker"},build:{ssr:"tests/fixtures/learning-flow-browser-worker.ts",target:"es2022",outDir:output,emptyOutDir:true,rollupOptions:{output:{entryFileNames:"worker.mjs"}}}});
await copyFile("lib/materials/pdf-wasm/validator.wasm",path.join(output,"validator.wasm"));
await copyFile("lib/materials/jpeg-wasm/decoder.wasm",path.join(output,"decoder.wasm"));
