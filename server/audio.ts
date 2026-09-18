import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Published } from "../shared/schema";

export type Synthesize = (text: string) => Promise<Uint8Array>;
export type AudioOutcome = "cached" | "generated" | "failed" | "unavailable";

export interface PollyConfig {
  region: string;
  voiceId: string;
  engine: "standard" | "neural" | "generative" | "long-form";
  languageCode: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}
// Polly stays off unless the voice is named explicitly: voice/engine/region
// availability must be verified per account (docs/AWS_VERIFICATION.md §5).
export function readPollyConfig(env: NodeJS.ProcessEnv): PollyConfig | null {
  const region = env.AWS_REGION?.trim();
  const voiceId = env.SAHPAATH_POLLY_VOICE?.trim();
  const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim();
  if (!region || !voiceId || (!(accessKeyId && secretAccessKey) && env.SAHPAATH_AWS_USE_ROLE !== "true"))
    return null;
  const engine = env.SAHPAATH_POLLY_ENGINE?.trim() || "neural";
  if (!["standard", "neural", "generative", "long-form"].includes(engine)) return null;
  return {
    region,
    voiceId,
    engine: engine as PollyConfig["engine"],
    languageCode: env.SAHPAATH_POLLY_LANGUAGE?.trim() || "en-IN",
    accessKeyId,
    secretAccessKey,
    sessionToken: env.AWS_SESSION_TOKEN?.trim() || undefined,
  };
}

export function pollySynthesizer(config: PollyConfig): Synthesize {
  return async (text) => {
    const { PollyClient, SynthesizeSpeechCommand } = await import("@aws-sdk/client-polly");
    const client = new PollyClient({
      region: config.region,
      ...(config.accessKeyId && config.secretAccessKey
        ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, sessionToken: config.sessionToken } }
        : {}),
    });
    const out = await client.send(
      new SynthesizeSpeechCommand({
        Text: text,
        TextType: "text",
        OutputFormat: "mp3",
        VoiceId: config.voiceId as never,
        Engine: config.engine,
        LanguageCode: config.languageCode as never,
      }),
    );
    if (!out.AudioStream) throw new Error("Polly returned no audio stream.");
    return out.AudioStream.transformToByteArray();
  };
}

/** What a student hears for one part: name, then the approved description. */
export function spokenText(published: Published, partId: string): string | null {
  const part = published.map.parts.find((p) => p.id === partId && p.state === "teacher_approved");
  return part ? `${part.name}. ${part.description}` : null;
}

/**
 * Cached audio for approved, published descriptions only. The key covers the
 * version, part, voice and exact text, so re-publishing unchanged content reuses
 * the file and any edit produces new audio. Failures return "failed" instead of
 * throwing: the explorer is complete as text and never waits on audio.
 */
export class AudioService {
  constructor(
    private readonly dir: string,
    private readonly synthesize: Synthesize | null,
    private readonly voice = "none",
  ) {}

  get enabled() {
    return this.synthesize !== null;
  }

  key(published: Published, partId: string): string | null {
    const text = spokenText(published, partId);
    if (!text) return null;
    return createHash("sha256")
      .update(JSON.stringify([published.lessonId, published.version, partId, this.voice, text]))
      .digest("hex")
      .slice(0, 40);
  }

  private file(key: string) {
    return resolve(this.dir, `${key}.mp3`);
  }

  has(published: Published, partId: string): boolean {
    const key = this.key(published, partId);
    return key !== null && existsSync(this.file(key));
  }

  async ensure(published: Published, partId: string): Promise<AudioOutcome> {
    const key = this.key(published, partId);
    if (!key) return "unavailable";
    if (existsSync(this.file(key))) return "cached";
    if (!this.synthesize) return "unavailable";
    try {
      const bytes = await this.synthesize(spokenText(published, partId)!);
      if (!bytes.length) return "failed";
      mkdirSync(this.dir, { recursive: true });
      await writeFile(this.file(key), bytes);
      return "generated";
    } catch {
      return "failed";
    }
  }

  async prepare(published: Published): Promise<Record<AudioOutcome, number>> {
    const counts: Record<AudioOutcome, number> = { cached: 0, generated: 0, failed: 0, unavailable: 0 };
    for (const part of published.map.parts) counts[await this.ensure(published, part.id)]++;
    return counts;
  }

  async read(published: Published, partId: string): Promise<Buffer | null> {
    const key = this.key(published, partId);
    if (!key || !existsSync(this.file(key))) return null;
    return readFile(this.file(key));
  }
}
