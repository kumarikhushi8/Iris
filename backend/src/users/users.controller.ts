import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { UsersService } from "./users.service";

// Satisfies: FR-1
// Provides the endpoint the Next.js frontend calls immediately after
// a GitHub OAuth session is established. This keeps the Iris Postgres
// user table in sync with GitHub identity data without requiring the
// frontend to know about our internal user IDs up front.
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * POST /users/upsert
   * Called by the frontend after a successful NextAuth GitHub sign-in.
   * Body: { githubId: string; name?: string; email?: string }
   * Returns: the full Iris User record (including the internal UUID).
   *
   * The frontend stores the returned `id` field as its X-User-Id for
   * subsequent authenticated requests (repos, approvals, etc.).
   */
  @Post("upsert")
  upsert(
    @Body("githubId") githubId: string,
    @Body("name") name?: string,
    @Body("email") email?: string,
  ) {
    return this.usersService.upsert({ githubId, name, email });
  }

  /**
   * GET /users/:id
   * Fetch a user's public profile by their Iris UUID.
   */
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.usersService.findById(id);
  }
}
