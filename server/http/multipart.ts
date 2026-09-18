import type { IncomingMessage } from "node:http";
import { payloadTooLargeError } from "../core/errors";

/**
 * Minimal multipart/form-data parser for the local upload sink.
 *
 * Cloud mode never touches this: the browser POSTs the presigned form
 * straight to S3. Local mode POSTs the SAME shape (fields + file) to
 * /api/v1/uploads/local, so the client flow is identical and swapping
 * to real S3 later is a URL change only.
 *
 * Streaming + hard byte cap: an oversized body is rejected before it can
 * exhaust memory. No external dependencies.
 */

export interface MultipartPart {
  data: Buffer;
  filename?: string;
  contentType?: string;
}

export interface MultipartBody {
  /** Simple form fields (values are UTF-8 strings). */
  fields: Record<string, string>;
  /** File parts keyed by field name. */
  files: Record<string, MultipartPart>;
}

function boundaryFrom(contentType: string): string | null {
  const match = /multipart\/form-data\s*;.*boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) return null;
  const boundary = (match[1] ?? match[2] ?? "").trim();
  return boundary.length > 0 && boundary.length <= 200 ? boundary : null;
}

export async function readMultipart(
  req: IncomingMessage,
  maxBytes: number,
): Promise<MultipartBody> {
  const contentType = req.headers["content-type"] || "";
  const boundary = boundaryFrom(contentType);
  if (!boundary) throw new Error("Expected a multipart/form-data body with a boundary.");

  const delimiter = Buffer.from(`--${boundary}`);
  const cap = maxBytes + delimiter.length + 1024;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > cap) throw payloadTooLargeError("Upload body is too large.");
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks);

  const fields: Record<string, string> = {};
  const files: Record<string, MultipartPart> = {};

  // Split on boundary lines. Each part: \r\nheaders\r\n\r\ncontent\r\n
  let cursor = body.indexOf(delimiter);
  if (cursor === -1) throw new Error("Malformed multipart body: boundary not found.");
  cursor += delimiter.length;

  while (cursor < body.length) {
    // Final boundary: --boundary--\r\n
    if (body[cursor] === 0x2d && body[cursor + 1] === 0x2d) break;
    // Skip CRLF after boundary
    if (body[cursor] === 0x0d && body[cursor + 1] === 0x0a) cursor += 2;

    const headerEnd = body.indexOf("\r\n\r\n", cursor);
    if (headerEnd === -1) throw new Error("Malformed multipart part: headers not terminated.");
    const headerText = body.subarray(cursor, headerEnd).toString("utf8");
    const contentStart = headerEnd + 4;
    const nextBoundary = body.indexOf(delimiter, contentStart);
    if (nextBoundary === -1) throw new Error("Malformed multipart part: unterminated content.");
    // Content runs up to the CRLF preceding the next boundary.
    let contentEnd = nextBoundary;
    if (body[contentEnd - 2] === 0x0d && body[contentEnd - 1] === 0x0a) contentEnd -= 2;

    const data = body.subarray(contentStart, contentEnd);
    const name = /name="([^"]*)"/i.exec(headerText)?.[1] ?? "";
    const filename = /filename="([^"]*)"/i.exec(headerText)?.[1];
    const partType = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim();

    if (filename !== undefined || partType !== undefined) {
      files[name || "file"] = { data: Buffer.from(data), filename, contentType: partType };
    } else {
      fields[name] = data.toString("utf8");
    }

    cursor = nextBoundary + delimiter.length;
  }

  return { fields, files };
}
