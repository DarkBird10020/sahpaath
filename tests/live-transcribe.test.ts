import { expect, it } from "vitest";
import { downsample, rms, SILENCE_RMS, wavBase64 } from "../src/lib/liveTranscribe";

it("downsamples 48 kHz microphone audio to 16 kHz speech audio", () => {
  const out = downsample(new Float32Array(48_000).fill(0.5), 48_000);
  expect(out.length).toBe(16_000);
  expect(out[100]).toBeCloseTo(0.5);
  expect(downsample(new Float32Array(10), 8_000).length).toBe(10);
});

it("treats room noise as silence and speech-level audio as speech", () => {
  expect(rms(new Float32Array(1000).fill(0.001))).toBeLessThan(SILENCE_RMS);
  expect(rms(new Float32Array(1000).fill(0.1))).toBeGreaterThan(SILENCE_RMS);
});

it("encodes a WAV the transcription endpoint accepts", () => {
  const bytes = Buffer.from(wavBase64(new Float32Array(16_000)), "base64");
  expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
  expect(bytes.subarray(8, 12).toString()).toBe("WAVE");
  expect(bytes.length).toBe(44 + 16_000 * 2);
});
