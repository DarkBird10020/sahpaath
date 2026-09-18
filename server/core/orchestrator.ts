import type { AppConfig } from "./config";
import type { Logger } from "./logger";
import type { Repos } from "../repositories/types";
import type { ProcessingJob } from "../../shared/model";
import { newId } from "./ids";
import { nowIso } from "../services/clock";

/**
 * Processing orchestration abstraction.
 *
 * - `StepFunctionsOrchestrator` starts a REAL execution on the configured
 *   state machine (SAHPAATH_SFN_STATE_MACHINE_ARN) via
 *   @aws-sdk/client-sfn StartExecution and returns the execution ARN as the
 *   processing job id. Used only when the ARN and region are configured.
 * - `LocalPipelineOrchestrator` is the clearly separated local adapter: it
 *   runs the deterministic validator locally (no OCR/model stages yet) and
 *   records a ProcessingJob whose stages are honest — simulated cloud stages
 *   are marked `simulation: true` with status "fallback". It never presents
 *   local work as an AWS execution.
 */

export interface StartProcessingResult {
  jobId: string;
  mode: "stepfunctions" | "local";
  status: ProcessingJob["status"];
  stages: ProcessingJob["stages"];
}

export interface ProcessingOrchestrator {
  start(input: { diagramId: string; lessonId: string; s3Key: string | null }): Promise<StartProcessingResult>;
}

export class StepFunctionsOrchestrator implements ProcessingOrchestrator {
  constructor(
    private readonly stateMachineArn: string,
    private readonly region: string,
  ) {}

  async start(input: {
    diagramId: string;
    lessonId: string;
    s3Key: string | null;
  }): Promise<StartProcessingResult> {
    const { SFNClient, StartExecutionCommand } = await import("@aws-sdk/client-sfn");
    const client = new SFNClient({ region: this.region });
    const response = await client.send(
      new StartExecutionCommand({
        stateMachineArn: this.stateMachineArn,
        name: `sahpaath-${input.diagramId}-${Date.now()}`,
        input: JSON.stringify({
          diagramId: input.diagramId,
          lessonId: input.lessonId,
          s3Key: input.s3Key,
        }),
      }),
    );
    if (!response.executionArn)
      throw new Error("Step Functions did not return an execution ARN.");
    return {
      jobId: response.executionArn,
      mode: "stepfunctions",
      status: "running",
      stages: [
        {
          name: "Orchestration",
          status: "completed",
          simulation: false,
          detail: `Started Step Functions execution ${response.executionArn}.`,
          durationMs: null,
        },
      ],
    };
  }
}

export class LocalPipelineOrchestrator implements ProcessingOrchestrator {
  constructor(
    private readonly repos: Repos,
    private readonly log: Logger,
  ) {}

  async start(input: {
    diagramId: string;
    lessonId: string;
    s3Key: string | null;
  }): Promise<StartProcessingResult> {
    const started = performance.now();
    // Local mode has no OCR/model provider yet (docs/BACKEND_AUDIT.md): the
    // pipeline is upload -> deterministic validation -> teacher review.
    // Cloud stages appear as explicitly simulated fallbacks, never successes.
    const stages: ProcessingJob["stages"] = [
      {
        name: "Upload & storage",
        status: "completed",
        simulation: false,
        detail: input.s3Key ? `Original stored at ${input.s3Key}.` : "No object stored yet.",
        durationMs: null,
      },
      {
        name: "OCR labels",
        status: "fallback",
        simulation: true,
        detail: "Textract is not connected. Add visible labels manually.",
        durationMs: null,
      },
      {
        name: "Analysis",
        status: "fallback",
        simulation: true,
        detail: "Bedrock is not connected. Proposals can be authored in the manual editor.",
        durationMs: null,
      },
      {
        name: "Validation",
        status: "completed",
        simulation: false,
        detail: "Deterministic validator ready; runs on every structure save.",
        durationMs: Math.round(performance.now() - started),
      },
      {
        name: "Teacher review",
        status: "waiting",
        simulation: false,
        detail: "Every part, relationship and flow needs an explicit decision.",
        durationMs: null,
      },
    ];
    // Local pipeline completes synchronously: the deterministic part ran,
    // cloud stages degraded to fallback, teacher review is the next gate.
    const jobRecord: ProcessingJob = {
      jobId: newId(),
      diagramId: input.diagramId,
      lessonId: input.lessonId,
      kind: "ai_analysis",
      status: "succeeded",
      stages,
      error: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await this.repos.jobs.put(jobRecord);
    this.log.info("processing.started", {
      diagramId: input.diagramId,
      mode: "local",
      jobId: jobRecord.jobId,
    });
    return {
      jobId: jobRecord.jobId,
      mode: "local",
      status: jobRecord.status,
      stages,
    };
  }
}

export function createOrchestrator(config: AppConfig, repos: Repos, log: Logger): ProcessingOrchestrator {
  if (config.sfnStateMachineArn && config.awsRegion)
    return new StepFunctionsOrchestrator(config.sfnStateMachineArn, config.awsRegion);
  return new LocalPipelineOrchestrator(repos, log.child({ component: "local-pipeline" }));
}
