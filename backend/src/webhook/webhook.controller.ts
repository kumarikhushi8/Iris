import { GithubService } from "../github/github.service";
import { Controller, Post, Req, Res, Headers, HttpStatus } from "@nestjs/common";
import type { Request, Response } from "express";
import { ConfigService } from "@nestjs/config";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import * as crypto from "crypto";
import { BUILD_FAILURE_QUEUE } from "../queue/queue.module";
import { BuildFailureJobPayload } from "../queue/build-failure.job";
import { repoBranchLockKey } from "../queue/repo-branch-lock.service";
import { PrismaService } from "../database/prisma.service";
import { Logger } from "@nestjs/common";
import { MetricsService } from "../observability/metrics.service";
import { EmbeddingService } from "../retrieval/embedding.service";

// Satisfies: FR-4, FR-5, FR-7
// This is the one HTTP-facing edge of the whole system. Its only job is to
// (1) prove the request really came from GitHub and (2) get the event onto
// the queue as fast as possible. GitHub retries deliveries that don't get a
// 2xx response within 10 seconds, so nothing slow -- log fetching, retrieval,
// diagnosis -- is allowed to happen on this code path (see Phase 2/3 in
// implementation-plan.md, which extend worker/build-failure.processor.ts,
// never this controller).
@Controller("webhooks/github")
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
    constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly github: GithubService,
    private readonly metrics: MetricsService,
    private readonly embedding: EmbeddingService,
    @InjectQueue(BUILD_FAILURE_QUEUE) private readonly queue: Queue<BuildFailureJobPayload>,
  ) {}

  @Post()
  async handle(
    @Req() req: Request,
    @Res() res: Response,
    @Headers("x-hub-signature-256") signature: string,
    @Headers("x-github-event") event: string,
  ) {
    if (!this.isValidSignature(req.rawBody, signature)) {
      return res.status(HttpStatus.UNAUTHORIZED).send("invalid signature");
    }

    // Always acknowledge quickly; do the real work asynchronously.
    res.status(HttpStatus.ACCEPTED).send("accepted");

try {
      if (event === "workflow_run") {
        await this.handleWorkflowRun(req.body);
      } else if (event === "push") {
        await this.handlePush(req.body);
      } else if (event === "pull_request") {
        await this.handlePullRequest(req.body);
      }
      // All other events (ping, check_run, etc.) are silently ignored.
    } catch (err) {
      this.logger.error(`Webhook processing failed: ${(err as Error).message}`, (err as Error).stack);
      this.metrics.webhooksReceived.inc({ outcome: "error" });
    }
  }

  // ── workflow_run: the trigger for actual diagnosis ─────────────────────────
  // Satisfies: FR-3 (workflow_run ingestion), FR-7 (locking)
  private async handleWorkflowRun(payload: any): Promise<void> {
    if (payload.action !== "completed" || payload.workflow_run?.conclusion !== "failure") {
      return; // only diagnose actual failures
    }

    // Never diagnose Iris's own fix branches — this would spiral:
    //   fix branch → CI run → diagnosis → another fix branch → ...
    // Fix branches are named "iris-fix-<prefix>" (see approval.service.ts).
    if (payload.workflow_run.head_branch?.startsWith("iris-fix-")) {
      this.logger.log(`Skipping diagnosis for Iris's own fix branch: ${payload.workflow_run.head_branch}`);
      return;
    }

    const repo = await this.prisma.repo.findFirst({
      where: { githubRepoId: String(payload.repository.id) },
    });
    if (!repo) {
      this.logger.warn(`No connected repo found for githubRepoId=${payload.repository.id}`);
      return;
    }

    const build = await this.prisma.build.create({
      data: {
        repoId: repo.id,
        commitSha: payload.workflow_run.head_sha,
        branch: payload.workflow_run.head_branch,
        status: "failed",
      },
    });

    const pullRequestNumber = await this.github.findOpenPullRequestForBranch(
      String(payload.installation.id),
      payload.repository.owner.login,
      payload.repository.name,
      payload.workflow_run.head_branch,
    );

    const job: BuildFailureJobPayload = {
      installationId: String(payload.installation.id),
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      repoDbId: repo.id,
      runId: payload.workflow_run.id,
      commitSha: payload.workflow_run.head_sha,
      branch: payload.workflow_run.head_branch,
      pullRequestNumber,
    };

    // jobId = repo-branch lock key: only one active diagnosis per branch (FR-7).
    await this.queue.add("diagnose", job, {
      jobId: `${repoBranchLockKey(repo.id, job.branch)}__${job.commitSha}`,
      removeOnComplete: true,
      removeOnFail: true,
      attempts: 1,
    });

    await this.prisma.build.update({ where: { id: build.id }, data: { status: "queued" } });
    this.logger.log(`Enqueued diagnosis job for ${job.owner}/${job.repo}#${job.branch}`);
    this.metrics.webhooksReceived.inc({ outcome: "enqueued" });
  }

  // ── push: record commits for build history / dashboard (FR-3) ─────────────
  // Does NOT enqueue diagnosis — that only fires on workflow_run failures.
  // We only record pushes to real branches (not tag pushes, which have no branch).
  private async handlePush(payload: any): Promise<void> {
    // payload.ref = "refs/heads/<branch>" for branch pushes, "refs/tags/..." for tags
    const ref: string = payload.ref ?? "";
    if (!ref.startsWith("refs/heads/")) return;

    const branch = ref.replace("refs/heads/", "");
    // Ignore Iris's own fix branches
    if (branch.startsWith("iris-fix-")) return;

    const repo = await this.prisma.repo.findFirst({
      where: { githubRepoId: String(payload.repository.id) },
    });
    if (!repo) return; // unconnected repo

    await this.prisma.build.create({
      data: {
        repoId: repo.id,
        commitSha: payload.after, // the commit SHA that was just pushed
        branch,
        status: "queued", // will be updated when CI result comes in via workflow_run
      },
    });

    this.logger.log(`Recorded push for ${payload.repository.full_name}@${branch} (${payload.after?.slice(0, 7)})`);
    this.metrics.webhooksReceived.inc({ outcome: "push_recorded" });

    // FR-9: Diff-aware semantic re-indexing.
    // Gather all added/modified files across all commits in this push.
    const changedFiles = new Set<string>();
    for (const commit of payload.commits || []) {
      for (const f of commit.added || []) changedFiles.add(f);
      for (const f of commit.modified || []) changedFiles.add(f);
    }

    if (changedFiles.size > 0 && payload.installation?.id) {
      this.logger.log(`Indexing ${changedFiles.size} changed file(s) for semantic retrieval...`);
      for (const filePath of changedFiles) {
        try {
          const content = await this.github.getFileContent(
            String(payload.installation.id),
            payload.repository.owner.login,
            payload.repository.name,
            filePath,
            payload.after,
          );
          if (content) {
            await this.embedding.indexFile(repo.id, filePath, content);
          }
        } catch (err) {
          this.logger.warn(`Failed to index ${filePath}: ${(err as Error).message}`);
        }
      }
    }
  }

  // ── pull_request: record PR head commit for context (FR-3) ────────────────
  // Ingests "opened" and "synchronize" actions.
  // No diagnosis here — CI failures arrive via workflow_run.
  private async handlePullRequest(payload: any): Promise<void> {
    const action: string = payload.action;
    if (action !== "opened" && action !== "synchronize") return;

    const branch: string = payload.pull_request?.head?.ref;
    if (!branch || branch.startsWith("iris-fix-")) return;

    const repo = await this.prisma.repo.findFirst({
      where: { githubRepoId: String(payload.repository.id) },
    });
    if (!repo) return;

    await this.prisma.build.create({
      data: {
        repoId: repo.id,
        commitSha: payload.pull_request.head.sha,
        branch,
        status: "queued",
      },
    });

    this.logger.log(
      `Recorded PR #${payload.pull_request.number} ${action} for ${payload.repository.full_name}@${branch}`,
    );
    this.metrics.webhooksReceived.inc({ outcome: "pr_recorded" });
  }

  private isValidSignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
    const secret = this.config.get<string>("GITHUB_WEBHOOK_SECRET");
    if (!secret || !rawBody || !signature) return false;

    const expected =
      "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }
}
