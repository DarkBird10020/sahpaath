# SahPaath

**Same lesson. Your way in.** One teacher-reviewed lesson connects a diagram explorer, transcript vocabulary, and classroom questions.

## 🔗 Live preview

**https://dnde2gq0rg.execute-api.ap-south-1.amazonaws.com/#/home**

Open the link to see the landing story. Sign in with Google or email to open the classroom (teacher workspace, explorer, captions, questions).

This is a working **local classroom application**, with an optional real DiagramSense AWS processing backend. SQLite stores classroom drafts, immutable publications, decisions, captions, questions and audit events. Local sample extraction/proposals remain authored fixtures marked **Demo simulation**; unconfigured uploads use the manual editor. The optional cloud path uses private S3, Step Functions, Textract, Bedrock and DynamoDB, and returns drafts for teacher review. See [DiagramSense setup and contracts](docs/CLASSROOM_DIAGRAM_PIPELINE.md). Live cloud execution/model compatibility remain **UNVERIFIED**; live captions use browser speech recognition or typed lines; Amazon Transcribe is not wired.

A second, versioned backend lives under `/api/v1` (layered services, SQLite/memory/DynamoDB repositories, signed upload grants, Textract/Bedrock adapters). It runs alongside the classroom API and shares its login. See the [API contract](docs/API_CONTRACT.md), [v1 diagram pipeline](docs/DIAGRAM_PIPELINE.md), [DynamoDB layout](docs/DYNAMODB.md) and [backend audit](docs/BACKEND_AUDIT.md).

Without AWS, diagram analysis can be tested with a clearly labelled stand-in: local OCR (tesseract.js) plus the Gemini API free tier. See [local AI test stand-in](docs/LOCAL_AI.md).

## Run locally

Requires Node.js 24 or newer.

```powershell
npm install
npm run dev
```

Open http://127.0.0.1:5173. Select **Open classroom**, then use the development teacher password `sahpaath-local`. Students can enter anonymously. To change the password, set `SAHPAATH_TEACHER_PASSWORD` in the shell before starting the server. The server loads `.env` when present; existing shell variables take precedence. Do not deploy this development authentication scheme to the internet.

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

Without AWS configuration, uploaded PNG/JPEG files enter the manual editor. Add source labels and descriptions, review the manual-entry warnings, approve, and publish.

## Checks

```powershell
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run evaluate
```

Browser tests start from an empty database under `.data/e2e` on port 5174. Axe reports and the Playwright summary are written to `docs/reports`. Evaluation without a measured run returns null metrics; the UI displays **Not measured yet.**

The same build, unit tests and browser tests run on GitHub for every push to
`main` and every pull request (`.github/workflows/checks.yml`), so a change that
breaks the landing page, the navigation or the trust model shows up as a failed
check rather than in someone's browser. When a check fails, the run's
`playwright-report` artifact holds the trace. Nothing in CI calls an AI
provider: the Playwright config blanks `GEMINI_API_KEY`.

## Boundaries

- Teacher review is enforced by the backend, not just button state. SQLite enforces immutable publication rows and unique versions.
- Browser speech availability and voices depend on the browser/OS. No Polly audio or cached cloud synthesis is claimed.
- Transcript import, notes, vocabulary highlighting, and teacher-confirmed corrections work locally. Corrections retain the original text.
- Accessibility checks cover selected automated rules and keyboard scenarios. Real screen-reader testing and broad device testing remain outstanding.
- The optional 3D concept graph is lazy-loaded and has a text/tree equivalent. It is disabled by default.
- The supplied scroll-world skill is being applied to the introduction. The initial generated artwork was rejected by the user; natural photographic stills are now in review. The final video sequence is not delivered.

See [architecture](docs/ARCHITECTURE.md), [shared vocabulary](docs/SHARED_VOCABULARY.md), [ClassCaption](docs/CLASSCAPTION.md), [guided demo](docs/DEMO.md), [validation rules](docs/VALIDATION.md), [accessibility](docs/ACCESSIBILITY.md), [evaluation](docs/EVALUATION.md), [AWS verification](docs/AWS_VERIFICATION.md), [costs](docs/COSTS.md), [deployment](docs/DEPLOYMENT.md), and [asset credits](CREDITS.md).
