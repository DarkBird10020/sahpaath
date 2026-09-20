#!/usr/bin/env bash
#
# SahPaath — rebuild the image and redeploy (one command, no local Docker).
# Pipeline: source tar -> S3 -> kaniko build on Fargate -> ECR -> ECS rollout.
# Usage: bash deploy/rebuild.sh
set -euo pipefail

AWS="${AWS_BIN:-/c/Users/aaayu/AppData/Local/Programs/Amazon/AWSCLIV2/aws.exe}"
REGION="ap-south-1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_BUCKET="sahpaath-build-src-756917284624"
TASK_FAMILY="sahpaath-kaniko-build"
BUILD_SUBNET="subnet-0d83b92fc4dc4cc6f"
BUILD_SG="sg-08acbcd0b0efc9576"

cd "$ROOT"

echo "== 1. Repack source (secrets, logs, build output excluded) =="
python - <<'EOF'
import tarfile, os
EXCLUDE_DIRS = {"node_modules",".git",".data","dist","test-results","playwright-report",".freebuff",".kilo",".art",".pipeline-build",".aws-sam","skills-scroll-world","docs","deploy"}
with tarfile.open("../sahpaath-source.tar.gz","w:gz") as t:
    for root,dirs,files in os.walk("."):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in files:
            if f.endswith(".log") or f == ".env": continue
            p = os.path.join(root,f)
            t.add(p, arcname=os.path.relpath(p,"."))
print("tar OK")
EOF

echo "== 2. Upload to S3 =="
"$AWS" s3 cp ../sahpaath-source.tar.gz "s3://$SRC_BUCKET/source.tar.gz" --region "$REGION" | tail -1

echo "== 3. Build image on Fargate (kaniko) =="
TASK_ARN=$("$AWS" ecs run-task --region "$REGION" --cluster sahpaath --task-definition "$TASK_FAMILY" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$BUILD_SUBNET],securityGroups=[$BUILD_SG],assignPublicIp=ENABLED}" \
  --query "tasks[0].taskArn" --output text)
TASK_ID="${TASK_ARN##*/}"
echo "build task: $TASK_ID"
echo "watch: aws logs tail sahpaath-prod --log-stream-names kaniko/kaniko/$TASK_ID --follow --region $REGION"
"$AWS" ecs wait tasks-stopped --region "$REGION" --cluster sahpaath --tasks "$TASK_ID"
# describe-tasks can race the stop transition — retry until exitCode is exposed.
EXIT=""
for _ in 1 2 3 4 5 6; do
  EXIT=$("$AWS" ecs describe-tasks --region "$REGION" --cluster sahpaath --tasks "$TASK_ID" \
    --query "tasks[0].containers[?name=='kaniko'][0].exitCode" --output text)
  [ -n "$EXIT" ] && [ "$EXIT" != "None" ] && break
  sleep 5
  EXIT=""
done
if [ "$EXIT" != "0" ]; then
  echo "BUILD FAILED (kaniko exit ${EXIT:-unknown}). Logs:"
  "$AWS" logs tail sahpaath-prod --region "$REGION" --log-stream-names "kaniko/kaniko/$TASK_ID" --since 30m 2>/dev/null | tail -30
  exit 1
fi
echo "image pushed to ECR"

echo "== 4. Roll the ECS service (new revision pinned to the fresh digest) =="
DIGEST=$("$AWS" ecr describe-images --repository-name sahpaath --region "$REGION" \
  --query "sort_by(imageDetails,&imagePushedAt)[-1].imageDigest" --output text)
export AWS_BIN="$AWS" SB_REGION="$REGION" SB_DIGEST="$DIGEST"
NEWREV=$(python - <<'EOF'
import json, subprocess, os
aws, region, digest = os.environ["AWS_BIN"], os.environ["SB_REGION"], os.environ["SB_DIGEST"]

def run(args):
    r = subprocess.run([aws] + args, capture_output=True, text=True)
    if r.returncode != 0: raise SystemExit(f"FAILED: {args[0]}: {r.stderr[:400]}")
    return r.stdout

current = run(["ecs", "describe-services", "--cluster", "sahpaath", "--services", "sahpaath-prod",
               "--region", region, "--query", "services[0].taskDefinition", "--output", "text"]).strip()
family, revision = current.rsplit(":", 1)
family = family.rsplit("/", 1)[1]
td = json.loads(run(["ecs", "describe-task-definition", "--task-definition", f"{family}:{revision}",
                     "--region", region]))["taskDefinition"]
image = f"756917284624.dkr.ecr.{region}.amazonaws.com/sahpaath@{digest}"
for c in td["containerDefinitions"]:
    if c["name"] in ("sahpaath-web", "web"):
        c["image"] = image
for k in ["taskDefinitionArn", "revision", "status", "requiresAttributes", "compatibilities",
          "registeredAt", "registeredBy", "enableFaultInjection"]:
    td.pop(k, None)
out = run(["ecs", "register-task-definition", "--family", family, "--region", region,
           "--cli-input-json", json.dumps(td)])
print(json.loads(out)["taskDefinition"]["revision"])
EOF
)
echo "rolled task def: sahpaath-prod:$NEWREV (image @${DIGEST:0:20}...)"
"$AWS" ecs update-service --region "$REGION" --cluster sahpaath --service sahpaath-prod \
  --task-definition "sahpaath-prod:$NEWREV" --query "service.serviceName" --output text >/dev/null
"$AWS" ecs wait services-stable --region "$REGION" --cluster sahpaath --services sahpaath-prod
echo "service STABLE"

echo "== 5. Verify =="
curl -s -m 10 http://sahpaath-alb-507640068.ap-south-1.elb.amazonaws.com/health
echo
echo "DONE: http://sahpaath-alb-507640068.ap-south-1.elb.amazonaws.com"
