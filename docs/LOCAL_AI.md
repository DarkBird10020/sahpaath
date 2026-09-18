# Local AI test stand-in

Amazon Bedrock returned `ValidationException: Operation not allowed` on every new account we tried, so diagram analysis can be tested with a stand-in until AWS access works. It is used only when AWS is **not** configured.

| Step | AWS path | Test stand-in |
|---|---|---|
| OCR | Textract `DetectDocumentText` | tesseract.js on this machine (free, no key, no limit) |
| Proposal | Bedrock Converse | Google Gemini API free tier (`gemini-3.5-flash-lite` by default) |
| Validation, review, publish | same deterministic code | same deterministic code |

Turn it on by putting `GEMINI_API_KEY=...` in `.env` (git-ignored). `SAHPAATH_GEMINI_MODEL` picks another model; `gemini-3.5-flash` gave "high demand" (HTTP 503) errors during testing. Both the classroom upload and the `/api/v1` pipeline use it. `GET /api/health` reports `analysis: { ocr, model, standIn }`.

## Honesty rules

- Stage details name the engine and say **"Test stand-in, not AWS."** Labels are stored with source `local_ocr`, never `textract`.
- Teacher-visible errors use our own wording ("free-tier limit reached", "rejected the request (HTTP 400)"). Raw provider text is never shown.
- Free-tier content may be used by Google to improve its products. Send only openly licensed or self-made diagrams; the pipeline never sends student data.
- Browser tests set `GEMINI_API_KEY=""`, so they never call Gemini.

## Behaviour notes (tested 2026-09-18)

- OCR uses sparse-text mode and splits lines at arrow and dash runs, because arrows often touch labels. Hyphens inside words ("X-ray") are kept.
- The English language data (~10 MB) downloads once into `.data/tesseract`.
- Gemini rejected `minItems`/`maxItems` in the response schema (HTTP 400), so they are removed before sending; zod still enforces them afterwards.
- One busy/limit retry (HTTP 503/429), and one retry for malformed output, as with Bedrock.
- A self-drawn five-label heart-flow diagram gave five grounded parts, the four correct flow relationships and the full reading order in about 5 seconds. Two labels read with low OCR confidence were flagged for teacher review. This is one test image, not an accuracy measurement.

## Learner AI help (no teacher needed)

With `GEMINI_API_KEY` set, students and other learners get:

| Page / control | What it does | Route |
|---|---|---|
| **Explain a diagram** | Upload any diagram (book page, e-book screenshot). Local OCR reads the labels; Gemini explains the summary, each part, the steps, hard words, and answers an optional question. Each part shows whether its label was actually read from the image. Read aloud. | `POST /api/ai/explain-diagram` |
| **Watch & listen** | Load a video or audio file (lecture, audiobook chapter, max 10 MB). Gemini writes timed captions and picks out hard words; captions follow playback. `.vtt`/`.srt` subtitles load instantly without AI. | `POST /api/ai/transcribe` |
| **Explain a hard word** | Type or select any word. Approved lesson terms return the teacher's definition (no AI call); other words get an AI explanation. | `POST /api/ai/explain-word` |
| **Ask AI now** (Communicate) | Answers from the published lesson first; general knowledge beyond the lesson is flagged. The question and the AI answer go to the teacher's inbox. | `POST /api/ai/ask` |

Every AI answer is labelled "AI explanation, not checked by your teacher". Without a key these routes return a clear "AI help is not configured" message. Rate limits per session: 10 diagrams, 5 recordings, 20 questions, 30 words per minute.
