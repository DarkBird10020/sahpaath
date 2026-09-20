# AWS deployment — SahPaath (LIVE)

Updated: 2026-09-20 ~06:45 IST. Architecture (user decision): single same-origin
container — one Node server serves the React SPA + all APIs. No Bedrock (rule 1).
Supabase Auth and Gemini are unchanged. Gemini + Supabase values are configured
and verified live (see below).

## Production URL
http://sahpaath-alb-507640068.ap-south-1.elb.amazonaws.com (HTTPS needs a domain
+ ACM cert on the ALB — see Remaining manual configuration).

## Verified working (real requests, not assumptions)
- /health 200 {"status":"ok"}; SPA 200; assets 200; /api/v1/health
  {"mode":"dynamodb","awsConnected":true}
- Auth: student session OK; wrong teacher password 403; correct password (from
  Secrets Manager) OK; cross-origin write 403; unknown route handled
- **Gemini AI live**: real /api/ai/explain-word calls answered with model text
  (source:"ai", model gemini-3.5-flash-lite) — verified on the deployed task
- **Supabase wired**: URL + JWKS (EC key) reachable; publishable key present in
  the served SPA bundle (verified byte-level); email + Google providers enabled;
  garbage bearer tokens rejected 401 by the API (email-confirmation rate limit
  on the free tier blocked one automated signup attempt — try signup from the
  browser UI, wait a bit if it 429s; browser OAuth login is unaffected)
- DynamoDB: lesson create + list via task-role (069c5852…, 0245be33…)
- S3: presigned POST upload 204; server-side verify + freeze to verified/;
  upload-complete 200 end-to-end (274c8732…, and again post-EFS)
- EFS: efs-init EFS_READY; app booted from /data mount; state survives redeploys
- Rollouts: task def sahpaath-prod:2, service STABLE across 6 deploys

## Fixes made on the way (all tested; typecheck + 246 unit tests pass)
- /health unauthenticated top-level; ALB probes (Host = target IP) answered and
  logged (health_probe_denied events are informational)
- SAHPAATH_BIND=0.0.0.0, SAHPAATH_PUBLIC_HOSTS host allowlist for prod
- DynamoDB adapter: create-path no longer sends unused #rev names; lesson->diagram
  pointer Put no longer carries an impossible not-exists condition (both bugs only
  surface against real DynamoDB)
- kaniko build pod: prepare (aws-cli) -> extract (busybox) -> kaniko, with
  dir:///workspace (three slashes) and S3/ECR creds via task role

## Resources created (region ap-south-1, account 756917284624)
ECR sahpaath; ECS cluster sahpaath; service sahpaath-prod (Fargate 0.25 vCPU /
0.5 GB, 1 task); task def sahpaath-prod (roles: sahpaath-ecs-execution-role,
sahpaath-ecs-task-role); ALB sahpaath-alb + TG sahpaath-tg (HTTP :80); SGs
sahpaath-alb-sg / sahpaath-ecs-sg / sahpaath-build-sg / sahpaath-efs-sg; DynamoDB
sahpaath-core (pk/sk + gsi1, PAY_PER_REQUEST, SSE); S3 sahpaath-prod-756917284624
(private, SSE, TLS-only policy); Secrets sahpaath/prod/app; EFS fs-0dde24911976e4f83
(+3 mount targets) mounted at /data; log group sahpaath-prod (30-day retention);
build pipeline: bucket sahpaath-build-src-756917284624 + role sahpaath-codebuild-role
+ task def sahpaath-kaniko-build (CodeBuild project sahpaath-image exists but is
unusable until the 0-concurrent-builds quota is raised — request submitted).

## Redeploy / rollback / logs
- Redeploy after code changes: `bash deploy/rebuild.sh` (tar -> S3 -> kaniko on
  Fargate -> ECR -> rolling deploy -> health check)
- Rollback: `aws ecs update-service --cluster sahpaath --service sahpaath-prod
  --task-definition sahpaath-prod:<older-revision> --force-new-deployment`
  (revisions retained; previous image tags v1/latest in ECR)
- Logs: `aws logs tail sahpaath-prod --follow --region ap-south-1`
  (streams: web/sahpaath-web/<task>, efs-init/*, kaniko/* for builds)

## Costs (monthly, hackathon scale)
ALB ~$16 + LCU; Fargate ~$4; EFS ~$0.6 (1 GB) + bursting; DynamoDB/S3/ECR
pennies; kaniko build ~$0.03/10 min. No NAT gateway, no RDS, no Bedrock.
The ALB is the only significant fixed cost; deleting it saves ~80%.

## Remaining manual configuration
1. Supabase dashboard (only user step left): add
   http://sahpaath-alb-507640068.ap-south-1.elb.amazonaws.com to Site URL /
   Redirect URLs, and add it to Google OAuth's authorized redirect origins via
   Supabase — then Google login works in production end-to-end
   (verified 2026-09-20: Supabase Site URL is still the localhost:3000 default,
   so OAuth/email callbacks currently bounce there; Supabase->Google leg itself
   works: /authorize 302s to accounts.google.com with the project's client_id)
2. HTTPS: ACM cert (DNS-validated) + ALB :443 listener + optional custom domain;
   then add the final URL to SAHPAATH_PUBLIC_HOSTS and Supabase redirect list
3. Rotate the AWS access key that was pasted into chat
4. Optional: CodeBuild quota (case open) to replace kaniko builds later

## Security posture
No secrets in code or image; all via Secrets Manager -> ECS injection; task role
scoped to one table + two S3 prefixes; execution role scoped to ECR pull + one
secret + EFS mount; S3 private + TLS-only + SSE; SPA served same-origin (no CORS
surface); cross-origin writes refused by design; host allowlist keeps DNS-rebinding
protection; repo scanned — no committed credentials.

## Fixes 2026-09-20 (later session)
- Preview proxy (.freebuff/alb-preview-proxy.cjs) now rewrites Origin/Referer —
  the previewed app behaves exactly like a browser on the ALB URL; the
  "Cross-origin changes are not allowed" banner in the Preview tab is gone
- server/index.ts same-origin write guard now compares HOSTS not schemes
  (safeOriginHost) — survives TLS-terminating proxies (https Origin vs http Host);
  deployed as sahpaath-prod:3, image digest-pinned sha256:4ea7509…
  (verified: same-host https Origin POST 200, foreign Origin POST 403)
- rebuild.sh fixed: retry the kaniko exit-code read (wait tasks-stopped race
  returned empty exitCode -> false BUILD FAILED), and rollouts now register a NEW
  task-def revision pinned to the fresh digest instead of --force-new-deployment
  on a :latest tag (which could silently redeploy the old image)

## 2026-09-20 evening — fixes from reading the production logs
- HTTPS: CloudFront needs account verification, so an API Gateway HTTP API
  (dnde2gq0rg.execute-api.ap-south-1.amazonaws.com, `ANY /{proxy+}` + `ANY /` to
  the ALB) is the HTTPS front door. `SAHPAATH_TRUSTED_ORIGIN_HOSTS` lets its Origin
  write. The SPA redirects the plain-http ELB address to it. API Gateway cuts
  requests at 30 s, which is why diagram analysis now runs in the background.
- Diagram upload / re-analyse return at once with Analysis "waiting"; OCR + Gemini
  run in the server and the Teacher page polls /processing-status. A restart marks
  interrupted analyses stopped instead of waiting forever. Upload had taken 22-58 s
  (OCR 10-25 s on a quarter vCPU, then Gemini 11-33 s).
- Task size raised 0.25 vCPU / 0.5 GB -> 1 vCPU / 2 GB for tesseract OCR
  (about +$27/month; set `cpu`/`memory` back in the task definition to revert).
- Pollers (`src/lib/poll.ts`): one request at a time, paused in hidden tabs,
  backoff up to 30 s, stop after 3 consecutive 401/403. Live captions read one
  session per tick. A 401/403 makes the app re-read its session (another tab may
  have replaced the shared cookie with a different role).
- Server logs the reason for AI/YouTube failures (`upstream_failure`, key redacted)
  and handles SIGTERM (`shutdown`); the container runs node directly, not via npm.
- rebuild.sh read the kaniko exit code with a query that returned nothing, so it
  reported BUILD FAILED after successful builds; fixed.
