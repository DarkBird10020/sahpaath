# SahPaath

**Same lesson. Your way in.** One teacher-reviewed lesson connects a diagram explorer, transcript vocabulary, and classroom questions.

This is a working **local classroom application**. AWS is deliberately deferred at the user's request. SQLite stores lessons, immutable publications, decisions, captions, questions, and audit events. Demo label extraction and diagram proposals are authored fixtures marked **Demo simulation**. Uploaded diagrams use the manual map editor. There is no live speech recognition or cloud OCR in this build.

## Run locally

Requires Node.js 24 or newer.

```powershell
npm install
npm run dev
```

Open http://127.0.0.1:5173. Select **Open classroom**, then use the development teacher password `sahpaath-local`. Students can enter anonymously. To change the password, set `SAHPAATH_TEACHER_PASSWORD` in the shell before starting the server. The server does not automatically load `.env` files. Do not deploy this development authentication scheme to the internet.

```powershell
$env:SAHPAATH_TEACHER_PASSWORD = 'your-local-password'
npm run dev
```

For a compiled frontend: `npm run build`, then `npm start`. All application data remains in `.data/` (gitignored). `SAHPAATH_DATA_DIR` can select another local storage directory. The server binds to the loopback interface; separate devices cannot join this local-only build.

## Three-minute walkthrough

1. Enter as teacher and choose the heart sample. The pipeline distinguishes simulated extraction/proposal from actual validation and review.
2. Repair the relationship with missing evidence. Review every part, relationship, and process flow; add a note for warnings and explicitly approve or reject each item.
3. Publish. An unresolved decision blocks publication. Editing a published lesson creates a new draft version.
4. Open **Explore**. Use the concept tree's arrow keys or the conventional concept selector. Read descriptions, follow the process, and optionally use browser speech.
5. Open **Captions** and load the sample transcript. It is explicitly a loaded transcript, not a live stream. Approved terms link back to the same concepts.
6. Ask about a concept. Open the teacher inbox to see and acknowledge the saved question.

Uploaded PNG/JPEG files instead enter the manual editor. Add source labels and descriptions, review the manual-entry warnings, approve, and publish.

## Checks

```powershell
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run evaluate
```

Browser tests use a separate database under `.data/e2e` and port 5174. Axe reports and the Playwright summary are written to `docs/reports`. Evaluation without a measured run returns null metrics; the UI displays **Not measured yet.**

## Boundaries

- Teacher review is enforced by the backend, not just button state. SQLite enforces immutable publication rows and unique versions.
- Browser speech availability and voices depend on the browser/OS. No Polly audio or cached cloud synthesis is claimed.
- Transcript import, notes, vocabulary highlighting, and teacher-confirmed corrections work locally. Corrections retain the original text.
- Accessibility checks cover selected automated rules and keyboard scenarios. Real screen-reader testing and broad device testing remain outstanding.
- The optional 3D concept graph is lazy-loaded and has a text/tree equivalent. It is disabled by default.
- The supplied scroll-world skill is being applied to the introduction. The initial generated artwork was rejected by the user; natural photographic stills are now in review. The final video sequence is not delivered.

See [architecture](docs/ARCHITECTURE.md), [accessibility](docs/ACCESSIBILITY.md), [evaluation](docs/EVALUATION.md), [AWS verification](docs/AWS_VERIFICATION.md), [costs](docs/COSTS.md), and [asset credits](CREDITS.md).
