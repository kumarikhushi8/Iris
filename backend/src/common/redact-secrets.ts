// Satisfies: FR-6
// Applied to all logs and code content before it reaches the database or
// any AI model. This is a starting set of high-confidence patterns;
// entropy-based detection for unlabeled tokens is a planned Phase 5
// hardening step (see implementation-plan.md), not yet implemented here.

type Replacer = string | ((substring: string, ...args: any[]) => string);

const PATTERNS: Array<[RegExp, Replacer]> = [
  [/ghp_[A-Za-z0-9]{36}/g, "[REDACTED_GITHUB_TOKEN]"],
  [/github_pat_[A-Za-z0-9_]{22,}/g, "[REDACTED_GITHUB_TOKEN]"],
  [/AKIA[0-9A-Z]{16}/g, "[REDACTED_AWS_KEY_ID]"],
  [/-----BEGIN (RSA|EC|OPENSSH|PGP) PRIVATE KEY-----[\s\S]+?-----END \1 PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]"],
  [
    /((?:api[_-]?key|secret|token|password)\s*[:=]\s*)['"][^'"]{8,}['"]/gi,
    (_match: string, prefix: string) => `${prefix}'[REDACTED]'`,
  ],
];

export function redactSecrets(input: string): string {
  let result = input;
  for (const [pattern, replacement] of PATTERNS) {
    result = result.replace(pattern, replacement as any);
  }
  return result;
}
