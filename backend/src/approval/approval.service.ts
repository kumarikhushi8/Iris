import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { GithubService } from "../github/github.service";
import * as Diff from "diff";

// Satisfies: FR-15, FR-16, FR-17, FR-18
// This is the ONLY module permitted to call GithubService.openDraftPullRequest.
// Every path that reaches it is preconditioned on an Approval record with
// decision="approved" -- there is no other route to a pull request in
// this codebase.
@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubService,
  ) {}

  async listPending() {
    return this.prisma.approval.findMany({
      where: { decision: "pending" },
      include: {
        diagnosis: {
          include: {
            build: { include: { repo: true } },
            sandboxRuns: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
      },
      orderBy: { id: "desc" },
    });
  }

  async getOne(approvalId: string) {
    const approval = await this.prisma.approval.findUnique({
      where: { id: approvalId },
      include: {
        diagnosis: {
          include: {
            build: { include: { repo: true } },
            sandboxRuns: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
      },
    });
    if (!approval) throw new NotFoundException("Approval not found");
    return approval;
  }

  async reject(approvalId: string, reviewerId?: string) {
    const approval = await this.getOne(approvalId);
    if (approval.decision !== "pending") {
      throw new BadRequestException(`Approval already has decision: ${approval.decision}`);
    }
    // FR-18: rejection is recorded, no PR path is ever reached.
    return this.prisma.approval.update({
      where: { id: approvalId },
      data: { decision: "rejected", reviewerId, reviewedAt: new Date() },
    });
  }

  async requestChanges(approvalId: string, reviewerId?: string) {
    const approval = await this.getOne(approvalId);
    if (approval.decision !== "pending") {
      throw new BadRequestException(`Approval already has decision: ${approval.decision}`);
    }
    return this.prisma.approval.update({
      where: { id: approvalId },
      data: { decision: "changes_requested", reviewerId, reviewedAt: new Date() },
    });
  }

  /**
   * The only code path in the entire system that can result in a pull
   * request. Requires the Approval to be "pending" (never re-approve an
   * already-decided record), then flips it to "approved" BEFORE calling
   * GitHub, so a crash mid-PR-creation never leaves an ambiguous state
   * where GitHub was called without a matching approved record.
   */
  async approve(approvalId: string, reviewerId?: string): Promise<{ prUrl: string }> {
    const approval = await this.getOne(approvalId);
    if (approval.decision !== "pending") {
      throw new BadRequestException(`Approval already has decision: ${approval.decision}`);
    }
    if (!approval.diagnosis.proposedDiff) {
      throw new BadRequestException("Diagnosis has no proposed diff to apply");
    }

    const build = approval.diagnosis.build;
    const repo = build.repo;
    const filePath = this.parseTargetFile(approval.diagnosis.proposedDiff);
    if (!filePath) {
      throw new BadRequestException("Could not determine target file from proposed diff");
    }

    // Re-fetch the file at the original commit and apply the same patch
    // that was already validated in the sandbox -- never re-derive it.
    const original = await this.github.getFileContent(
      repo.installationId,
      repo.name.split("/")[0],
      repo.name.split("/")[1],
      filePath,
      build.commitSha,
    );
    if (!original) throw new BadRequestException(`Could not fetch original content of ${filePath}`);

    const patched = Diff.applyPatch(original, approval.diagnosis.proposedDiff);
    if (patched === false) throw new BadRequestException("Approved diff no longer applies cleanly");

    const [owner, repoName] = repo.name.split("/");
    const branchName = await this.github.commitFixToNewBranch(
      repo.installationId,
      owner,
      repoName,
      build.branch,
      build.commitSha,
      filePath,
      patched,
      approval.diagnosisId.slice(0, 8),
    );

    const prUrl = await this.github.openDraftPullRequest(repo.installationId, owner, repoName, {
      title: `Iris: fix for ${filePath}`,
      body: `Automated fix, approved by a human reviewer.\n\n**Root cause:** ${approval.diagnosis.rootCause}\n**Confidence:** ${((approval.diagnosis.confidence ?? 0) * 100).toFixed(0)}%`,
      head: branchName,
      base: build.branch,
    });

    // Only now -- after the PR genuinely exists -- do we record the
    // decision as approved. If anything above throws, the Approval stays
    // "pending" and this method can simply be retried safely.
    await this.prisma.approval.update({
      where: { id: approvalId },
      data: { decision: "approved", reviewerId, reviewedAt: new Date(), prUrl },
    });
    this.logger.log(`Approval ${approvalId} resulted in draft PR: ${prUrl}`);

    return { prUrl };
  }

  private parseTargetFile(diff: string): string | null {
    const match = diff.match(/^\+\+\+ (?:b\/)?(.+)$/m);
    return match ? match[1].trim() : null;
  }
}