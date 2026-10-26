import { build } from "vite";
import path from "node:path";
await build({configFile:false,logLevel:"warn",resolve:{alias:{"@":path.resolve("."),"next/navigation":path.resolve("tests/fixtures/google-report-navigation.ts")}},build:{outDir:".sites-runtime/google-report-browser",emptyOutDir:true,lib:{entry:"tests/fixtures/google-report-browser.tsx",formats:["iife"],name:"GoogleReportBrowserFixture",fileName:"fixture"}},define:{"process.env.NODE_ENV":JSON.stringify("production")},esbuild:{jsx:"automatic"}});
