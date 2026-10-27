import { build } from "vite";
import path from "node:path";
await build({ configFile: false, logLevel: "warn", resolve: { alias: { "@": path.resolve(".") } }, build: { outDir: ".sites-runtime/materials-browser", emptyOutDir: true, lib: { entry: "tests/fixtures/materials-browser.tsx", formats: ["iife"], name: "MaterialsBrowserFixture", fileName: "fixture" } }, define: { "process.env.NODE_ENV": JSON.stringify("production") }, esbuild: { jsx: "automatic" } });
