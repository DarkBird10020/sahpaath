import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { join } from "node:path";

/**
 * Starts the classroom server for browser tests on an empty database. Playwright
 * starts this server before any hook runs, so the clearing has to happen here:
 * keeping the lessons from earlier runs made the teacher page slower every time.
 */
rmSync(process.env.SAHPAATH_DATA_DIR ?? ".data/e2e", { recursive: true, force: true });
// A disposable signing key lets the HTTP tests verify real JWTs without a hosted account.
const dataDir = process.env.SAHPAATH_DATA_DIR ?? ".data/e2e";
mkdirSync(dataDir, { recursive: true });
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
writeFileSync(join(dataDir, "test-signing-key.pem"), privateKey.export({ type: "pkcs8", format: "pem" }));
const jwks = createServer((_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "e2e-key", alg: "ES256", use: "sig" }] }));
});
await new Promise<void>((resolve) => jwks.listen(0, "127.0.0.1", resolve));
const address = jwks.address();
if (!address || typeof address === "string") throw new Error("Could not start test JWKS.");
process.env.SUPABASE_URL = "https://e2e-project.supabase.co";
process.env.SUPABASE_JWKS_URL = `http://127.0.0.1:${address.port}/jwks`;
await import("../../server/index.js");
