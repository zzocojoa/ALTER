import { build } from "vite";
import path from "node:path";
await build({ configFile: false, logLevel: "warn", resolve: { alias: { "@": path.resolve("."), "next/link": path.resolve("tests/fixtures/public-link.tsx") } }, build: { outDir: ".sites-runtime/backup-browser", emptyOutDir: true, lib: { entry: "tests/fixtures/backup-browser.tsx", formats: ["iife"], name: "BackupBrowserFixture", fileName: "fixture" } }, define: { "process.env.NODE_ENV": JSON.stringify("production") }, esbuild: { jsx: "automatic" } });
