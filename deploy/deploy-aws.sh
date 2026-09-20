#!/usr/bin/env bash
#
# SahPaath — AWS deployment (single same-origin container on ECS Fargate).
#
# Idempotent: every step checks before it creates. Safe to re-run.
# Prerequisites:
#   * AWS CLI v2 configured (aws on PATH, or set AWS_BIN=/path/to/aws.exe)
#     with permissions for: ecs, elbv2, ec2 (network), dynamodb, s3,
#     iam (create/attach/pass role), logs, secretsmanager, ecr.
#   * Image already pushed to $ECR_REPO (see deploy/buildspec.yml).
# Region: ap-south-1 (default VPC, 3 public subnets — discovered 2026-09-20).
set -euo pipefail

AWS="${AWS_BIN:-aws}"
REGION="${AWS_REGION:-ap-south-1}"
ACCOUNT_ID="756917284624"
VPC_ID="vpc-011424ab04135e48d"
# Subnets are discovered from the default VPC at run time (no hardcoded IDs).
SUBNETS=$("$AWS" ec2 describe-subnets --region "$REGION" --filters Name=vpc-id,Values="$VPC_ID" --query "Subnets[].SubnetId" --output text | tr '\t' ' ' | xargs)
CLUSTER="sahpaath"
SERVICE="sahpaath-prod"
FAMILY="sahpaath-prod"
ECR_REPO="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/sahpaath"
IMAGE_TAG="${IMAGE_TAG:-latest}"
DDB_TABLE="sahpaath-core"
APP_BUCKET="sahpaath-prod-$ACCOUNT_ID"
LOG_GROUP="sahpaath-prod"
SECRET_NAME="sahpaath/prod/app"
EXEC_ROLE="sahpaath-ecs-execution-role"
TASK_ROLE="sahpaath-ecs-task-role"
TG_NAME="sahpaath-tg"
SG_ALB_NAME="sahpaath-alb-sg"
SG_ECS_NAME="sahpaath-ecs-sg"
ALB_NAME="sahpaath-alb"

R="--region $REGION --output text"
have() { "$@" >/dev/null 2>&1; }
step() { echo; echo "== $1 =="; }
# iam:GetRole is not granted; ListRoles is.
role_exists() { "$AWS" iam list-roles --query "Roles[?RoleName=='$1'].RoleName" --output text 2>/dev/null | grep -q .; }
role_arn() { "$AWS" iam list-roles --query "Roles[?RoleName=='$1'].Arn" --output text 2>/dev/null; }
# ECS secret injection requires the full secret ARN (with the random suffix).
SECRET_ARN=$("$AWS" secretsmanager describe-secret --region "$REGION" --secret-id "$SECRET_NAME" --query ARN --output text)

step "0. Identity check"
"$AWS" sts get-caller-identity $R --query Account

step "1. DynamoDB table ($DDB_TABLE: pk HASH, sk RANGE, GSI gsi1)"
if have "$AWS" dynamodb describe-table --region "$REGION" --table-name "$DDB_TABLE"; then
  echo "exists, skipping"
else
  "$AWS" dynamodb create-table --region "$REGION" \
    --table-name "$DDB_TABLE" \
    --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S AttributeName=gpk,AttributeType=S AttributeName=gsk,AttributeType=S \
    --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
    --global-secondary-indexes '[{"IndexName":"gsi1","KeySchema":[{"AttributeName":"gpk","KeyType":"HASH"},{"AttributeName":"gsk","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
    --billing-mode PAY_PER_REQUEST \
    --sse-specification Enabled=true \
    --tags Key=project,Value=sahpaath >/dev/null
  echo "created; waiting active..."
  "$AWS" dynamodb wait table-exists --region "$REGION" --table-name "$DDB_TABLE"
fi

step "2. S3 bucket ($APP_BUCKET, private)"
if "$AWS" s3api head-bucket --bucket "$APP_BUCKET" >/dev/null 2>&1; then
  echo "exists, skipping"
else
  "$AWS" s3api create-bucket --bucket "$APP_BUCKET" \
    --create-bucket-configuration LocationConstraint="$REGION" --region "$REGION" >/dev/null
  "$AWS" s3api put-public-access-block --bucket "$APP_BUCKET" \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true --region "$REGION"
  "$AWS" s3api put-bucket-encryption --bucket "$APP_BUCKET" \
    --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' --region "$REGION"
  "$AWS" s3api put-bucket-policy --bucket "$APP_BUCKET" --region "$REGION" --policy '{
    "Version":"2012-10-17",
    "Statement":[{"Sid":"DenyInsecure","Effect":"Deny","Principal":"*","Action":"s3:*",
      "Resource":["arn:aws:s3:::'"$APP_BUCKET"'","arn:aws:s3:::'"$APP_BUCKET"'/*"],
      "Condition":{"Bool":{"aws:SecureTransport":"false"}}}]}'
  echo "created, encrypted, public access blocked"
fi

step "3. Secrets Manager ($SECRET_NAME)"
if have "$AWS" secretsmanager describe-secret --region "$REGION" --secret-id "$SECRET_NAME"; then
  echo "exists; update values only via: aws secretsmanager put-secret-value --secret-id $SECRET_NAME --secret-string '{...}'"
else
  TP=$(openssl rand -hex 16)
  UT=$(openssl rand -hex 32)
  "$AWS" secretsmanager create-secret --region "$REGION" --name "$SECRET_NAME" \
    --description "SahPaath production secrets (teacher password, upload token, Gemini, Supabase)" \
    --secret-string "{\"SAHPAATH_TEACHER_PASSWORD\":\"$TP\",\"SAHPAATH_UPLOAD_TOKEN_SECRET\":\"$UT\",\"GEMINI_API_KEY\":\"REPLACE_ME\",\"SUPABASE_URL\":\"REPLACE_ME\",\"SUPABASE_JWKS_URL\":\"REPLACE_ME\",\"SUPABASE_PUBLISHABLE_KEY\":\"REPLACE_ME\"}" >/dev/null
  echo "created with random teacher password + upload token; GEMINI_API_KEY and Supabase values are placeholders — fill them in the console or put-secret-value"
fi

step "4. IAM roles"
if role_exists "$EXEC_ROLE"; then
  echo "$EXEC_ROLE exists (ensuring policies)"
else
  TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
  "$AWS" iam create-role --role-name "$EXEC_ROLE" --assume-role-policy-document "$TRUST" >/dev/null
  echo "created execution role"
fi
"$AWS" iam attach-role-policy --role-name "$EXEC_ROLE" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy >/dev/null 2>&1 || true
"$AWS" iam put-role-policy --role-name "$EXEC_ROLE" --policy-name read-sahpaath-secret --policy-document '{
  "Version":"2012-10-17",
  "Statement":[{"Effect":"Allow","Action":["secretsmanager:GetSecretValue"],
    "Resource":"arn:aws:secretsmanager:'"$REGION"':'"$ACCOUNT_ID"':secret:sahpaath/prod/app-*"}]}' >/dev/null 2>&1 || true
if role_exists "$TASK_ROLE"; then
  echo "$TASK_ROLE exists (ensuring policies)"
else
  TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
  "$AWS" iam create-role --role-name "$TASK_ROLE" --assume-role-policy-document "$TRUST" >/dev/null
  echo "created task role (least privilege: this table + diagrams/ prefix only)"
fi
"$AWS" iam put-role-policy --role-name "$TASK_ROLE" --policy-name app-data-access --policy-document '{
  "Version":"2012-10-17",
  "Statement":[
    {"Effect":"Allow","Action":["dynamodb:GetItem","PutItem","Query","DeleteItem","UpdateItem","BatchGetItem","BatchWriteItem","TransactWriteItems","ConditionCheckItem"],
     "Resource":["arn:aws:dynamodb:'"$REGION"':'"$ACCOUNT_ID"':table/'"$DDB_TABLE"'","arn:aws:dynamodb:'"$REGION"':'"$ACCOUNT_ID"':table/'"$DDB_TABLE"'/index/*"]},
    {"Effect":"Allow","Action":["s3:PutObject","s3:GetObject","s3:HeadObject","s3:DeleteObject"],
     "Resource":"arn:aws:s3:::'"$APP_BUCKET"'/diagrams/*"}]}' >/dev/null 2>&1 || true
EXEC_ROLE_ARN=$(role_arn "$EXEC_ROLE")
TASK_ROLE_ARN=$(role_arn "$TASK_ROLE")

step "5. Log group ($LOG_GROUP)"
"$AWS" logs create-log-group --log-group-name "$LOG_GROUP" --region "$REGION" 2>/dev/null \
  && echo created || echo "exists"
"$AWS" logs put-retention-policy --log-group-name "$LOG_GROUP" --retention-in-days 30 --region "$REGION"

step "6. Security groups"
ALB_SG=$(have "$AWS" ec2 describe-security-groups --region "$REGION" --group-names "$SG_ALB_NAME" 2>/dev/null \
  && "$AWS" ec2 describe-security-groups --region "$REGION" --group-names "$SG_ALB_NAME" $R --query "SecurityGroups[0].GroupId" \
  || "$AWS" ec2 create-security-group --region "$REGION" --group-name "$SG_ALB_NAME" --description "SahPaath ALB" --vpc-id "$VPC_ID" $R --query GroupId)
ECS_SG=$(have "$AWS" ec2 describe-security-groups --region "$REGION" --group-names "$SG_ECS_NAME" 2>/dev/null \
  && "$AWS" ec2 describe-security-groups --region "$REGION" --group-names "$SG_ECS_NAME" $R --query "SecurityGroups[0].GroupId" \
  || "$AWS" ec2 create-security-group --region "$REGION" --group-name "$SG_ECS_NAME" --description "SahPaath ECS tasks" --vpc-id "$VPC_ID" $R --query GroupId)
"$AWS" ec2 authorize-security-group-ingress --region "$REGION" --group-id "$ALB_SG" --protocol tcp --port 80 --cidr 0.0.0.0/0 2>/dev/null || true
"$AWS" ec2 authorize-security-group-ingress --region "$REGION" --group-id "$ALB_SG" --protocol tcp --port 443 --cidr 0.0.0.0/0 2>/dev/null || true
"$AWS" ec2 authorize-security-group-ingress --region "$REGION" --group-id "$ECS_SG" --protocol tcp --port 3000 --source-group "$ALB_SG" 2>/dev/null || true
echo "ALB SG $ALB_SG (80/443 public) -> ECS SG $ECS_SG (3000 from ALB only)"

step "7. Target group + ALB"
if have "$AWS" elbv2 describe-target-groups --region "$REGION" --names "$TG_NAME"; then
  TG_ARN=$("$AWS" elbv2 describe-target-groups --region "$REGION" --names "$TG_NAME" $R --query "TargetGroups[0].TargetGroupArn")
else
  TG_ARN=$("$AWS" elbv2 create-target-group --region "$REGION" --name "$TG_NAME" \
    --protocol HTTP --port 3000 --vpc-id "$VPC_ID" --target-type ip \
    --health-check-protocol HTTP --health-check-path /health --health-check-interval-seconds 15 \
    --health-check-timeout-seconds 5 --healthy-threshold-count 2 --unhealthy-threshold-count 3 $R --query "TargetGroups[0].TargetGroupArn")
fi
if have "$AWS" elbv2 describe-load-balancers --region "$REGION" --names "$ALB_NAME"; then
  ALB_DNS=$("$AWS" elbv2 describe-load-balancers --region "$REGION" --names "$ALB_NAME" $R --query "LoadBalancers[0].DNSName")
  ALB_ARN=$("$AWS" elbv2 describe-load-balancers --region "$REGION" --names "$ALB_NAME" $R --query "LoadBalancers[0].LoadBalancerArn")
else
  ALB_DNS=$("$AWS" elbv2 create-load-balancer --region "$REGION" --name "$ALB_NAME" \
    --subnets $SUBNETS --security-groups "$ALB_SG" --scheme internet-facing \
    --query "LoadBalancers[0].DNSName" --output text)
  ALB_ARN=$("$AWS" elbv2 describe-load-balancers --region "$REGION" --names "$ALB_NAME" $R --query "LoadBalancers[0].LoadBalancerArn")
  echo "waiting for ALB to be active..."
  "$AWS" elbv2 wait load-balancer-available --region "$REGION" --names "$ALB_NAME"
fi
LISTENER_COUNT=$("$AWS" elbv2 describe-listeners --region "$REGION" --load-balancer-arn "$ALB_ARN" \
  --query "length(Listeners)" --output text)
if [ "$LISTENER_COUNT" = "0" ]; then
  "$AWS" elbv2 create-listener --region "$REGION" --load-balancer-arn "$ALB_ARN" \
    --protocol HTTP --port 80 --default-actions "Type=forward,TargetGroupArn=$TG_ARN" >/dev/null
  echo "listener :80 -> $TG_NAME created"
fi
echo "ALB: http://$ALB_DNS"

step "8. ECS cluster"
have "$AWS" ecs describe-clusters --region "$REGION" --clusters "$CLUSTER" 2>/dev/null \
  && "$AWS" ecs describe-clusters --region "$REGION" --clusters "$CLUSTER" $R 2>/dev/null | grep -q ACTIVE \
  || "$AWS" ecs create-cluster --region "$REGION" --cluster-name "$CLUSTER" >/dev/null
echo "cluster $CLUSTER ready"

step "9. Task definition"
cat > sahpaath-taskdef.json <<EOF
{
  "family": "$FAMILY",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "$EXEC_ROLE_ARN",
  "taskRoleArn": "$TASK_ROLE_ARN",
  "volumes": [
    {"name": "sahpaath-data", "efsVolumeConfiguration": {"fileSystemId": "fs-0dde24911976e4f83", "transitEncryption": "ENABLED"}}
  ],
  "containerDefinitions": [
    {
    "name": "efs-init",
    "image": "public.ecr.aws/docker/library/busybox:latest",
    "essential": false,
    "entryPoint": ["/bin/sh", "-c"],
    "command": ["mkdir -p /data && chown -R 1000:1000 /data && echo EFS_READY"],
    "mountPoints": [{"sourceVolume": "sahpaath-data", "containerPath": "/data"}],
    "logConfiguration": {"logDriver": "awslogs", "options": {"awslogs-group": "$LOG_GROUP", "awslogs-region": "$REGION", "awslogs-stream-prefix": "efs-init"}}
  },
  {
    "name": "sahpaath-web",
    "image": "$ECR_REPO:$IMAGE_TAG",
    "portMappings": [{"containerPort": 3000, "protocol": "tcp"}],
    "essential": true,
    "dependsOn": [{"containerName": "efs-init", "condition": "SUCCESS"}],
    "mountPoints": [{"sourceVolume": "sahpaath-data", "containerPath": "/data"}],
    "environment": [
      {"name": "PORT", "value": "3000"},
      {"name": "SAHPAATH_BIND", "value": "0.0.0.0"},
      {"name": "SAHPAATH_STORE", "value": "dynamodb"},
      {"name": "SAHPAATH_DDB_TABLE", "value": "$DDB_TABLE"},
      {"name": "SAHPAATH_S3_BUCKET", "value": "$APP_BUCKET"},
      {"name": "SAHPAATH_LOG_LEVEL", "value": "info"},
      {"name": "SAHPAATH_PUBLIC_HOSTS", "value": "$ALB_DNS"}
    ],
    "secrets": [
      {"name": "SAHPAATH_TEACHER_PASSWORD", "valueFrom": "$SECRET_ARN:SAHPAATH_TEACHER_PASSWORD::"},
      {"name": "SAHPAATH_UPLOAD_TOKEN_SECRET", "valueFrom": "$SECRET_ARN:SAHPAATH_UPLOAD_TOKEN_SECRET::"},
      {"name": "GEMINI_API_KEY", "valueFrom": "$SECRET_ARN:GEMINI_API_KEY::"},
      {"name": "SUPABASE_URL", "valueFrom": "$SECRET_ARN:SUPABASE_URL::"},
      {"name": "SUPABASE_JWKS_URL", "valueFrom": "$SECRET_ARN:SUPABASE_JWKS_URL::"},
      {"name": "SUPABASE_PUBLISHABLE_KEY", "valueFrom": "$SECRET_ARN:SUPABASE_PUBLISHABLE_KEY::"}
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "$LOG_GROUP",
        "awslogs-region": "$REGION",
        "awslogs-stream-prefix": "web"
      }
    }
  }
]
}
EOF
TD_ARN=$("$AWS" ecs register-task-definition --region "$REGION" --cli-input-json file://sahpaath-taskdef.json $R --query "taskDefinition.taskDefinitionArn")
echo "registered $TD_ARN"

step "10. Service"
if have "$AWS" ecs describe-services --region "$REGION" --cluster "$CLUSTER" --services "$SERVICE" 2>/dev/null \
   && "$AWS" ecs describe-services --region "$REGION" --cluster "$CLUSTER" --services "$SERVICE" $R 2>/dev/null | grep -q ACTIVE; then
  "$AWS" ecs update-service --region "$REGION" --cluster "$CLUSTER" --service "$SERVICE" \
    --task-definition "$TD_ARN" --force-new-deployment >/dev/null
  echo "service updated to $TD_ARN"
else
  "$AWS" ecs create-service --region "$REGION" --cluster "$CLUSTER" --service-name "$SERVICE" \
    --task-definition "$TD_ARN" --desired-count 1 --launch-type FARGATE \
    --load-balancers "targetGroupArn=$TG_ARN,containerName=sahpaath-web,containerPort=3000" \
    --health-check-grace-period-seconds 60 \
    --network-configuration "awsvpcConfiguration={subnets=[$(echo $SUBNETS | tr ' ' ',')],securityGroups=[$ECS_SG],assignPublicIp=ENABLED}" >/dev/null
  echo "service created"
fi

step "11. Wait for stability + verify"
"$AWS" ecs wait services-stable --region "$REGION" --cluster "$CLUSTER" --services "$SERVICE" \
  && echo "service is STABLE" || echo "WARNING: still not stable — check $LOG_GROUP"
for i in $(seq 1 10); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "http://$ALB_DNS/health" || true)
  echo "attempt $i: /health -> $CODE"
  [ "$CODE" = "200" ] && break
  sleep 10
done

echo
echo "DONE. Frontend + API: http://$ALB_DNS"
echo "Logs: aws logs tail $LOG_GROUP --follow --region $REGION"
