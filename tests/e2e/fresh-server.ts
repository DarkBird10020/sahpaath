import { rmSync } from "node:fs";

/**
 * Starts the classroom server for browser tests on an empty database. Playwright
 * starts this server before any hook runs, so the clearing has to happen here:
 * keeping the lessons from earlier runs made the teacher page slower every time.
 */
rmSync(process.env.SAHPAATH_DATA_DIR ?? ".data/e2e", { recursive: true, force: true });
await import("../../server/index.js");
