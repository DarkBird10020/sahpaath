import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { EntityId } from "../../shared/model";

/** ID/key helpers shared by repositories and services. */

export function newId(): EntityId {
  return randomUUID() as EntityId;
}

/** Session cookie tokens are random; only their hash is persisted. */
export function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Anonymous classroom code, e.g. "7F3K". Ambiguous characters excluded. */
export function newClassCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(4);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/** S3 object keys — private bucket layout; the bucket itself is never public. */
export const s3Keys = {
  upload(diagramId: string, ext: "png" | "jpg"): string {
    return `uploads/${diagramId}/original.${ext}`;
  },
  audio(lessonId: string, versionId: string, partId: string, engine: string): string {
    return `audio/${lessonId}/${versionId}/${partId}-${engine}.mp3`;
  },
};

/**
 * HMAC for local-mode upload confirmations. Binds the object key, expected
 * size, content type and an expiry to a signature the client cannot forge.
 * (S3 POST policies enforce the same constraints natively in cloud mode.)
 */
export function signUploadToken(
  secret: string,
  fields: { key: string; maxSize: number; contentType: string; expiresAt: number; diagramId: string },
): string {
  const payload = `${fields.key}|${fields.maxSize}|${fields.contentType}|${fields.expiresAt}|${fields.diagramId}`;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifyUploadToken(
  secret: string,
  fields: { key: string; maxSize: number; contentType: string; expiresAt: number; diagramId: string },
  signature: string,
): boolean {
  const expected = signUploadToken(secret, fields);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
