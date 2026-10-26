import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({ ...base, testMatch: "material-library.spec.ts", timeout: 60000, webServer: { command: "npm run dev -- --hostname 127.0.0.1", url: "http://127.0.0.1:5173", reuseExistingServer: true, timeout: 60000, env: { ALTER_LOCAL_MOCK_AUTH: "1", TZ: "UTC" } } });
