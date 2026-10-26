import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({ ...base, testMatch: "material-acceptance.spec.ts", timeout: 90000, projects: base.projects?.slice(0, 1), webServer: { command: "npm run dev -- --hostname 127.0.0.1", url: "http://127.0.0.1:5173", reuseExistingServer: true, env: { ALTER_LOCAL_MOCK_AUTH: "1" } } });
