# SahPaath preflight

Date: 2026-09-18. Status: blocked before the account experiment and Phase 1.

## CURRENT STATE

The supplied workspace, `C:\Users\Administrator\Desktop\fir-comit`, was empty, including hidden entries. No AGENTS.md, package.json, lockfile, environment file, application, infrastructure definition, or Git repository was found. No application code has been written.

Node v24.10.0 and npm 11.6.1 are installed. pnpm and yarn command shims exist; their versions and functionality were not checked. No framework or package manager has been selected by an existing project.

No standard AWS config or credentials file was found. AWS credential, profile, region, alternate-config, web-identity and container-credential environment variables checked below were absent. The AWS CLI could not be resolved. This does not establish whether resources exist in an external AWS account.

## WHAT CAN BE REUSED

The installed Node/npm tools and the supplied product requirements. There is no existing application code to reuse.

## WHAT MUST CHANGE

Provide a working AWS CLI and authenticated local profile with a target region before the required live experiment. Then establish a React/TypeScript/Vite project, reproducible lockfile, checks, and infrastructure as code. These are planned changes, not completed implementation.

## WHAT IS MISSING

- AWS CLI access, authenticated profile, target region, account model availability and applied quotas.
- Target teaching languages/locales.
- Clarification of `roughly 510` diagrams: 510 literally, or 5–10?
- All application code, tests, data, deployment, accessibility evidence and evaluation runs.
- Verified Higgsfield connection, generation prices and live balance. User reports 598 remaining credits; none used in this session.

## IMPLEMENTATION PLAN

1. Authenticate locally; run STS and inspect existing stacks/resources without creating resources. Do not place credentials in chat or repository files.
2. Complete account/region checks in AWS_VERIFICATION.md; select exact returned model/profile IDs and verify model-specific image/tool/forced-choice support. Establish demo cost before any billable call.
3. Run the standalone OCR-to-Bedrock experiment described below. Preserve raw outputs, errors, validation findings, actual timing and usage without credentials or private student data.
4. Foundation: strict TypeScript, boundary schemas, test commands, safe configuration and domain trust states. Keep version publication separate from per-item teacher approval so student serialization only includes approved items.
5. Follow PROMPT.md's phase order: infrastructure, upload, Textract, Bedrock, deterministic validator, review, DynamoDB, explorer, Polly, Transcribe, shared vocabulary, communication, accessibility, optional 3D, observability, demo mode, polish.
6. Test approval bypass, invalid references, edits invalidating approvals, concurrent publication, immutable snapshots, role isolation, upload spoofing, service failures and retry/idempotency. Run axe and keyboard passes on major screens, with 3D disabled and narrow/zoomed layouts.
7. Produce evidence-based final audit and all requested documentation. No accessibility or accuracy claim before evidence exists.

## HIGHEST-RISK EXPERIMENT

Question: can an account-enabled model accept a diagram image plus real Textract label IDs through Converse and return schema-valid parts, relations and ordered flow grounded exclusively in those IDs?

Planned input: one self-created, clearly labeled non-medical flow diagram and its actual OCR output. A teacher-reviewed heart diagram follows after the grounding mechanism is established. No generated labels may be substituted for real OCR in this experiment.

Planned gates: validate schema; reject unknown OCR IDs; verify relation endpoints and evidence; flag self-relations, duplicates, directional contradictions, label-name drift, low-confidence labels, orphan parts and broken flow. Schema validity and ID grounding do not prove educational correctness. Teacher approval remains necessary.

Bound calls and output tokens. Permit one repair retry, then an account-verified fallback model, then manual map editing. Record each attempt independently. Inject malformed results locally to test fallback behavior without additional model calls.

**Raw result: NOT RUN.** No model was selected or invoked. No experiment script was written because account and capability prerequisites are unresolved. This is a blocked experiment, not a failed model result.

## RISKS

- Model catalog visibility does not prove invocation permission, entitlement or remaining quota.
- OCR can miss small labels; valid JSON can still contain false educational relationships.
- Manual entries after OCR failure need explicit teacher-entered provenance; they must never be disguised as Textract output. Final schema must distinguish observed OCR labels from teacher-entered labels.
- Regional availability, voice engines, caption languages and costs cannot be inferred from the user's time zone.
- The dataset count materially changes cost and review effort.
- Cached audio and recognition vocabulary need version-specific readiness; approval alone cannot truthfully mean that asynchronous services are ready.
- No browser, keyboard, screen-reader, mobile or performance checks have been run.

## COMMANDS EXECUTED AND OBSERVED OUTPUT

| Command/check | Actual result |
|---|---|
| `Get-Location` | `C:\Users\Administrator\Desktop\fir-comit` |
| `Get-ChildItem -Force` and later `Get-ChildItem -Force -Name` | No entries before documentation was created |
| `rg --files` with filters for AGENTS.md, manifests, locks, prompt, configuration, templates and environment files | No matching files |
| `git status --short` | `fatal: not a git repository (or any of the parent directories): .git` |
| `Get-Command aws,node,npm,pnpm,yarn -ErrorAction SilentlyContinue` | node, npm, pnpm and yarn resolved; aws did not |
| `node --version` | `v24.10.0` |
| `npm.cmd --version` | `11.6.1` |
| `Test-Path` for user `.aws/config` and `.aws/credentials` | `False` for both |
| `aws sts get-caller-identity` | `aws : The term 'aws' is not recognized as the name of a cmdlet, function, script file, or operable program.` |
| Initial `Get-ChildItem Env:` enumeration | `An item with the same key has already been added.` |
| Follow-up individual `[Environment]::GetEnvironmentVariable` presence checks | All checked variables absent; no values printed |

Checked variables: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, AWS_PROFILE, AWS_REGION, AWS_DEFAULT_REGION, AWS_CONFIG_FILE, AWS_SHARED_CREDENTIALS_FILE, AWS_WEB_IDENTITY_TOKEN_FILE, AWS_CONTAINER_CREDENTIALS_RELATIVE_URI, AWS_CONTAINER_CREDENTIALS_FULL_URI.

Install, typecheck, test and build: **NOT RUN** because no manifest, lockfile, project or scripts exist. No dependency installation was attempted. These are not passing checks.

## PHASE REPORT

COMPLETED: Workspace inspection, tool checks, attempted STS check, preliminary official-documentation research, saved build brief and implementation plan. Preflight itself remains incomplete.

FILES CHANGED: PROMPT.md, docs/PREFLIGHT.md, docs/AWS_VERIFICATION.md, docs/COSTS.md.

AWS SERVICES USED: None successfully called. STS attempt failed locally before a request could be made. No resources created.

TESTS EXECUTED: No application tests; diagnostic commands and their outputs are listed above.

TEST RESULTS: Node/npm available; empty workspace; AWS CLI unavailable; standard credentials/configuration absent.

KNOWN LIMITATIONS: UNTESTED: all product behavior. Account capabilities, cost estimate and grounding experiment remain blocked. No deployment, generated assets or measured product metrics.

NEXT PHASE: Resolve AWS access and missing scope, finish verification/costs, execute the grounding experiment, then begin Phase 1.
