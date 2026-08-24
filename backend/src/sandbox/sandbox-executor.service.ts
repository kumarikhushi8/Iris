import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as zlib from "zlib";
import * as crypto from "crypto";
import * as tar from "tar-stream";
import * as Diff from "diff";
import { GithubService } from "../github/github.service";
import { getSandboxRuntimeConfig } from "./sandbox-runtime.config";
import { MetricsService } from "../observability/metrics.service";

// Satisfies: FR-12, FR-14
// Applies the repo's code at a given commit inside an isolated, resource-
// limited Docker container and actually runs its test command -- no fix
// or diagnosis is ever trusted without having been executed here first.
//
// Isolation posture for this phase: plain Docker with --network none and
// enforced CPU/memory/time limits. Kernel-level isolation via gVisor is a
// documented future hardening step (see implementation-plan.md, Phase 5),
// not implemented here -- noted explicitly rather than silently assumed.

export interface SandboxResult {
  result: "pass" | "fail" | "timeout" | "patch_failed";
  testLog: string;
  durationMs: number;
}

@Injectable()
export class SandboxExecutorService {
  private readonly logger = new Logger(SandboxExecutorService.name);

    constructor(
    private readonly config: ConfigService,
    private readonly github: GithubService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Fetches the repo at `commitSha`, extracts it to a disposable temp
   * directory, and runs `npm install && npm test` inside an isolated
   * container. No patch application yet (that's step 3b) -- this proves
   * the isolation and execution path works end to end first.
   */
  async runTests(
    installationId: string,
    owner: string,
    repo: string,
    commitSha: string,
    patch?: { filePath: string; diff: string },
  ): Promise<SandboxResult> {
    const runtimeConfig = getSandboxRuntimeConfig(this.config);
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-sandbox-"));
    const start = Date.now();

    try {
      this.logger.log(`Fetching snapshot of ${owner}/${repo}@${commitSha}`);
      const tarball = await this.withTimeout(
        this.github.downloadRepoTarball(installationId, owner, repo, commitSha),
        30000,
        "Repo tarball download",
      );
      await this.extractTarball(tarball, workDir);

      // Satisfies: FR-12 -- a fix is only ever validated by actually
      // applying it and running the result, never trusted as text alone.
      if (patch) {
        const applied = this.applyPatch(workDir, patch.filePath, patch.diff);
        if (!applied.success) {
          const durationMs = Date.now() - start;
          this.logger.warn(`Patch did not apply cleanly to ${patch.filePath}`);
          this.metrics.sandboxRuns.inc({ result: "patch_failed" });
          return {
            result: "patch_failed",
            testLog: `Patch failed to apply to ${patch.filePath}:\n${applied.reason}`,
            durationMs,
          };
        }
        this.logger.log(`Patch applied cleanly to ${patch.filePath}`);
      }

      const containerName = `iris-sandbox-${crypto.randomUUID()}`;
      const dockerArgs = [
        "run",
        "--rm",
        "--name", containerName,
        "--network", "none",
        "--memory", `${runtimeConfig.memoryLimitMb}m`,
        "--cpus", runtimeConfig.cpuLimit,
        "-v", `${workDir}:/workspace`,
        "-w", "/workspace",
        runtimeConfig.image,
        "sh", "-c", "npm install --no-audit --no-fund && npm test",
      ];

      this.logger.log(`Running sandbox container ${containerName} (limits: ${runtimeConfig.memoryLimitMb}MB, ${runtimeConfig.cpuLimit} CPU, ${runtimeConfig.maxRuntimeMs}ms max)`);
      const { exitCode, output, timedOut } = await this.runDockerProcess(
        dockerArgs,
        runtimeConfig.maxRuntimeMs,
        containerName,
      );
      const durationMs = Date.now() - start;

      const result: SandboxResult["result"] = timedOut ? "timeout" : exitCode === 0 ? "pass" : "fail";
      this.logger.log(`Sandbox result: ${result} (${durationMs}ms)`);
      this.metrics.sandboxRuns.inc({ result });

      return { result, testLog: output.slice(-8000), durationMs };
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }

  private applyPatch(
    workDir: string,
    filePath: string,
    diffText: string,
  ): { success: boolean; reason?: string } {
    const targetPath = path.join(workDir, filePath);
    if (!fs.existsSync(targetPath)) {
      return { success: false, reason: `File ${filePath} not found in workspace` };
    }

    const original = fs.readFileSync(targetPath, "utf8");
    const patched = Diff.applyPatch(original, diffText);

    if (patched === false) {
      this.logger.debug(`Original file content:\n${JSON.stringify(original)}`);
      this.logger.debug(`Diff attempted:\n${JSON.stringify(diffText)}`);
      return { success: false, reason: "Diff did not apply cleanly (context mismatch)" };
    }

    if (patched === original) {
      this.logger.warn(`Patch "applied" but produced no change to ${filePath} -- treating as failure`);
      return { success: false, reason: "Patch applied without error but did not change file content" };
    }

    fs.writeFileSync(targetPath, patched);
    return { success: true };
  }
  private extractTarball(buffer: Buffer, destDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const extract = tar.extract();

      extract.on("entry", (header, stream, next) => {
        // GitHub tarballs wrap everything in a single top-level folder
        // (e.g. "owner-repo-sha/"); strip it so paths are repo-relative.
        const relativePath = header.name.split("/").slice(1).join("/");
        if (!relativePath || header.type !== "file") {
          stream.resume();
          return next();
        }
        const filePath = path.join(destDir, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const ws = fs.createWriteStream(filePath);
        stream.pipe(ws);
        ws.on("finish", next);
        ws.on("error", reject);
      });

      extract.on("finish", resolve);
      extract.on("error", reject);

      const gunzip = zlib.createGunzip();
      gunzip.on("error", reject);
      gunzip.pipe(extract);
      gunzip.end(buffer);
    });
  }

  private runDockerProcess(
    args: string[],
    timeoutMs: number,
    containerName: string,
  ): Promise<{ exitCode: number | null; output: string; timedOut: boolean }> {
    return new Promise((resolve) => {
      let output = "";
      let timedOut = false;

      const child = spawn("docker", args);

      const timer = setTimeout(() => {
        timedOut = true;
        spawn("docker", ["kill", containerName]); // force-stop a stalled run
      }, timeoutMs);

      child.stdout.on("data", (d) => (output += d.toString()));
      child.stderr.on("data", (d) => (output += d.toString()));

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ exitCode: code, output, timedOut });
      });
    });
  }

  
  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }
}