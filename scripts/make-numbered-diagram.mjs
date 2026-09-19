// Generates a numbered-callout test diagram: a four-stage process, stages
// numbered 1..4 left to right. Pure Node (zlib), no canvas dependency.
// Layout notes from OCR testing: digits in a row at 10x scale read reliably;
// scattered digits, circles and leader lines misread at sparse-text mode.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 800, H = 220;
const glyphs = {
  "1": ["  #  ", " ##  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "],
  "2": [" ### ", "#   #", "    #", "  ## ", " #   ", "#    ", "#####"],
  "3": [" ### ", "#   #", "    #", "  ## ", "    #", "#   #", " ### "],
  "4": ["   # ", "  ## ", " # # ", "#  # ", "#####", "   # ", "   # "],
};
const S = 10; // glyph scale: 5x7 font -> 50x70 px digits

// Light background (240), dark digits (15) — the combination tesseract reads.
const px = Buffer.alloc(W * H * 3, 240);
const set = (x, y, v) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i + 1] = px[i + 2] = v;
};
// Four numbered stages on one baseline, evenly spaced like a process row.
"1234".split("").forEach((d, i) => {
  const g = glyphs[d];
  const x = 90 + i * 160, y = 60;
  for (let r = 0; r < 7; r++)
    for (let c = 0; c < 5; c++)
      if (g[r][c] === "#")
        for (let dy = 0; dy < S; dy++)
          for (let dx = 0; dx < S; dx++) set(x + c * S + dx, y + r * S + dy, 15);
});
// PNG assembly: one row per scanline, filter 0.
const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 3)] = 0;
  px.copy(raw, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3);
}
let crcTable;
function crc32(buf) {
  crcTable ??= (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crcBuf]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(new URL("../docs/samples/numbered-callouts-test.png", import.meta.url), png);
console.log("wrote docs/samples/numbered-callouts-test.png", png.length, "bytes");
