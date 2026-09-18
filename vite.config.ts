import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    // Uploaded images and test reports are runtime data, not source edits.
    // Watching them reloads the page and discards an in-progress manual map.
    watch: { ignored: ["**/.data/**", "**/docs/reports/**", "**/test-results/**"] },
    fs: {
      deny: [
        "**/.env",
        "**/.env.*",
        "**/*.{crt,pem}",
        "**/.git/**",
        "**/.data/**",
        "**/*.sqlite*",
        "**/server/**",
        "**/docs/**",
        "**/PROMPT.md",
        "**/shared/fixtures.ts",
      ],
    },
  },
  build: { target: "es2022" },
});
