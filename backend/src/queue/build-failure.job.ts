export interface BuildFailureJobPayload {
  installationId: string;
  owner: string;
  repo: string;
  repoDbId: string;
  runId: number;
  commitSha: string;
  branch: string;
  pullRequestNumber: number | null;
}
