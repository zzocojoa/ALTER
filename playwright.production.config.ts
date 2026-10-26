import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e", testMatch: "production.spec.ts", forbidOnly: true, retries: 0, workers: 1,
  use: { baseURL: "http://127.0.0.1:8787" },
  webServer: { command: "npm start -- --port 8787", url: "http://127.0.0.1:8787", reuseExistingServer: false, timeout: 60_000 },
});
