# Shared lesson vocabulary

The core differentiator: one teacher approval makes a term canonical everywhere
in the lesson. This is implemented in code, not just in the UI.

## Model

A vocabulary term is not a free-standing entity. **A term is a teacher-approved
diagram part** (see `publishSnapshot` in `shared/domain.ts`):

```ts
{
  id,            // same id as the approved part — the shared identifier
  name,          // canonical term, grounded in an OCR/teacher source label
  definition,    // the part's student-facing description
  labelId,       // source label: grounding evidence
  aliases,       // teacher-managed alternative spellings/phrasings (max 10)
  approvedAt,    // publish time
  approvedBy,    // "local-teacher" in this build
  state: "teacher_approved",
}
```

Aliases are edited per concept in the manual map editor (comma separated) and
travel through the existing map-edit path (`PUT /api/lessons/{id}/map`), which
resets all decisions — an alias change is a content change and must be
re-approved before it reaches students.

## Trust rules (enforced in code)

- Only `teacher_approved` parts become vocabulary (`publishSnapshot` throws
  otherwise; publication requires an explicit decision on every item).
- AI proposals are grounded against real OCR labels (`groundProposal` drops
  ungrounded parts) and never publish directly.
- Student text can never modify canonical vocabulary: caption corrections may
  only replace a phrase with an approved term of the same published version
  (`correctCaption` validates the `termId`); the original text is retained.
- Published versions are immutable (SQLite triggers); editing creates a new
  version, so vocabulary can never silently change under students.

## Surfaces

`getTermSurfaces(termId, published, captions)` (in `shared/vocabulary.ts`)
computes, deterministically, where a term is actually usable right now:

| Surface | True when |
|---|---|
| `explorer` | the approved part exists in the published map |
| `glossary` | the term is in the published vocabulary |
| `audio` | the description is non-empty (browser speech reads it) |
| `captions` | the term or an alias occurs in a stored caption of this version |
| `communicationAnchor` | students can anchor a question to the term |

Speech-recognition custom vocabulary (Transcribe) is deliberately **not** a
surface yet: AWS is deferred. The UI shows it as "AWS deferred" rather than
pretending it exists.

API (any classroom session):

- `GET /api/published/{lessonId}/vocabulary` — approved terms of the current version
- `GET /api/published/{lessonId}/vocabulary/{termId}/surfaces` — surface map (captions computed from real stored captions)

## Matching rules (`matchTranscriptTerms` / `highlightSegments`)

- Whole-term matches only: Unicode-letter/number boundaries prevent matches
  inside other words ("arterytrunk" never matches "trunk").
- Canonical names and aliases are matched, longest surface first, so a full
  canonical term is never split by a shorter alias.
- Every alias match maps back to the one canonical approved term id — the
  caption highlight, glossary entry, explorer node and question anchor stay the
  same concept no matter which wording the transcript used.
- Matching is pure: transcript text never mutates the vocabulary.

## Deviation from the original feature prompt

The prompt suggested CRUD endpoints for vocabulary terms
(`POST/PATCH/approve/reject /vocabulary/{id}`). This build intentionally does
**not** have them: a term's canonical life-cycle *is* the part decision flow
(`POST /api/lessons/{id}/decision`) and publication. A parallel term CRUD API
would create a second source of truth and a path around the trust model.
Aliases are the only teacher-managed extension and they flow through the
existing, decision-resetting map edit.

## Tests

`tests/vocabulary.test.ts` (alias mapping, longest-surface priority,
boundary safety, segment rebuilding, surface computation) and
`tests/domain.test.ts` (alias + approval metadata propagation into the
immutable snapshot and the student serializer).
