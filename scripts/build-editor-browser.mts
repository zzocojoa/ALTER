import { build } from "vite";
import path from "node:path";
await build({configFile:false,logLevel:"warn",resolve:{alias:{"@":path.resolve(".")}},build:{outDir:".sites-runtime/editor-browser",emptyOutDir:true,lib:{entry:"tests/fixtures/editor-browser.tsx",formats:["iife"],name:"EditorBrowserFixture",fileName:"fixture"}},define:{"process.env.NODE_ENV":JSON.stringify("production")},esbuild:{jsx:"automatic"}});
