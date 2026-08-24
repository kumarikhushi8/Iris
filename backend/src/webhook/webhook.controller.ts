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
      if (event !== "workflow_run") return;

      const payload = req.body;
      if (payload.action !== "completed" || payload.workflow_run?.conclusion !== "failure") {
        return; // only diagnose actual failures, ignore successes and in-progress runs
      }

      const repo = await this.prisma.repo.findFirst({
        where: { githubRepoId: String(payload.repository.id) },
      });
      if (!repo) {
        this.logger.warn(`No connected repo found for githubRepoId=${payload.repository.id}`);
        return; // event from a repo that isn't connected to Iris
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

      // jobId = repo-branch lock key: prevents two overlapping diagnosis
      // attempts on the same branch from racing each other (FR-7).
      await this.queue.add("diagnose", job, {
        jobId: `${repoBranchLockKey(repo.id, job.branch)}__${job.commitSha}`,
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 1,
      });

      await this.prisma.build.update({ where: { id: build.id }, data: { status: "queued" } });
      this.logger.log(`Enqueued diagnosis job for ${job.owner}/${job.repo}#${job.branch}`);
      this.metrics.webhooksReceived.inc({ outcome: "enqueued" });
    } catch (err) {
      this.logger.error(`Webhook processing failed: ${(err as Error).message}`, (err as Error).stack);
      this.metrics.webhooksReceived.inc({ outcome: "error" });
    }
  }

  private isValidSignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
    const secret = this.config.get<string>("GITHUB_WEBHOOK_SECRET");
    if (!secret || !rawBody || !signature) return false;

    const expected =
      "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }
}
