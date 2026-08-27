import { Injectable, Logger } from "@nestjs/common";

// Satisfies: FR-11
// Classifies a log excerpt as an infrastructure failure BEFORE calling
// the AI provider. If the log matches known infra patterns (OOM killer,
// disk full, DNS resolution, runner connectivity, service timeouts), we
// short-circuit the diagnosis loop:
//   • No AI call is made (saves tokens and latency)
//   • fixType is set to "infra" which prevents sandbox execution
//   • A human-readable explanation is returned for the PR comment
//
// Design: pure keyword/regex matching — no AI needed for these signals
// because they are structurally unambiguous. If you add a pattern here,
// also add a unit test in infra-classifier.spec.ts.

interface InfraClassification {
  isInfra: boolean;
  reason: string; // human-readable — appears in the PR comment
}

// Each entry: [regex to match, human-readable reason]
// Patterns are matched case-insensitively against the full log excerpt.
const INFRA_PATTERNS: Array<[RegExp, string]> = [
  // OOM / memory
  [/Out of memory|Killed\s+process|MemoryError|Cannot allocate memory/i,
    "Runner ran out of memory (OOM killer fired)"],

  // Disk / filesystem
  [/No space left on device|Disk quota exceeded|ENOSPC/i,
    "Runner disk is full — no space left on device"],

  // DNS / network
  [/Could not resolve host|Name or service not known|getaddrinfo ENOTFOUND|socket hang up|ECONNREFUSED|ECONNRESET/i,
    "Network or DNS resolution failure — likely a transient runner networking issue"],

  // GitHub Actions service / runner
  [/The runner has received a shutdown signal|Job was cancelled|Runner\.Worker.*lost connection/i,
    "GitHub Actions runner was shut down or lost connection mid-job"],

  // Timeout / rate limit
  [/Request timeout|execution time limit|Throttled|rate limit exceeded/i,
    "External service timeout or rate limit — retry the job"],

  // Docker / container
  [/no such image|docker: Error response from daemon|Cannot connect to the Docker daemon/i,
    "Docker daemon error on the runner — infrastructure issue"],

  // Package registry connectivity (npm, pip, etc.)
  [/ETIMEDOUT.*registry\.npmjs\.org|pip.*Could not fetch URL|gem.*Errno::ECONNRESET/i,
    "Package registry unreachable — transient network issue"],
];

@Injectable()
export class InfraClassifierService {
  private readonly logger = new Logger(InfraClassifierService.name);

  /**
   * Returns { isInfra: true, reason } if the log excerpt matches a known
   * infrastructure failure pattern, { isInfra: false } otherwise.
   */
  classify(logExcerpt: string): InfraClassification {
    for (const [pattern, reason] of INFRA_PATTERNS) {
      if (pattern.test(logExcerpt)) {
        this.logger.log(`Infra failure detected: "${reason}" (pattern: ${pattern.source.slice(0, 40)}…)`);
        return { isInfra: true, reason };
      }
    }
    return { isInfra: false, reason: "" };
  }
}
