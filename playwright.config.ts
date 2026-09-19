import { defineConfig } from "@playwright/test";

/**
 * Every run starts from an empty classroom (see global-setup). Keeping the lessons
 * from earlier runs made the teacher page slower each time, until the longest test
 * ran out of time.
 */
export const RUN_DIR = process.env.SAHPAATH_E2E_DATA_DIR || ".data/e2e";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60000,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: "docs/reports/playwright-results.json" }],
  ],
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL,
    baseURL: "http://127.0.0.1:5174",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx tsx tests/e2e/fresh-server.ts",
    url: "http://127.0.0.1:5174/api/health",
    reuseExistingServer: false,
    env: {
      PORT: "5174",
      SAHPAATH_DATA_DIR: RUN_DIR,
      SAHPAATH_PIPELINE_MODE: "local",
      SAHPAATH_AWS_USE_ROLE: "false",
      AWS_BEDROCK_MODEL_ID: "",
      // Keep browser tests offline: never call Gemini even if .env has a key.
      GEMINI_API_KEY: "",
      VITE_SUPABASE_URL: "http://127.0.0.1:5174/test-auth",
      VITE_SUPABASE_ANON_KEY: "test-public-key",
      // Likewise for YouTube, whose free quota is only ~99 searches a day and
      // would otherwise be spent by every test run.
      YOUTUBE_API_KEY: "",
      SAHPAATH_TEACHER_PASSWORD: "e2e-teacher",
    },
    timeout: 60000,
  },
});
