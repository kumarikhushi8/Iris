import { Injectable, Logger } from "@nestjs/common";
import AdmZip from "adm-zip";
import { redactSecrets } from "../common/redact-secrets";

// Satisfies: FR-8
// Fetches the real log archive for a failed workflow run, extracts the
// failing job's output, strips noise (timestamps, ANSI color codes), and
// returns a condensed excerpt suitable for passing to the diagnosis agent.
// This replaces the Phase 0 placeholder string in build-failure.processor.ts.

const MAX_EXCERPT_CHARS = 8000; // keep prompts small and focused
const ANSI_PATTERN = /\x1B\[[0-9;]*[a-zA-Z]/g;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s?/gm;

@Injectable()
export class LogNormalizationService {
  private readonly logger = new Logger(LogNormalizationService.name);

  /**
   * Downloads the workflow run's log archive from the given signed URL,
   * extracts all log files, strips timestamps/ANSI codes, and returns the
   * portion most likely to contain the actual failure -- prioritizing
   * files whose content contains common failure keywords.
   */
    async fetchAndNormalize(logsUrl: string): Promise<string> {
    const buffer = await this.fetchWithRetry(logsUrl, 3);
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries().filter((e) => !e.isDirectory && e.entryName.endsWith(".txt"));

    if (entries.length === 0) {
      return "(no log files found in archive)";
    }

    // Rank log files by how likely they are to contain the actual failure.
    const scored = entries.map((entry) => {
      const content = entry.getData().toString("utf8");
      const cleaned = this.clean(content);
      const score = this.failureScore(cleaned);
      return { name: entry.entryName, cleaned, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    this.logger.log(`Selected log file "${best.name}" (failure score ${best.score}) from ${entries.length} candidates`);

    const excerpt = best.cleaned.slice(-MAX_EXCERPT_CHARS); // keep the tail -- failures usually appear near the end
    return redactSecrets(excerpt);
  }

  
  private async fetchWithRetry(url: string, attempts: number): Promise<Buffer> {
    let lastError: Error | undefined;
    for (let i = 0; i < attempts; i++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
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
    const keywords = ["error", "fail", "exception", "assert", "traceback", "expected", "actual"];
    const lower = content.toLowerCase();
    return keywords.reduce((score, kw) => score + (lower.split(kw).length - 1), 0);
  }
}