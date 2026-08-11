import { Injectable, Logger } from "@nestjs/common";

// Satisfies: FR-9 (partial -- exact file retrieval from log-referenced
// paths; full AST/dependency-graph traversal is a larger future increment,
// tracked separately in implementation-plan.md)
//
// Scans a normalized log excerpt for file paths the failure actually
// references (e.g. "at test.js:5:8"), so the diagnosis agent gets the
// real code instead of guessing from the log text alone.

// Requires a path separator or starts a line/is quoted -- excludes bare
// words like "Node.js" that merely end in a code-like extension.
const FILE_PATH_PATTERN = /(?:^|[\s"'(])((?:[\w.\-]+\/)*[\w.\-]+\.(?:js|ts|jsx|tsx|py|go|java|rb))(?::\d+)?/gm;

const NOISE_PATTERNS = [
  /^node:/,
  /node_modules/,
  /^internal\//,
  /^node\.js$/i, // the platform name, not a file
  /^module\._/i, // Node's internal module loader (e.g. Module._extensions..js)
];

// GitHub Actions runners check out the repo under a path like
// /home/runner/work/<repo>/<repo>/... -- strip that prefix so what's left
// is a path relative to the repo root, which is what the Contents API needs.
const RUNNER_PATH_PREFIX = /^\/home\/runner\/work\/[^/]+\/[^/]+\//;

@Injectable()
export class StructuralRetrievalService {
  private readonly logger = new Logger(StructuralRetrievalService.name);

  findReferencedFiles(logExcerpt: string, maxFiles = 3): string[] {
    const counts = new Map<string, number>();

    for (const match of logExcerpt.matchAll(FILE_PATH_PATTERN)) {
      let path = match[1];
      path = path.replace(RUNNER_PATH_PREFIX, "");

      if (NOISE_PATTERNS.some((p) => p.test(path))) continue;
      if (!path.includes(".") || path.startsWith(".")) continue;

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