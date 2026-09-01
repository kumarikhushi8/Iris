import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import * as fs from "fs";

// Wraps all interaction with the GitHub API behind one service.
// Satisfies: FR-1, FR-3 (see folder-structure.md cross-reference table)
@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Returns an installation-scoped Octokit client. Each repository install
   * gets its own short-lived installation token rather than a single
   * long-lived personal access token.
   */
  private async getInstallationClient(installationId: string): Promise<Octokit> {
    const appId = this.config.get<string>("GITHUB_APP_ID");
    const privateKeyPath = this.config.get<string>("GITHUB_APP_PRIVATE_KEY_PATH");
    const privateKeyEnv = this.config.get<string>("GITHUB_APP_PRIVATE_KEY");

    if (!appId || (!privateKeyPath && !privateKeyEnv)) {
      throw new Error("GITHUB_APP_ID and either GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH must be configured");
    }

    let privateKey = privateKeyEnv;
    if (!privateKey && privateKeyPath) {
      privateKey = fs.readFileSync(privateKeyPath, "utf8");
    }

    // When passing multi-line strings in some CI/CD envs, literal \n might be escaped
    if (privateKey) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    const auth = createAppAuth({ appId, privateKey: privateKey as string });
    const installationAuth = await auth({
      type: "installation",
      installationId: Number(installationId),
    });

    return new Octokit({ auth: installationAuth.token });
  }

  /**
   * Fetches the raw log archive URL for a failed workflow run. GitHub
   * returns a redirect URL to a zip archive; extraction is left to the
   * caller (Phase 2 retrieval work -- see retrieval/log-normalization.service.ts)
   */
  async getWorkflowRunLogsUrl(
    installationId: string,
    owner: string,
    repo: string,
    runId: number,
  ): Promise<string> {
    const octokit = await this.getInstallationClient(installationId);
    const response = await octokit.rest.actions.downloadWorkflowRunLogs({
      owner,
      repo,
      run_id: runId,
    });
    return (response as any).url;
  }

  async getFileContent(
    installationId: string,
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<string | null> {
    const octokit = await this.getInstallationClient(installationId);
    try {
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref });
      if ("content" in data && typeof data.content === "string") {
        return Buffer.from(data.content, "base64").toString("utf8");
      }
      return null;
    } catch (err) {
      this.logger.warn(`Could not fetch ${path}@${ref}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Downloads a tarball snapshot of the repo at a specific commit --
   * used by the sandbox executor to get an exact, isolated copy of the
   * code to validate a fix against (Phase 3, FR-12).
   */
  async downloadRepoTarball(
    installationId: string,
    owner: string,
    repo: string,
    ref: string,
  ): Promise<Buffer> {
    const octokit = await this.getInstallationClient(installationId);
    const response = await octokit.rest.repos.downloadTarballArchive({ owner, repo, ref });
    return Buffer.from(response.data as ArrayBuffer);
  }

  /**
   * Finds the open PR (if any) for a given branch. More reliable than
   * workflow_run.pull_requests, which is frequently empty or delayed.
   */
  async findOpenPullRequestForBranch(
    installationId: string,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<number | null> {
    const octokit = await this.getInstallationClient(installationId);
    const { data } = await octokit.rest.pulls.list({
      owner,
      repo,
      head: `${owner}:${branch}`,
      state: "open",
    });
    return data[0]?.number ?? null;
  }

  /** Posts a diagnosis as a PR comment. Used in "comment_only" autonomy mode. */
  async postComment(
    installationId: string,
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<void> {
    const octokit = await this.getInstallationClient(installationId);
    await octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body });
  }

    /**
   * Creates a new branch from `baseBranch`, commits the given file content
   * to it, and returns the branch name. This is the only way a fix's
   * content ever reaches a real branch -- and per FR-17, this method (and
   * openDraftPullRequest below) must only ever be called from approval/,
   * after an Approval record with decision="approved" exists.
   */
  async commitFixToNewBranch(
    installationId: string,
    owner: string,
    repo: string,
    baseBranch: string,
    baseSha: string,
    filePath: string,
    newContent: string,
    branchSuffix: string,
  ): Promise<string> {
    const octokit = await this.getInstallationClient(installationId);
    const branchName = `iris-fix-${branchSuffix}`;

    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });

    const { data: existingFile } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: branchName,
    });
    const sha = "sha" in existingFile ? existingFile.sha : undefined;

    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message: `Iris: automated fix for ${filePath}`,
      content: Buffer.from(newContent, "utf8").toString("base64"),
      branch: branchName,
      sha,
    });

    return branchName;
  }

  /**
   * Opens a draft pull request containing a validated, human-approved fix.
   * IMPORTANT: per FR-17, this must only ever be called from approval/
   * (Phase 4), after an Approval record with decision="approved" exists.
   * Phase 0 code never calls this method.
   */
  async openDraftPullRequest(
    installationId: string,
    owner: string,
    repo: string,
    params: { title: string; body: string; head: string; base: string },
  ): Promise<string> {
    const octokit = await this.getInstallationClient(installationId);
    const { data } = await octokit.rest.pulls.create({
      owner,
      repo,
      title: params.title,
      body: params.body,
      head: params.head,
      base: params.base,
      draft: true,
    });
    return data.html_url;
  }
}


