// Satisfies: FR-7
// Phase 0 implementation: BullMQ's `jobId` option is used as a de-facto lock --
// adding a job with an ID that's already active/waiting is a no-op, which is
// enough to prevent two concurrent diagnosis attempts on the same branch.
// A more explicit Redis-based lock (e.g. Redlock) is planned for Phase 5
// hardening if this proves insufficient under real concurrent load -- see
// implementation-plan.md Phase 5.

export function repoBranchLockKey(repoId: string, branch: string): string {
  return `${repoId}:${branch}`;
}
