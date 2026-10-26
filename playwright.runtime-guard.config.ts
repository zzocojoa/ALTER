import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/runtime", forbidOnly: true, retries: 0, workers: 1,
  use: { baseURL: "http://127.0.0.1:8789" },
  webServer: { command: "npm start -- --port 8789 --var ALTER_LOCAL_MOCK_AUTH:1", port: 8789, reuseExistingServer: false, timeout: 60_000 },
});
