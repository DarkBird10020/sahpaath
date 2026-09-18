/**
 * Trust states and the legal state-transition machine.
 *
 * CORE TRUST PRINCIPLE: AI proposes -> deterministic code validates ->
 * teacher approves -> student uses. Transitions are validated here
 * (backend), never trusted from the frontend.
 *
 * ai_proposed -> needs_review | validated
 * needs_review -> validated | teacher_approved | rejected
 * validated -> teacher_approved | rejected | needs_review (regression on revalidation)
 * teacher_approved -> needs_review (dependency invalidation) | rejected
 * published (terminal; only on immutable version rows)
 * rejected -> needs_review (re-opened when a rejected item is edited back in)
 */
export const TRUST_STATES = [
  "ai_proposed",
  "needs_review",
  "validated",
  "teacher_approved",
  "published",
  "rejected",
] as const;

export type TrustState = (typeof TRUST_STATES)[number];

/** States a content item may legally move from -> to. */
export const TRUST_TRANSITIONS: Record<TrustState, readonly TrustState[]> = {
  ai_proposed: ["needs_review", "validated", "rejected"],
  needs_review: ["validated", "teacher_approved", "rejected"],
  validated: ["teacher_approved", "rejected", "needs_review"],
  teacher_approved: ["needs_review", "rejected", "published"],
  published: [],
  rejected: ["needs_review"],
};

export class TrustTransitionError extends Error {
  constructor(
    readonly from: TrustState,
    readonly to: TrustState,
    readonly itemId: string,
  ) {
    super(
      `Illegal trust transition for ${itemId}: ${from} -> ${to}. Allowed: ${TRUST_TRANSITIONS[from].join(", ") || "none"}.`,
    );
    this.name = "TrustTransitionError";
  }
}

export function canTransition(from: TrustState, to: TrustState): boolean {
  return TRUST_TRANSITIONS[from].includes(to);
}

/** Throws TrustTransitionError when the move is illegal. */
export function assertTransition(
  itemId: string,
  from: TrustState,
  to: TrustState,
): void {
  if (!canTransition(from, to)) throw new TrustTransitionError(from, to, itemId);
}

export type ReviewDecision = "approve" | "reject";

/** Teacher decision -> target state, validated against the current state. */
export function targetStateFor(
  itemId: string,
  current: TrustState,
  decision: ReviewDecision,
): TrustState {
  const to: TrustState = decision === "approve" ? "teacher_approved" : "rejected";
  assertTransition(itemId, current, to);
  return to;
}

/** States that may flow into the deterministic validator (teacher decision phase). */
export const REVIEWABLE_STATES: readonly TrustState[] = [
  "ai_proposed",
  "needs_review",
  "validated",
];
