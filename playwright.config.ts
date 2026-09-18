import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60000,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: "docs/reports/playwright-results.json" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:5174",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5174/api/health",
    reuseExistingServer: false,
    env: {
      PORT: "5174",
      SAHPAATH_DATA_DIR: process.env.SAHPAATH_E2E_DATA_DIR || ".data/e2e",
      SAHPAATH_PIPELINE_MODE: "local",
      SAHPAATH_AWS_USE_ROLE: "false",
      AWS_BEDROCK_MODEL_ID: "",
      // Keep browser tests offline: never call Gemini even if .env has a key.
      GEMINI_API_KEY: "",
      SAHPAATH_TEACHER_PASSWORD: "e2e-teacher",
    },
    timeout: 60000,
  },
});
