import { defineConfig } from "@playwright/test";
import base from "./playwright.materials.config";
export default defineConfig({ ...base, testMatch: ["material-*.spec.ts", "identity.spec.ts", "storage-feedback.spec.ts"], timeout: 90000 });
