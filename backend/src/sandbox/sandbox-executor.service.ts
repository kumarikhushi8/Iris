import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as zlib from "zlib";
import * as crypto from "crypto";
import * as tar from "tar-stream";
import { GithubService } from "../github/github.service";
import { getSandboxRuntimeConfig } from "./sandbox-runtime.config";

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
  result: "pass" | "fail" | "timeout";
  testLog: string;
  durationMs: number;
}

@Injectable()
export class SandboxExecutorService {
  private readonly logger = new Logger(SandboxExecutorService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly github: GithubService,
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
  ): Promise<SandboxResult> {
    const runtimeConfig = getSandboxRuntimeConfig(this.config);
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-sandbox-"));
    const start = Date.now();

    try {
      this.logger.log(`Fetching snapshot of ${owner}/${repo}@${commitSha}`);
      const tarball = await this.github.downloadRepoTarball(installationId, owner, repo, commitSha);
      await this.extractTarball(tarball, workDir);

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

      return { result, testLog: output.slice(-8000), durationMs };
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
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
}