import { describe, it, expect } from "vitest";
import { encodeWav, planChunks, toMono, SAMPLE_RATE } from "../src/audioChunks";

/** A tone ("speech") with silent gaps at the given seconds. */
function recording(seconds: number, silentAt: number[] = []) {
  const s = new Float32Array(seconds * SAMPLE_RATE);
  for (let i = 0; i < s.length; i++) s[i] = 0.5 * Math.sin(i / 7);
  for (const at of silentAt) s.fill(0, Math.round((at - 0.2) * SAMPLE_RATE), Math.round((at + 0.2) * SAMPLE_RATE));
  return s;
}

describe("Splitting long recordings", () => {
  it("keeps a short recording as one part", () => {
    expect(planChunks(recording(60))).toEqual([[0, 60 * SAMPLE_RATE]]);
  });
  it("splits a 4 min 10 s recording into contiguous parts at quiet moments", () => {
    const audio = recording(250, [177]);
    const parts = planChunks(audio);
    expect(parts).toHaveLength(2);
    expect(parts[0][0]).toBe(0);
    expect(parts.at(-1)![1]).toBe(audio.length);
    for (let i = 1; i < parts.length; i++) expect(parts[i][0]).toBe(parts[i - 1][1]);
    // The cut lands in the silent gap at 177 s, not at the 180 s mark.
    expect(Math.abs(parts[0][1] / SAMPLE_RATE - 177)).toBeLessThan(0.25);
  });
  it("covers a 30-minute lecture without gaps", () => {
    const audio = recording(30 * 60);
    const parts = planChunks(audio);
    // Cuts move up to 5 s earlier to find quiet, so a short last part can appear.
    expect(parts.length).toBeGreaterThanOrEqual(10);
    expect(parts.length).toBeLessThanOrEqual(11);
    expect(parts.reduce((sum, [a, b]) => sum + (b - a), 0)).toBe(audio.length);
    expect(Math.max(...parts.map(([a, b]) => (b - a) / SAMPLE_RATE))).toBeLessThanOrEqual(180);
  });
});

describe("Speech-quality WAV", () => {
  it("writes a valid 16 kHz mono 16-bit header and clamps samples", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]));
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    expect([2, 3, 4, 5].map((i) => view.getInt16(44 + (i - 2) * 2, true))).toEqual([0, 32767, -32768, 32767]);
    // About 1.9 MB per minute: a 3-minute part stays well under the upload limit.
    expect(encodeWav(new Float32Array(180 * SAMPLE_RATE)).length).toBeLessThan(6_000_000);
  });
  it("mixes stereo to mono", () => {
    expect([...toMono([new Float32Array([1, 0]), new Float32Array([0, 1])])]).toEqual([0.5, 0.5]);
  });
});
