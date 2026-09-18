/** Magic-byte sniffing: never trust extension or client MIME. */
export function imageType(bytes: Buffer): "image/png" | "image/jpeg" | null {
  if (bytes.length < 24 || bytes.length > 5_000_000) return null;
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.subarray(12, 16).toString() === "IHDR"
  )
    return "image/png";
  if (
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255 &&
    bytes.at(-2) === 255 &&
    bytes.at(-1) === 217
  )
    return "image/jpeg";
  return null;
}
