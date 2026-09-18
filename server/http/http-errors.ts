import { AppError } from "../core/errors";

export const unsupportedMedia = (message: string) =>
  new AppError("unsupported_media_type", 415, message);

export { forbiddenError, payloadTooLargeError, rateLimitedError, unauthorizedError } from "../core/errors";
