/** Structured JSON logging (CloudWatch-compatible single-line events). */

export type LogLevel = "debug" | "info" | "warn" | "error";
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keys whose values must never be logged. */
const REDACTED_KEYS = new Set([
  "password",
  "token",
  "tokenHash",
  "cookie",
  "authorization",
  "secret",
  "session",
  "base64",
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      out[k] = REDACTED_KEYS.has(k.toLowerCase()) ? "[redacted]" : redact(v, depth + 1);
    return out;
  }
  if (typeof value === "string" && value.length > 2000) return value.slice(0, 2000) + "…";
  return value;
}
export interface LogFields {
  [key: string]: unknown;
}

export class Logger {
  constructor(
    private readonly sink: (line: string) => void = (l) => console.log(l),
    private readonly minLevel: LogLevel = "info",
    private readonly base: LogFields = {},
  ) {}

  child(fields: LogFields): Logger {
    return new Logger(this.sink, this.minLevel, { ...this.base, ...fields });
  }

  private write(level: LogLevel, message: string, fields?: LogFields) {
    if (LEVELS[level] < LEVELS[this.minLevel]) return;
    const merged: LogFields = { ...this.base, ...(fields ?? {}) };
    const event = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(redact(merged) as LogFields),
    };
    this.sink(JSON.stringify(event));
  }

  debug(message: string, fields?: LogFields) { this.write("debug", message, fields); }
  info(message: string, fields?: LogFields) { this.write("info", message, fields); }
  warn(message: string, fields?: LogFields) { this.write("warn", message, fields); }
  error(message: string, fields?: LogFields) { this.write("error", message, fields); }
}

/** Extract safe error fields (name/message) without stack noise by default. */
export function errorFields(error: unknown): LogFields {
  if (error instanceof Error)
    return { errorName: error.name, errorMessage: error.message };
  return { errorName: "Unknown", errorMessage: String(error) };
}
