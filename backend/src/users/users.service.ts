import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

// Satisfies: FR-1
// Creates or updates a User row from GitHub OAuth identity data.
// Called by the frontend immediately after a successful NextAuth session
// is established (see frontend/hooks/useUserSync.ts).
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upsert a user by their GitHub ID.
   * Called every time a user signs in so that name/email stay fresh.
   * Returns the full User record.
   */
  async upsert(params: {
    githubId: string;
    name?: string;
    email?: string;
  }) {
    return this.prisma.user.upsert({
      where: { githubId: params.githubId },
      create: {
        githubId: params.githubId,
        name: params.name,
        email: params.email,
        role: "developer",
      },
      update: {
        name: params.name,
        email: params.email,
      },
    });
  }

  /**
   * Find a user by their internal Iris UUID. Used by other modules
   * to resolve the X-User-Id header into a full user record.
   */
  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /**
   * Find a user by their GitHub ID. Used during webhook processing
   * to attribute actions to the right user.
   */
  async findByGithubId(githubId: string) {
    return this.prisma.user.findUnique({ where: { githubId } });
  }
}
