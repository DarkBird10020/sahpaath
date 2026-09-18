/** Typed application errors with stable codes; HTTP mapping lives in the API layer. */

export type ErrorCode =
  | "validation_failed"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "revision_conflict"
  | "immutable"
  | "trust_transition"
  | "payload_too_large"
  | "unsupported_media_type"
  | "rate_limited"
  | "internal";

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const validationError = (message: string, details?: unknown) =>
  new AppError("validation_failed", 400, message, details);
export const unauthorizedError = (message = "Sign in to continue.") =>
  new AppError("unauthorized", 401, message);
export const forbiddenError = (message = "You do not have access to this resource.") =>
  new AppError("forbidden", 403, message);
export const notFoundError = (message = "This resource was not found.") =>
  new AppError("not_found", 404, message);
export const conflictError = (message: string) =>
  new AppError("conflict", 409, message);
export const revisionConflictError = (message: string) =>
  new AppError("revision_conflict", 409, message);
export const immutableError = (message: string) =>
  new AppError("immutable", 409, message);
export const payloadTooLargeError = (message: string) =>
  new AppError("payload_too_large", 413, message);
export const rateLimitedError = (message: string) =>
  new AppError("rate_limited", 429, message);

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
