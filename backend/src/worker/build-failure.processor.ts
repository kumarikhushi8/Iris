import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Job } from "bullmq";
import { BUILD_FAILURE_QUEUE } from "../queue/queue.module";
import { BuildFailureJobPayload } from "../queue/build-failure.job";
import { PrismaService } from "../database/prisma.service";
import { GithubService } from "../github/github.service";
import { AI_PROVIDER } from "../ai/ai.module";
import type { AiProvider, DiagnosisResult } from "../ai/ai-provider.interface";
import { LogNormalizationService } from "../retrieval/log-normalization.service";
import { StructuralRetrievalService } from "../retrieval/structural-retrieval.service";
import { InfraClassifierService } from "../retrieval/infra-classifier.service";
import { EmbeddingService } from "../retrieval/embedding.service";
import { SandboxExecutorService } from "../sandbox/sandbox-executor.service";
import { redactSecrets } from "../common/redact-secrets";
import { MetricsService } from "../observability/metrics.service";
import { NotificationService } from "../notification/notification.service";

// Satisfies: FR-8, FR-9, FR-10, FR-12, FR-13, FR-14
// Full Phase 3 pipeline: diagnose -> apply proposed fix in an isolated
// sandbox -> validate by actually running tests -> on failure, retry with
// the sandbox output as new context, bounded by DIAGNOSIS_MAX_RETRIES ->
// on exhaustion, mark inconclusive. No fix is ever posted as a pull
// request here (that requires human approval, Phase 4, FR-17) -- this
// worker only ever comments, regardless of outcome.
@Processor(BUILD_FAILURE_QUEUE)
export class BuildFailureProcessor extends WorkerHost {
  private readonly logger = new Logger(BuildFailureProcessor.name);
  private readonly maxRetries: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubService,
    private readonly logNormalization: LogNormalizationService,
    private readonly structuralRetrieval: StructuralRetrievalService,
    private readonly infraClassifier: InfraClassifierService,
    private readonly embedding: EmbeddingService,
    private readonly sandbox: SandboxExecutorService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly notification: NotificationService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {
    super();
    this.maxRetries = parseInt(this.config.get<string>("DIAGNOSIS_MAX_RETRIES") ?? "3", 10);
  }

  async process(job: Job<BuildFailureJobPayload>): Promise<void> {
    const data = job.data;
    const processingStart = Date.now();
    this.logger.log(`Diagnosing failed build ${data.owner}/${data.repo}@${data.commitSha}`);

    const build = await this.prisma.build.findFirst({
      where: { repoId: data.repoDbId, commitSha: data.commitSha },
      orderBy: { startedAt: "desc" },
    });
    if (!build) {
      this.logger.warn("No matching build row found; skipping");
      return;
    }

    await this.prisma.build.update({ where: { id: build.id }, data: { status: "diagnosing" } });

    // --- Step 1: gather context (FR-8, FR-9) --------------------------------
    let logExcerpt: string;
    try {
      const logsUrl = await this.github.getWorkflowRunLogsUrl(
        data.installationId,
        data.owner,
        data.repo,
        data.runId,
      );
      logExcerpt = await this.logNormalization.fetchAndNormalize(logsUrl);
    } catch (err) {
      this.logger.warn(`Log retrieval failed, falling back to minimal context: ${(err as Error).message}`);
      logExcerpt = redactSecrets(
        `Workflow run ${data.runId} failed on branch ${data.branch}. Log retrieval failed: ${(err as Error).message}`,
      );
    }

    // FR-11: Pre-AI infra classifier — short-circuit if the log matches a
    // known infrastructure failure pattern (OOM, disk, DNS, runner issues).
    // No AI token is spent; we post a targeted comment and mark inconclusive.
    const infraCheck = this.infraClassifier.classify(logExcerpt);
    if (infraCheck.isInfra) {
      const diagInfra = await this.prisma.diagnosis.create({
        data: { buildId: build.id, status: "inconclusive", fixType: "infra",
                rootCause: infraCheck.reason, confidence: 1.0 },
      });
      await this.prisma.build.update({ where: { id: build.id }, data: { status: "failed" } });
      if (data.pullRequestNumber) {
        const repo = await this.prisma.repo.findUnique({ where: { id: data.repoDbId } });
        if (repo) {
          await this.github.postComment(
            data.installationId, data.owner, data.repo, data.pullRequestNumber,
            this.formatInfraComment(infraCheck.reason),
          );
        }
      }
      this.metrics.diagnosesTotal.inc({ outcome: "infra" });
      this.metrics.diagnosisLatency.observe((Date.now() - processingStart) / 1000);
      this.logger.log(`Infra failure short-circuit for build ${build.id}: ${infraCheck.reason}`);
      return;
    }

    // FR-9: Structural retrieval — find files the log references by path.
    const referencedFiles = this.structuralRetrieval.findReferencedFiles(logExcerpt);
    const relevantCode: Array<{ filePath: string; content: string }> = [];
    for (const filePath of referencedFiles) {
      const content = await this.github.getFileContent(
        data.installationId,
        data.owner,
        data.repo,
        filePath,
        data.commitSha,
      );
      if (content) {
        this.logger.log(`Fetched ${content.length} chars of code from ${filePath}`);
        relevantCode.push({ filePath, content });
      }
    }

    // FR-9 (semantic): if structural retrieval found nothing, fall back to
    // pgvector nearest-neighbour search over indexed embeddings.
    if (relevantCode.length === 0) {
      const semanticResults = await this.embedding.retrieveSimilar(data.repoDbId, logExcerpt);
      relevantCode.push(...semanticResults);
      if (semanticResults.length > 0) {
        this.logger.log(`Structural retrieval found 0 files; using ${semanticResults.length} semantic result(s)`);
      }
    }

    const diagnosis = await this.prisma.diagnosis.create({
      data: { buildId: build.id, status: "diagnosing" },
    });

    // --- Steps 2-3: diagnose, validate in sandbox, retry on failure ---------
    // (FR-10, FR-12, FR-13, FR-14)
    let attempt = 0;
    let finalDiagnosisResult: DiagnosisResult | null = null;
    let finalOutcome: "validated" | "inconclusive" | "no_fix_proposed" = "no_fix_proposed";
    let previousFailure: string | undefined;

    await this.prisma.build.update({ where: { id: build.id }, data: { status: "diagnosing" } });

        while (attempt <= this.maxRetries) {
      this.logger.log(`Attempt ${attempt + 1}/${this.maxRetries + 1}: calling AI provider "${this.ai.name}"...`);
      let diagnosisResult: DiagnosisResult;
      try {
        diagnosisResult = await this.ai.diagnose({
          errorSignature: "unknown",
          logExcerpt,
          relevantCode,
          previousAttemptFailure: previousFailure,
        });
        this.logger.log(`AI provider responded (confidence: ${diagnosisResult.confidence})`);
      } catch (err) {
        this.logger.error(`AI provider call failed: ${(err as Error).message}`, (err as Error).stack);
        throw err;
      }
      finalDiagnosisResult = diagnosisResult;

            await this.prisma.diagnosis.update({
        where: { id: diagnosis.id },
        data: {
          rootCause: diagnosisResult.rootCause,
          fixType: diagnosisResult.fixType,
          proposedDiff: diagnosisResult.proposedDiff,
          confidence: diagnosisResult.confidence,
          retryCount: attempt,
        },
      });

      // FR-11: infra-classified or diff-less diagnoses are never sandboxed --
      // there is nothing to validate, only to report.
      if (!diagnosisResult.proposedDiff || diagnosisResult.fixType === "infra") {
        finalOutcome = "no_fix_proposed";
        break;
      }

      const targetFile = this.parseTargetFile(diagnosisResult.proposedDiff) ?? referencedFiles[0];
      if (!targetFile) {
        this.logger.warn("Could not determine target file for proposed diff; skipping sandbox validation");
        finalOutcome = "no_fix_proposed";
        break;
      }

      await this.prisma.diagnosis.update({ where: { id: diagnosis.id }, data: { status: "validating" } });

      const sandboxResult = await this.sandbox.runTests(
        data.installationId,
        data.owner,
        data.repo,
        data.commitSha,
        { filePath: targetFile, diff: diagnosisResult.proposedDiff },
      );

      await this.prisma.sandboxRun.create({
        data: {
          diagnosisId: diagnosis.id,
          result: sandboxResult.result,
          testLog: sandboxResult.testLog,
          durationMs: sandboxResult.durationMs,
        },
      });

      if (sandboxResult.result === "pass") {
        finalOutcome = "validated";
        break;
      }

      this.logger.log(`Sandbox validation ${sandboxResult.result} on attempt ${attempt + 1}/${this.maxRetries + 1}`);
      previousFailure = sandboxResult.testLog;
      attempt++;
    }

        if (finalOutcome === "validated") {
      await this.prisma.diagnosis.update({ where: { id: diagnosis.id }, data: { status: "awaiting_approval" } });
      // Satisfies: FR-15 -- every validated fix gets a pending Approval
      // record the moment it's ready for review, not just a status flag.
      await this.prisma.approval.create({
        data: { diagnosisId: diagnosis.id, decision: "pending" },
      });

      // FR-19: Notify human reviewers based on confidence threshold
      await this.notification.notifyReviewers({
        diagnosisId: diagnosis.id,
        repoName: data.repo,
        pullRequestNumber: data.pullRequestNumber ?? undefined,
        branch: data.branch,
        confidence: finalDiagnosisResult!.confidence,
      });
    } else if (attempt > this.maxRetries) {
      finalOutcome = "inconclusive";
      await this.prisma.diagnosis.update({ where: { id: diagnosis.id }, data: { status: "inconclusive" } });
    } else {
      await this.prisma.diagnosis.update({ where: { id: diagnosis.id }, data: { status: "awaiting_approval" } });
    }

    // --- Step 4: surface the result (comment-only, always) -----------------
    // Human approval (Phase 4, FR-15-18) is required before any fix can be
    // proposed as a pull request. This worker never opens one.
    const repo = await this.prisma.repo.findUnique({ where: { id: data.repoDbId } });
    if (data.pullRequestNumber && repo && finalDiagnosisResult) {
      const body = this.formatComment(finalOutcome, finalDiagnosisResult, attempt);
      await this.github.postComment(
        data.installationId,
        data.owner,
        data.repo,
        data.pullRequestNumber,
        body,
      );
    }

    await this.prisma.build.update({ where: { id: build.id }, data: { status: "failed" } });
    this.metrics.diagnosesTotal.inc({ outcome: finalOutcome });
    this.metrics.diagnosisLatency.observe((Date.now() - processingStart) / 1000);
    this.logger.log(`Diagnosis ${diagnosis.id} completed with outcome "${finalOutcome}" for build ${build.id}`);
  }

  private parseTargetFile(diff: string): string | null {
    const match = diff.match(/^\+\+\+ (?:b\/)?(.+)$/m);
    return match ? match[1].trim() : null;
  }

  private formatComment(
    outcome: "validated" | "inconclusive" | "no_fix_proposed",
    diagnosisResult: DiagnosisResult,
    retries: number,
  ): string {
    const header = "**🤖 Iris diagnosis** — a validated fix is awaiting your review in the [Iris approval queue](/)";
    const base = [
      `**Likely cause:** ${diagnosisResult.rootCause}`,
      `**Category:** ${diagnosisResult.fixType}`,
      `**Confidence:** ${(diagnosisResult.confidence * 100).toFixed(0)}%`,
    ];

    if (outcome === "validated") {
      base.push(`**Fix status:** ✅ A proposed fix was applied and validated in an isolated sandbox — tests pass. Review it in the Iris approval queue.`);
    } else if (outcome === "inconclusive") {
      base.push(`**Fix status:** ⚠️ ${retries} proposed fix attempt(s) failed sandbox validation. Marked inconclusive — manual review needed.`);
    } else {
      base.push(`**Fix status:** ℹ️ No automated fix was attempted for this failure type.`);
    }

    return [header, "", ...base].join("\n");
  }

  private formatInfraComment(reason: string): string {
    return [
      "**🤖 Iris diagnosis — infrastructure failure**",
      "",
      `**Likely cause:** ${reason}`,
      "**Category:** infra",
      "",
      "This failure matches a known infrastructure pattern (not a code bug). " +
        "No fix can be automatically proposed — re-running the job is the recommended next step.",
    ].join("\n");
  }
}