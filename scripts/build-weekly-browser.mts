import { build } from "vite";
import path from "node:path";
await build({configFile:false,logLevel:"warn",resolve:{alias:{"@":path.resolve(".")}},build:{outDir:".sites-runtime/weekly-browser",emptyOutDir:true,lib:{entry:"tests/fixtures/weekly-browser.tsx",formats:["iife"],name:"WeeklyBrowserFixture",fileName:"fixture"}},define:{"process.env.NODE_ENV":JSON.stringify("production")},esbuild:{jsx:"automatic"}});
