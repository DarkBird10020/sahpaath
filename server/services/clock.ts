import { randomUUID } from "node:crypto";
import type { EntityId } from "../../shared/model";

/** Time + id helpers (isolated for deterministic tests). */
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function genId(): EntityId {
  return randomUUID() as EntityId;
}

export { newId } from "../core/ids";
