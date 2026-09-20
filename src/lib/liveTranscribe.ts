import { SAMPLE_RATE, encodeWav, toMono } from "../audioChunks";

/** Average-downsample mono audio to the speech rate the AI expects. */
export function downsample(samples: Float32Array, from: number, to = SAMPLE_RATE): Float32Array {
  if (from <= to) return samples;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

export const rms = (samples: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
};

/** Below this the part is room noise: skip it rather than ask the AI to invent words. */
export const SILENCE_RMS = 0.006;

export function wavBase64(samples: Float32Array): string {
  const bytes = encodeWav(samples, SAMPLE_RATE);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Records the microphone and hands over a self-contained WAV part every few
 * seconds. Works in any browser that allows the microphone; it does not use the
 * browser's own speech service. The returned stop() sends the last partial part first.
 */
export async function startLiveTranscription(opts: {
  chunkMs?: number;
  onChunk: (base64: string, offsetMs: number) => Promise<void>;
  onError: (message: string) => void;
  /** Loudness of the last moment (0-1), about 8 times a second, for a level meter. */
  onLevel?: (level: number) => void;
}): Promise<() => Promise<void>> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  let pieces: Float32Array[] = [];
  let sentMs = 0;
  let queue: Promise<void> = Promise.resolve();
  let open = true;
  let lastLevelAt = 0;
  processor.onaudioprocess = (e) => {
    if (!open) return;
    const block = new Float32Array(e.inputBuffer.getChannelData(0));
    pieces.push(block);
    const now = performance.now();
    if (opts.onLevel && now - lastLevelAt > 120) {
      lastLevelAt = now;
      opts.onLevel(rms(block));
    }
  };
  source.connect(processor);
  processor.connect(mute);
  mute.connect(ctx.destination);

  const flush = () => {
    const taken = pieces;
    pieces = [];
    if (!taken.length) return;
    const total = taken.reduce((n, p) => n + p.length, 0);
    const joined = new Float32Array(total);
    let at = 0;
    for (const p of taken) {
      joined.set(p, at);
      at += p.length;
    }
    const speech = downsample(toMono([joined]), ctx.sampleRate);
    const offset = sentMs;
    sentMs += Math.round((speech.length / SAMPLE_RATE) * 1000);
    if (rms(speech) < SILENCE_RMS || speech.length < SAMPLE_RATE * 0.6) return;
    const base64 = wavBase64(speech);
    queue = queue.then(() => opts.onChunk(base64, offset)).catch((e) => opts.onError((e as Error).message));
  };
  const timer = setInterval(flush, opts.chunkMs ?? 5000);
  return async () => {
    open = false;
    clearInterval(timer);
    flush();
    stream.getTracks().forEach((t) => t.stop());
    processor.disconnect();
    source.disconnect();
    await queue;
    void ctx.close();
  };
}
