import { z } from "zod";
export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  method = "GET",
  value?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers:
        value === undefined ? {} : { "Content-Type": "application/json" },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
  } catch {
    throw new Error(
      "Cannot reach the local classroom. Start the server with npm run dev, then retry.",
    );
  }
  const data: unknown = await response.json();
  if (!response.ok)
    throw new Error(z.object({ error: z.string() }).parse(data).error);
  return schema.parse(data);
}
export const okSchema = z.object({ ok: z.boolean() });
/** Base64 of a file without the "data:...;base64," prefix. */
export function fileBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read the file. Choose it again."));
    reader.readAsDataURL(file);
  });
}
