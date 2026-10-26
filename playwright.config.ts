import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: "production.spec.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:5173", trace: "retain-on-failure" },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], timezoneId: "UTC" } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"], viewport: { width: 360, height: 800 }, timezoneId: "Asia/Seoul" } },
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 60_000,
    env: { ALTER_LOCAL_MOCK_AUTH: "1", TZ: "UTC" },
  },
});
