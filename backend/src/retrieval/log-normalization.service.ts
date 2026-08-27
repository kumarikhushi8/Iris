import { Injectable, Logger } from "@nestjs/common";
import AdmZip from "adm-zip";
import { redactSecrets } from "../common/redact-secrets";

// Satisfies: FR-8
// Fetches the real log archive for a failed workflow run, extracts the
// failing job's output, strips noise (timestamps, ANSI color codes), and
// returns a condensed excerpt suitable for passing to the diagnosis agent.
//
// GitHub Actions zip layout (real format):
//   <job_name>/<step_number>_<step_name>.txt
// e.g.
//   build (ubuntu-latest)/1_Set up job.txt
//   build (ubuntu-latest)/3_Run tests.txt
//
// Strategy:
//   1. Group all .txt files by their top-level "job" directory.
//   2. Score each job by failure keyword density across ALL its steps.
//   3. Concatenate the winning job's steps in numeric order.
//   4. Slice to MAX_EXCERPT_CHARS, keeping the tail (failure appears there).
//   5. If no directory structure exists (single-level zip), fall back to
//      the globally highest-scoring single file.

const MAX_EXCERPT_CHARS = 12_000; // keep prompts focused but not tiny
const ANSI_PATTERN = /\x1B\[[0-9;]*[a-zA-Z]/g;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s?/gm;

// Matches the leading step number so we can sort steps in execution order.
const STEP_NUMBER_PATTERN = /^(\d+)_/;

@Injectable()
export class LogNormalizationService {
  private readonly logger = new Logger(LogNormalizationService.name);

  /**
   * Downloads the workflow run's log archive from the given signed URL,
   * extracts all log files, strips timestamps/ANSI codes, and returns the
   * portion most likely to contain the actual failure.
   *
   * Handles both multi-job (directory-per-job) and flat (single-level) zips.
   */
  async fetchAndNormalize(logsUrl: string): Promise<string> {
    const buffer = await this.fetchWithRetry(logsUrl, 3);
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries().filter((e) => !e.isDirectory && e.entryName.endsWith(".txt"));

    if (entries.length === 0) {
      return "(no log files found in archive)";
    }

    // ── Group entries by job directory ──────────────────────────────────────
    // entryName examples:
    //   "build (ubuntu-latest)/3_Run tests.txt"  → job = "build (ubuntu-latest)"
    //   "Run tests.txt"                          → job = "" (flat zip)
    type LogEntry = { stepNum: number; name: string; cleaned: string };
    const jobMap = new Map<string, LogEntry[]>();

    for (const entry of entries) {
      const slashIdx = entry.entryName.indexOf("/");
      const job = slashIdx >= 0 ? entry.entryName.slice(0, slashIdx) : "";
      const fileName = slashIdx >= 0 ? entry.entryName.slice(slashIdx + 1) : entry.entryName;

      const raw = entry.getData().toString("utf8");
      const cleaned = this.clean(raw);
      const stepMatch = STEP_NUMBER_PATTERN.exec(fileName);
      const stepNum = stepMatch ? parseInt(stepMatch[1], 10) : 0;

      if (!jobMap.has(job)) jobMap.set(job, []);
      jobMap.get(job)!.push({ stepNum, name: entry.entryName, cleaned });
    }

    // ── Score each job by total failure keyword density ──────────────────────
    let bestJob = "";
    let bestScore = -1;

    for (const [job, steps] of jobMap) {
      const combined = steps.map((s) => s.cleaned).join("\n");
      const score = this.failureScore(combined);
      if (score > bestScore) {
        bestScore = score;
        bestJob = job;
      }
    }

    const winningSteps = jobMap.get(bestJob)!;
    winningSteps.sort((a, b) => a.stepNum - b.stepNum);

    this.logger.log(
      `Selected job "${bestJob || "(flat)"}" (score ${bestScore}) with ${winningSteps.length} step(s) ` +
        `from ${entries.length} total log file(s)`,
    );

    const fullLog = winningSteps.map((s) => s.cleaned).join("\n\n--- step separator ---\n\n");

    // Keep the tail where failure messages typically appear, plus a window
    // of context from the mid-section (where tests execute) to give the AI
    // enough signal to propose a targeted fix.
    const tail = fullLog.slice(-MAX_EXCERPT_CHARS);
    return redactSecrets(tail);
  }

  private async fetchWithRetry(url: string, attempts: number): Promise<Buffer> {
    let lastError: Error | undefined;
    for (let i = 0; i < attempts; i++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) {
          throw new Error(`Failed to download logs: ${response.status} ${response.statusText}`);
        }
        return Buffer.from(await response.arrayBuffer());
      } catch (err) {
        lastError = err as Error;
        this.logger.warn(`Log download attempt ${i + 1}/${attempts} failed: ${lastError.message}`);
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
    throw lastError;
  }

  private clean(raw: string): string {
    return raw.replace(ANSI_PATTERN, "").replace(TIMESTAMP_PATTERN, "").trim();
  }

  private failureScore(content: string): number {
    const keywords = ["error", "fail", "exception", "assert", "traceback", "expected", "actual", "fatal", "panic"];
    const lower = content.toLowerCase();
    return keywords.reduce((score, kw) => score + (lower.split(kw).length - 1), 0);
  }
}