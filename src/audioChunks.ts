/**
 * Turns a long recording into speech-quality WAV parts for AI captions.
 * Browser-side decoding keeps uploads small (16 kHz mono ≈ 1.9 MB per minute)
 * and works for the audio track of MP3, M4A, WAV, OGG, MP4 and WebM files.
 */

export const SAMPLE_RATE = 16_000;
export const CHUNK_SECONDS = 180;
export const MAX_SECONDS = 30 * 60;

/** Average all channels into one mono track. */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}

/**
 * Chunk boundaries (in samples). Each cut is moved to the quietest 50 ms
 * within the last 5 seconds before the nominal boundary, so a cut rarely
 * lands in the middle of a word.
 */
export function planChunks(samples: Float32Array, rate = SAMPLE_RATE, chunkSeconds = CHUNK_SECONDS): [number, number][] {
  const total = samples.length;
  const step = chunkSeconds * rate;
  const frame = Math.round(rate * 0.05);
  const search = 5 * rate;
  const cuts = [0];
  while (total - cuts[cuts.length - 1] > step) {
    const target = cuts[cuts.length - 1] + step;
    let best = target;
    let bestEnergy = Infinity;
    for (let start = Math.max(cuts[cuts.length - 1] + frame, target - search); start + frame <= target; start += frame) {
      let energy = 0;
      for (let i = start; i < start + frame; i++) energy += samples[i] * samples[i];
      if (energy < bestEnergy) {
        bestEnergy = energy;
        best = start + Math.floor(frame / 2);
      }
    }
    cuts.push(best);
  }
  cuts.push(total);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < cuts.length; i++) if (cuts[i + 1] > cuts[i]) out.push([cuts[i], cuts[i + 1]]);
  return out;
}

/** 16-bit PCM WAV bytes for one mono chunk. */
export function encodeWav(samples: Float32Array, rate = SAMPLE_RATE): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** Decodes a media file's audio track straight to 16 kHz mono. */
export async function decodeToMono(file: Blob): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    return toMono(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)));
  } finally {
    void context.close();
  }
}
