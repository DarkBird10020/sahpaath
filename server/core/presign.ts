import type { AppConfig } from "./config";
import { signUploadToken } from "./ids";

/**
 * Presigned direct upload abstraction.
 *
 * - `S3PresignedUpload` creates a REAL S3 POST policy (via
 *   @aws-sdk/s3-presigned-post) when a bucket is configured: the browser
 *   uploads directly to private S3; the bucket never becomes public. The
 *   policy enforces content-length-range (max size), the exact content type,
 *   and a unique server-generated key, and it expires.
 * - `LocalPresignedUpload` is the clearly separated local adapter used when
 *   no AWS account/bucket exists. It signs a confirmation token with an
 *   HMAC so the constraint set is enforced server-side, and every response
 *   is explicitly labeled `mode: "local"` — it is never presented as AWS.
 *
 * UNVERIFIED (cloud): exact POST-policy behavior requires an authenticated
 * account per docs/AWS_VERIFICATION.md; no guessed quotas or ARNs are used.
 */

export interface PresignedUploadFields {
  /** Form fields the client MUST include with the file in the POST. */
  fields: Record<string, string>;
  /** URL to POST the multipart form to (S3 endpoint or local sink). */
  url: string;
  /** Epoch ms when the grant stops being valid. */
  expiresAt: number;
  /** Unique object key the upload must land on. */
  key: string;
}

export interface PresignedUploadGrant extends PresignedUploadFields {
  /** "s3" = real AWS presigned POST; "local" = local signed adapter. */
  mode: "s3" | "local";
  /** Maximum accepted object size in bytes (enforced by policy/verification). */
  maxSize: number;
  /** The single allowed content type for this grant. */
  contentType: "image/png" | "image/jpeg";
  /** Identifies the diagram this grant belongs to. */
  diagramId: string;
}

export interface PresignedUploadProvider {
  createGrant(input: {
    diagramId: string;
    contentType: "image/png" | "image/jpeg";
    maxSize: number;
    expiresInSeconds: number;
  }): Promise<PresignedUploadGrant>;
}

export class S3PresignedUpload implements PresignedUploadProvider {
  constructor(
    private readonly bucket: string,
    private readonly region: string,
  ) {}

  async createGrant(input: {
    diagramId: string;
    contentType: "image/png" | "image/jpeg";
    maxSize: number;
    expiresInSeconds: number;
  }): Promise<PresignedUploadGrant> {
    const { createPresignedPost } = await import("@aws-sdk/s3-presigned-post");
    const { S3Client } = await import("@aws-sdk/client-s3");
    const client = new S3Client({ region: this.region });
    const ext = input.contentType === "image/png" ? "png" : "jpg";
    const key = s3UploadKey(input.diagramId, ext);
    const presigned = await createPresignedPost(client, {
      Bucket: this.bucket,
      Key: key,
      Conditions: [
        ["content-length-range", 1, input.maxSize],
        { "Content-Type": input.contentType },
      ],
      Expires: input.expiresInSeconds,
      // No ACL field: the bucket policy keeps every object private.
    });
    return {
      mode: "s3",
      url: presigned.url,
      fields: presigned.fields,
      key,
      expiresAt: Date.now() + input.expiresInSeconds * 1000,
      maxSize: input.maxSize,
      contentType: input.contentType,
      diagramId: input.diagramId,
    };
  }
}

function s3UploadKey(diagramId: string, ext: "png" | "jpg"): string {
  return `uploads/${diagramId}/original.${ext}`;
}

export class LocalPresignedUpload implements PresignedUploadProvider {
  constructor(private readonly secret: string) {}

  async createGrant(input: {
    diagramId: string;
    contentType: "image/png" | "image/jpeg";
    maxSize: number;
    expiresInSeconds: number;
  }): Promise<PresignedUploadGrant> {
    const ext = input.contentType === "image/png" ? "png" : "jpg";
    const key = s3UploadKey(input.diagramId, ext);
    const expiresAt = Date.now() + input.expiresInSeconds * 1000;
    const fields = {
      key,
      "Content-Type": input.contentType,
      // Local mirror of the S3 policy conditions; verified on confirmation.
      "x-sahpaath-diagram-id": input.diagramId,
      "x-sahpaath-max-size": String(input.maxSize),
      "x-sahpaath-expires-at": String(expiresAt),
      "x-sahpaath-token": signUploadToken(this.secret, {
        key,
        maxSize: input.maxSize,
        contentType: input.contentType,
        expiresAt,
        diagramId: input.diagramId,
      }),
    };
    return {
      mode: "local",
      url: "/api/v1/uploads/local",
      fields,
      key,
      expiresAt,
      maxSize: input.maxSize,
      contentType: input.contentType,
      diagramId: input.diagramId,
    };
  }
}

export function createPresignedProvider(config: AppConfig): PresignedUploadProvider {
  if (config.s3Bucket && config.awsRegion)
    return new S3PresignedUpload(config.s3Bucket, config.awsRegion);
  return new LocalPresignedUpload(config.uploadTokenSecret);
}
