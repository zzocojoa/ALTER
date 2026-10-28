import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({ ...base, testDir: "./tests/extraction-replay", outputDir: "outputs/ui-extraction/replay-results", timeout: 90_000, reporter: "line" });
