import { Injectable, Logger } from "@nestjs/common";

// Satisfies: FR-9 (partial -- exact file retrieval from log-referenced
// paths; full AST/dependency-graph traversal is a larger future increment,
// tracked separately in implementation-plan.md)
//
// Scans a normalized log excerpt for file paths the failure actually
// references (e.g. "at test.js:5:8"), so the diagnosis agent gets the
// real code instead of guessing from the log text alone.

const FILE_PATH_PATTERN = /([a-zA-Z0-9_\-./]+\.(?:js|ts|jsx|tsx|py|go|java|rb))(?::\d+)?/g;
const NOISE_PATTERNS = [/^node:/, /node_modules/, /^internal\//];

@Injectable()
export class StructuralRetrievalService {
  private readonly logger = new Logger(StructuralRetrievalService.name);

  /**
   * Extracts candidate file paths mentioned in the log, ranked by how
   * often they appear, excluding Node internals and dependency noise.
   */
  findReferencedFiles(logExcerpt: string, maxFiles = 3): string[] {
    const counts = new Map<string, number>();

    for (const match of logExcerpt.matchAll(FILE_PATH_PATTERN)) {
      const path = match[1];
      if (NOISE_PATTERNS.some((p) => p.test(path))) continue;
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }

    const ranked = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxFiles)
      .map(([path]) => path);

    this.logger.log(`Found ${ranked.length} referenced file(s) in log: ${ranked.join(", ") || "(none)"}`);
    return ranked;
  }
}