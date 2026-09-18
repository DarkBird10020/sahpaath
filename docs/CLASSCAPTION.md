# ClassCaption

Live lesson captions tied to the published lesson vocabulary. Captions support, and do not replace, Indian Sign Language interpretation.

## Model

- **Caption session**: one per lesson at a time, bound to the latest published version. `source` is shown to students: `browser_speech`, `typed`, `demo_script` (labelled **Demo simulation**), or `transcribe` (reserved; rejected until Amazon Transcribe streaming is verified).
- **Segment**: a *final* line stored exactly as heard, with `startMs`/`endMs` from session start and `matchedTerms` beside it. Interim (partial) text is held in memory for display only and is never stored.
- **Term hits** (`shared/vocabulary.ts → matchCaptionTerms`): `exact`, `alias`, or `near_spelling`. A near spelling ("pulmonary artary") is accepted only when the approved surface has 6+ characters, every word starts with the same letter, and the edit distance is at most one per 8 characters. The text is never rewritten; the UI shows “Heard ‘…’ · matched to approved term …”. Teacher corrections of loaded transcripts still go through the existing correction flow, which keeps the original.

## API

| Method | Route | Who |
|---|---|---|
| POST | `/api/caption-sessions` `{lessonId, source}` | teacher (returns the live session if one exists) |
| GET | `/api/caption-sessions?lessonId=` | any session (published version only) |
| GET | `/api/caption-sessions/{id}` → `{session, partial, segments}` | any session |
| POST | `/api/caption-sessions/{id}/segments` `{text, isFinal, startMs?, endMs?}` | teacher |
| GET | `/api/caption-sessions/{id}/search?q=` or `?termId=` | any session |
| GET | `/api/caption-sessions/{id}/export` → text with timestamps and a term index | any session |
| POST | `/api/caption-sessions/{id}/end` | teacher |
| POST | `/api/caption-sessions/{id}/credentials` | teacher → **503** until Transcribe is configured |

## Recognition sources

- **Browser speech recognition** (Chrome/Edge `SpeechRecognition`, `en-IN`): the browser's own service, not AWS. Chrome sends audio to Google; the UI says so.
- **Typed captions**: a teacher or assistant types lines live.
- **Sample lecture**: four scripted lines, one with a misheard term, posted through the real API. Labelled Demo simulation.
- **Amazon Transcribe streaming: UNVERIFIED / not wired.** It needs a Cognito identity pool whose role allows only the streaming action, a custom vocabulary built from approved terms (format in AWS_VERIFICATION.md §6), and a live test. Broad credentials are never sent to the browser.
