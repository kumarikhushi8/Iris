import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Headers,
  UnauthorizedException,
} from "@nestjs/common";
import { ReposService } from "./repos.service";

// Satisfies: FR-2
// Repository connection + autonomy configuration endpoints.
//
// Authentication note: until a full session/JWT middleware is wired in,
// the caller supplies their Iris userId via the X-User-Id header. The
// frontend sets this after exchanging the GitHub OAuth session for a
// backend user record (see users/ module).
@Controller("repos")
export class ReposController {
  constructor(private readonly reposService: ReposService) {}

  /** List all repos connected by the authenticated user. */
  @Get()
  list(@Headers("x-user-id") userId: string) {
    this.requireUserId(userId);
    return this.reposService.listForUser(userId);
  }

  /**
   * Connect a repository.
   * Body: { githubRepoId, name, installationId, autonomyLevel? }
   */
  @Post()
  connect(
    @Headers("x-user-id") userId: string,
    @Body("githubRepoId") githubRepoId: string,
    @Body("name") name: string,
    @Body("installationId") installationId: string,
    @Body("autonomyLevel") autonomyLevel?: "comment_only" | "draft_pr_eligible",
  ) {
    this.requireUserId(userId);
    return this.reposService.connect({
      userId,
      githubRepoId,
      name,
      installationId,
      autonomyLevel,
    });
  }

  /**
   * Update the autonomy level for a connected repo (FR-2).
   * Body: { autonomyLevel: "comment_only" | "draft_pr_eligible" }
   */
  @Patch(":id/autonomy")
  setAutonomy(
    @Param("id") repoId: string,
    @Headers("x-user-id") userId: string,
    @Body("autonomyLevel") autonomyLevel: "comment_only" | "draft_pr_eligible",
  ) {
    this.requireUserId(userId);
    return this.reposService.setAutonomy(repoId, userId, autonomyLevel);
  }

  /** Disconnect a repository from Iris. */
  @Delete(":id")
  disconnect(
    @Param("id") repoId: string,
    @Headers("x-user-id") userId: string,
  ) {
    this.requireUserId(userId);
    return this.reposService.disconnect(repoId, userId);
  }

  private requireUserId(userId: string | undefined): asserts userId is string {
    if (!userId) {
      throw new UnauthorizedException("X-User-Id header is required");
    }
  }
}
