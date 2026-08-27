import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

// Satisfies: FR-2
// Handles repository connection and per-repository autonomy configuration.
// Users connect repos via their GitHub App installation; this service records
// the connection and persists the chosen autonomy_level.
@Injectable()
export class ReposService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all repositories connected by a specific user.
   */
  async listForUser(userId: string) {
    return this.prisma.repo.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Connect a repository. Idempotent — if the same githubRepoId is already
   * connected by this user, returns the existing record rather than erroring.
   * If it is connected by a different user, throws ConflictException.
   */
  async connect(params: {
    userId: string;
    githubRepoId: string;
    name: string;           // "owner/repo"
    installationId: string;
    autonomyLevel?: "comment_only" | "draft_pr_eligible";
  }) {
    // Check if already connected
    const existing = await this.prisma.repo.findUnique({
      where: { githubRepoId: params.githubRepoId },
    });

    if (existing) {
      if (existing.userId !== params.userId) {
        throw new ConflictException(
          `Repository ${params.name} is already connected by another user`,
        );
      }
      // Same user, same repo — idempotent upsert of name/installation in case it changed
      return this.prisma.repo.update({
        where: { id: existing.id },
        data: {
          name: params.name,
          installationId: params.installationId,
          autonomyLevel: params.autonomyLevel ?? existing.autonomyLevel,
        },
      });
    }

    return this.prisma.repo.create({
      data: {
        userId: params.userId,
        githubRepoId: params.githubRepoId,
        name: params.name,
        installationId: params.installationId,
        autonomyLevel: params.autonomyLevel ?? "comment_only",
      },
    });
  }

  /**
   * Update the autonomy level for a connected repository (FR-2).
   * Only the owner can change the setting.
   */
  async setAutonomy(
    repoId: string,
    userId: string,
    autonomyLevel: "comment_only" | "draft_pr_eligible",
  ) {
    const repo = await this.prisma.repo.findUnique({ where: { id: repoId } });
    if (!repo) throw new NotFoundException("Repository not found");
    if (repo.userId !== userId) {
      throw new ConflictException("Only the owner can change the autonomy setting");
    }

    return this.prisma.repo.update({
      where: { id: repoId },
      data: { autonomyLevel },
    });
  }

  /**
   * Disconnect a repository. Removes it from Iris — no future events from
   * this repo will be processed.
   */
  async disconnect(repoId: string, userId: string) {
    const repo = await this.prisma.repo.findUnique({ where: { id: repoId } });
    if (!repo) throw new NotFoundException("Repository not found");
    if (repo.userId !== userId) {
      throw new ConflictException("Only the owner can disconnect a repository");
    }

    return this.prisma.repo.delete({ where: { id: repoId } });
  }
}
