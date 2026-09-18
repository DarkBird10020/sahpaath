import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { AppError, isAppError } from "../core/errors";
import { errorFields, type Logger } from "../core/logger";

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  log: Logger;
}

export type Handler = (ctx: RequestContext) => Promise<unknown> | unknown;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

/** Compile "/api/lessons/:id/publish" into a matchable pattern. */
function compile(path: string): { pattern: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const source = path
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        paramNames.push(segment.slice(1));
        return "([\\w-]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { pattern: new RegExp(`^${source}$`), paramNames };
}

export class Router {
  private readonly routes: Route[] = [];

  constructor(private readonly log: Logger) {}

  add(method: string, path: string, handler: Handler): this {
    const { pattern, paramNames } = compile(path);
    this.routes.push({ method: method.toUpperCase(), pattern, paramNames, handler });
    return this;
  }

  get(path: string, handler: Handler) { return this.add("GET", path, handler); }
  post(path: string, handler: Handler) { return this.add("POST", path, handler); }
  put(path: string, handler: Handler) { return this.add("PUT", path, handler); }
  delete(path: string, handler: Handler) { return this.add("DELETE", path, handler); }

  async dispatch(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const method = (req.method || "GET").toUpperCase();
    const started = performance.now();
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = route.pattern.exec(url.pathname);
      if (!match) continue;
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => (params[name] = match[i + 1]));
      const log = this.log.child({ method, path: url.pathname });
      try {
        const result = await route.handler({ req, res, url, params, log });
        if (result !== undefined && !res.writableEnded) {
          const status = method === "POST" ? 201 : 200;
          json(res, result, status);
        }
        log.info("request", { status: res.statusCode, durationMs: round(performance.now() - started) });
        return true;
      } catch (error) {
        const mapped = toErrorResponse(error);
        json(res, mapped.body, mapped.status);
        if (mapped.status >= 500) log.error("request_failed", { ...errorFields(error), status: mapped.status });
        else log.warn("request_rejected", { status: mapped.status, ...errorFields(error) });
        return true;
      }
    }
    return false;
  }
}

export function toErrorResponse(error: unknown): { status: number; body: { error: string; code: string; details?: unknown } } {
  if (isAppError(error))
    return {
      status: error.status,
      body: { error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) },
    };
  if (error instanceof z.ZodError)
    return {
      status: 400,
      body: {
        error: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        code: "validation_failed",
        details: error.issues,
      },
    };
  return {
    status: 500,
    body: { error: "Request failed. Retry or reload.", code: "internal" },
  };
}

export function json(res: ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}

const round = (ms: number) => Math.round(ms * 100) / 100;

export { AppError };
