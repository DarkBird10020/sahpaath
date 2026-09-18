import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * Binary storage abstraction. Large files (images, audio) never go into
 * DynamoDB — they live in S3 in the cloud layout, and in a private local
 * directory via this adapter while the AWS account is unavailable.
 * The bucket/directory is always private: access flows through the API
 * which authorizes every request.
 */
export interface BinaryStorage {
  put(key: string, bytes: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
}

export class LocalFileStorage implements BinaryStorage {
  constructor(private readonly root: string) {}

  private path(key: string): string {
    // Reject traversal: resolved key must stay under root.
    const full = resolve(this.root, key);
    const rootAbs = resolve(this.root);
    if (full !== rootAbs && !full.startsWith(rootAbs + "/") && !full.startsWith(rootAbs + "\\"))
      throw new Error("Invalid storage key.");
    return full;
  }

  async put(key: string, bytes: Buffer, _mimeType: string): Promise<void> {
    const full = this.path(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * S3 adapter placeholder implementing the same interface. Enabled only when
 * an S3 bucket is configured; the client is created lazily so the SDK is
 * not loaded (or required) in local-only mode. Capabilities are UNVERIFIED
 * until an authenticated account exists.
 */
export class S3Storage implements BinaryStorage {
  private client: { send: (cmd: unknown) => Promise<unknown> } | null = null;
  constructor(
    private readonly bucket: string,
    private readonly region: string,
  ) {}

  private async getClient(): Promise<unknown> {
    if (!this.client) {
      const mod = await import("@aws-sdk/client-s3");
      this.client = new mod.S3Client({ region: this.region }) as never;
    }
    return this.client;
  }

  async put(key: string, bytes: Buffer, mimeType: string): Promise<void> {
    const client = (await this.getClient()) as {
      send: (cmd: unknown) => Promise<unknown>;
    };
    const mod = await import("@aws-sdk/client-s3");
    // No public ACL is ever set; bucket policy keeps it private.
    await client.send(
      new mod.PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: mimeType,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const client = (await this.getClient()) as {
      send: (cmd: unknown) => Promise<unknown>;
    };
    const mod = await import("@aws-sdk/client-s3");
    const result = (await client.send(
      new mod.GetObjectCommand({ Bucket: this.bucket, Key: key }),
    )) as { Body: { transformToString: (enc: string) => Promise<string> } };
    return Buffer.from(await result.Body.transformToString("base64"), "base64");
  }

  async exists(key: string): Promise<boolean> {
    try {
      const client = (await this.getClient()) as {
        send: (cmd: unknown) => Promise<unknown>;
      };
      const mod = await import("@aws-sdk/client-s3");
      await client.send(new mod.HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}

export function createStorage(config: {
  s3Bucket: string | null;
  awsRegion: string | null;
  localUploadsDir: string;
}): BinaryStorage {
  if (config.s3Bucket && config.awsRegion)
    return new S3Storage(config.s3Bucket, config.awsRegion);
  return new LocalFileStorage(config.localUploadsDir);
}
