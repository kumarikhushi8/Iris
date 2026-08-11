import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { BUILD_FAILURE_QUEUE } from "../queue/queue.module";
import { BuildFailureJobPayload } from "../queue/build-failure.job";
import { PrismaService } from "../database/prisma.service";
import { GithubService } from "../github/github.service";
import { AI_PROVIDER } from "../ai/ai.module";
import type { AiProvider } from "../ai/ai-provider.interface";
import { redactSecrets } from "../common/redact-secrets";
import { LogNormalizationService } from "../retrieval/log-normalization.service";
import { StructuralRetrievalService } from "../retrieval/structural-retrieval.service";

// Satisfies: FR-8 (placeholder form), FR-10
// This is the Phase 0 form of the pipeline described in implementation-plan.md.
// Log retrieval is simplified (no hybrid pgvector + AST retrieval yet -- that's
// retrieval/, Phase 2), and there is no sandbox validation or approval queue
// yet (sandbox/, approval/ -- Phases 3-4) -- fixes are never opened as PRs at
// this stage, only posted as comments, regardless of a repo's configured
// autonomy level. Both are the next things to build on top of this, in the
// order laid out in implementation-plan.md -- not a change to this flow's shape.
@Processor(BUILD_FAILURE_QUEUE)
export class BuildFailureProcessor extends WorkerHost {
  private readonly logger = new Logger(BuildFailureProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubService,
    private readonly logNormalization: LogNormalizationService,
    private readonly structuralRetrieval: StructuralRetrievalService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {
    super();
  }

  async process(job: Job<BuildFailureJobPayload>): Promise<void> {
    const data = job.data;
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

    // --- Step 1: gather context (Phase 2 -- real log retrieval) -------------
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

    // --- Step 1b: fetch the actual code referenced in the log (FR-9) --------
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
      } else {
        this.logger.warn(`No content returned for ${filePath}`);
      }
    }

    // --- Step 2: diagnose (FR-10) ----------------------------------------
    const diagnosisResult = await this.ai.diagnose({
      errorSignature: "unknown", // full extraction is a further refinement
      logExcerpt,
      relevantCode,
    });

    const diagnosis = await this.prisma.diagnosis.create({
      data: {
        buildId: build.id,
        rootCause: diagnosisResult.rootCause,
        fixType: diagnosisResult.fixType,
        confidence: diagnosisResult.confidence,
        status: "awaiting_approval", // sandbox validation stage not yet implemented (Phase 3)
      },
    });

    // --- Step 3: surface the result (comment-only, always) -----------------
    // Sandbox validation and the human approval queue are not implemented
    // yet, so no fix is ever proposed as code here -- only a diagnosis
    // comment, regardless of the repo's autonomy_level. This keeps Phase 0
    // safe to run against a real repository. See approval/ (Phase 4) for
    // where draft-PR opening will be wired in, gated on an Approval record.
    const repo = await this.prisma.repo.findUnique({ where: { id: data.repoDbId } });
    if (data.pullRequestNumber && repo) {
      const body = [
        "**Iris diagnosis** (Phase 0 -- sandbox validation not yet enabled, informational only)",
        "",
        `**Likely cause:** ${diagnosisResult.rootCause}`,
        `**Category:** ${diagnosisResult.fixType}`,
        `**Confidence:** ${(diagnosisResult.confidence * 100).toFixed(0)}%`,
      ].join("\n");

      await this.github.postComment(
        data.installationId,
        data.owner,
        data.repo,
        data.pullRequestNumber,
        body,
      );
    }

    await this.prisma.build.update({ where: { id: build.id }, data: { status: "failed" } });
    this.logger.log(`Diagnosis ${diagnosis.id} posted for build ${build.id}`);
  }
}
