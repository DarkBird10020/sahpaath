# Deterministic validation rules

Feature 4 reference. The validator is pure TypeScript (`shared/domain.ts`) —
**no LLM validates LLM output**. Backend validation is authoritative; the
frontend only displays what these rules produce.

`validateDiagramMap()` from the original prompt is `validateMap()` in
`shared/domain.ts`. Input is the whole diagram map (labels, parts,
relations, flows); output is a structured issue list
(`{ itemId, code, severity, message }`). Errors block approval and
publishing; warnings require a teacher review note.

## Rule catalog

| # | Rule | Code | Severity |
|---|---|---|---|
| 1 | Every part must reference an existing OCR/teacher label id | `unknown_label` | error |
| 2 | Unknown OCR label ids are rejected (same check; grounding also drops them before they ever enter the map) | `unknown_label` | error |
| 3 | Name drift between the source label text and the part name | `name_drift` | warning |
| 4 | Low OCR confidence (label confidence < 85%) | `low_ocr` | warning |
| 5 | Teacher-entered label (no independent OCR source) | `manual_source` | warning |
| 6 | Every relationship must reference non-rejected parts | `dangling` | error |
| 7 | Self-relationships | `self_relation` | error |
| 8 | Duplicate relationships (same kind + endpoints, mirrored `connects_to`) | `duplicate_relation` | error |
| 9 | Contradictory direction (A→B and B→A `flows_to`) | `direction_conflict` | warning |
| 10 | Missing or unknown relationship evidence; endpoint labels must be included | `missing_evidence`, `unknown_evidence`, `incomplete_evidence` | error |
| 11 | Orphan parts (no relationship connects them) | `orphan` | warning |
| 12 | Broken process flows (missing/duplicate steps, no forward relation between consecutive steps) | `broken_step`, `broken_flow`, `duplicate_step` | error |
| 13 | Whole-map JSON schema validation (zod, `.strict()` — unknown fields rejected) | schema parse failure | error |
| 14 | Invalid trust-state transitions | `assertTrustTransition` throws | error |
| 15 | Structured issue output | `issueSchema` | — |
| + | Duplicate ids across labels and content items | `duplicate_id` | error |

## Trust states and transitions (rule 14)

```
ai_proposed → needs_review | validated | teacher_approved | rejected
needs_review → ai_proposed | validated | teacher_approved | rejected
validated → needs_review | teacher_approved | rejected
teacher_approved → ai_proposed | needs_review | rejected
rejected → ai_proposed | needs_review | teacher_approved
```

"published" is a **lesson status**, never an item state: items enter a
published immutable snapshot only as `teacher_approved` (or `rejected`, which
removes them from the snapshot). Nothing may transition into `published`
directly, so no code path can mark AI content "published" without a teacher
decision. Enforced by `assertTrustTransition()` inside `decide()`,
`revalidate()` and the new-version reset.

## Confidence separation

OCR confidence (Textract 0–100, per source label) and model confidence
(0–100, the model's own estimate, optional in the proposal tool schema) are
**separate fields** (`label.confidence` vs `part.modelConfidence` /
`relation.modelConfidence`) and are displayed separately in the teacher
review UI. They are never combined into one score. `null` renders as "Not
measured yet." / "Not provided." — never a fabricated number.

## Grounding

Two layers:

1. **At ingestion** (`groundProposal` in `server/aws.ts`): a proposed part
   survives only if its name matches a real OCR label; relations survive only
   between surviving parts; flows only along surviving forward relations.
   Evidence is attached deterministically from the endpoint labels.
2. **At review** (`itemGrounded` in `shared/domain.ts`): per-item boolean —
   parts ground in their label, relations in non-empty existing evidence
   labels, flows in existing parts. Shown as a "Grounded / Not grounded" chip
   (icon + text, never colour alone).

## Publish gates

Publishing (`publishSnapshot`) fails when: any item lacks an explicit
teacher decision; any error-severity issue exists; no part is approved;
source and license metadata is missing (see `docs/` license gate); or the
lesson is already published. Student serialization (`studentSerialize`)
re-validates and refuses to serve anything not `teacher_approved`.
Concurrency: compare-and-swap on `revision` plus SQLite triggers make
published versions immutable and double-publish/stale-edit impossible (the
local equivalent of DynamoDB conditional writes).

## Approval records

Every teacher decision writes a structured audit event
(`itemId, decision, previousState, newState, actor, timestamp, note`)
alongside the human-readable detail — see `store.audit` and the
`POST /api/lessons/{id}/decision` route.

## Tests

- `tests/domain.test.ts` — fixture validation, blocked approvals, rejection
  cascades, decision resets, publish gating, immutable versions, concurrent
  publish, stale writes, trust transitions, grounding flags, vocabulary.
- `tests/aws.test.ts` — Textract parsing, malformed proposal schema, proposal
  grounding (unknown labels, duplicates, dangling/self relations, broken
  flows), confidence carry-through.
- `tests/e2e/classroom.spec.ts` — publish blocked until reviewed, forged
  approvals rejected, race conditions, audit trail.
