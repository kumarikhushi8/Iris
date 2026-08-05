# approval/ — Phase 4

Not yet implemented. Satisfies FR-15, FR-16, FR-17, FR-18 once built.

Planned files (see folder-structure.md):
- approval.module.ts
- approval.controller.ts
- approval.service.ts

IMPORTANT (FR-17): once built, this is the ONLY module permitted to call
GithubService.openDraftPullRequest(). That call must be preconditioned on
an Approval record with decision="approved". Do not add a shortcut to
this from worker/ or ai/.

See implementation-plan.md, Phase 4, for task breakdown and acceptance criteria.
