import { build } from "vite";
import path from "node:path";
await build({configFile:false,logLevel:"warn",resolve:{alias:{"@":path.resolve("."),"next/navigation":path.resolve("tests/fixtures/review-navigation.ts")}},build:{outDir:".sites-runtime/review-browser",emptyOutDir:true,lib:{entry:"tests/fixtures/review-browser.tsx",formats:["iife"],name:"ReviewBrowserFixture",fileName:"fixture"}},define:{"process.env.NODE_ENV":JSON.stringify("production")},esbuild:{jsx:"automatic"}});
