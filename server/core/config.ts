/**
 * Environment configuration. Secrets come ONLY from the environment —
 * never from source code, and never committed (see .env.example).
 *
 * Minimal-student-data rule: student identity is an anonymous session id
 * generated server-side; no student PII exists anywhere in config.
 */

export type StoreKind = "memory" | "sqlite" | "dynamodb";

export interface AppConfig {
  port: number;
  /** Local data dir for sqlite store + uploads. */
  dataDir: string;
  /** Which repository adapter backs the service layer. */
  store: StoreKind;
  /** Teacher password (local dev only); required when store != dynamodb. */
  teacherPassword: string;
  /** AWS region; required only when store=dynamodb or S3 is enabled. */
  awsRegion: string | null;
  /** DynamoDB table name when store=dynamodb. */
  ddbTable: string | null;
  /** S3 bucket for uploads/audio when cloud storage is enabled. */
  s3Bucket: string | null;
  /** Local dir standing in for S3 while the account is unavailable. */
  localUploadsDir: string;
  /** AWS credential profile name, if any. Never a key/secret. */
  awsProfile: string | null;
  /** Step Functions state machine ASL (not yet deployed — UNVERIFIED). */
  sfnStateMachineArn: string | null;
  /**
   * Bedrock multimodal model id. Read EXACTLY from configuration — never
   * hardcoded. Examples of the FORMAT (not validated capabilities):
   * "anthropic.claude-3-5-sonnet-..." / "us.amazon.nova-...". Capability is
   * UNVERIFIED until checked against the configured account (docs/AWS_VERIFICATION.md).
   */
  bedrockModelId: string | null;
  /** Enable the real Bedrock call for the local pipeline (needs model + bucket). */
  bedrockEnabled: boolean;
  /** Enable the real Textract call for the local pipeline (needs region). */
  textractEnabled: boolean;
  /** Maximum demo upload size in bytes (default 5 MB). */
  maxUploadBytes: number;
  /** Presigned upload URL lifetime in seconds (default 600). */
  presignExpiresSeconds: number;
  /** Secret used to sign local upload confirmations (env-provided). */
  uploadTokenSecret: string;
  /** Structured log level. */
  logLevel: "debug" | "info" | "warn" | "error";
  /** Local dev authentication; cloud auth (Cognito) replaces this later. */
  authMode: "local_password";
}

function requireEnv(name: string, value: string | undefined, when: boolean): string {
  if (when && (!value || !value.trim()))
    throw new Error(`Missing required environment variable ${name} for the selected store.`);
  return value ?? "";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const storeRaw = (env.SAHPAATH_STORE || "sqlite").trim().toLowerCase();
  const store: StoreKind =
    storeRaw === "memory" || storeRaw === "dynamodb" ? storeRaw : "sqlite";
  const isCloud = store === "dynamodb";
  const awsRegion = env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim() || null;
  requireEnv("AWS_REGION", awsRegion ?? undefined, isCloud);
  const ddbTable = env.SAHPAATH_DDB_TABLE?.trim() || (isCloud ? null : null);
  requireEnv("SAHPAATH_DDB_TABLE", ddbTable ?? undefined, isCloud);
  const s3Bucket = env.SAHPAATH_S3_BUCKET?.trim() || null;
  requireEnv("AWS_REGION", awsRegion ?? undefined, !!s3Bucket);
  const teacherPassword = env.SAHPAATH_TEACHER_PASSWORD?.trim() || "";
  if (!isCloud && !teacherPassword)
    throw new Error(
      "Missing SAHPAATH_TEACHER_PASSWORD. Set it in the environment (see .env.example).",
    );
  const logLevelRaw = (env.SAHPAATH_LOG_LEVEL || "info").trim().toLowerCase();
  const logLevel = (["debug", "info", "warn", "error"] as const).includes(
    logLevelRaw as AppConfig["logLevel"],
  )
    ? (logLevelRaw as AppConfig["logLevel"])
    : "info";
  const maxUploadBytes = Number(env.SAHPAATH_MAX_UPLOAD_BYTES || 5_000_000);
  const presignExpiresSeconds = Number(env.SAHPAATH_PRESIGN_EXPIRES_SECONDS || 600);
  const uploadTokenSecret = env.SAHPAATH_UPLOAD_TOKEN_SECRET?.trim() || "";
  if (!uploadTokenSecret)
    throw new Error(
      "Missing SAHPAATH_UPLOAD_TOKEN_SECRET. Generate one (e.g. `openssl rand -hex 32`) and set it in the environment.",
    );
  return {
    port: Number(env.PORT || 5173),
    dataDir: env.SAHPAATH_DATA_DIR || ".data",
    store,
    teacherPassword,
    awsRegion,
    ddbTable,
    s3Bucket,
    localUploadsDir: ".data/uploads",
    awsProfile: env.AWS_PROFILE?.trim() || null,
    sfnStateMachineArn: env.SAHPAATH_SFN_STATE_MACHINE_ARN?.trim() || null,
    bedrockModelId: env.SAHPAATH_BEDROCK_MODEL_ID?.trim() || null,
    bedrockEnabled: env.SAHPAATH_BEDROCK_ENABLED === "1" || env.SAHPAATH_BEDROCK_ENABLED === "true",
    textractEnabled: env.SAHPAATH_TEXTRACT_ENABLED === "1" || env.SAHPAATH_TEXTRACT_ENABLED === "true",
    maxUploadBytes: Number.isFinite(maxUploadBytes) && maxUploadBytes > 0 ? Math.min(Math.floor(maxUploadBytes), 5_000_000) : 5_000_000,
    presignExpiresSeconds:
      Number.isFinite(presignExpiresSeconds) && presignExpiresSeconds > 0 && presignExpiresSeconds <= 3600
        ? presignExpiresSeconds
        : 600,
    uploadTokenSecret,
    logLevel,
    authMode: "local_password",
  };
}
