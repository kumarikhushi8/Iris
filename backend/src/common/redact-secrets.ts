// Satisfies: FR-6
// Applied to all logs and code content before it reaches the database or
// any AI model. Patterns are ordered most-specific first to avoid partial
// matches shadowing more precise ones.
//
// entropy-based detection for unlabeled tokens is a planned Phase 5
// hardening step (see implementation-plan.md), not yet implemented here.

type Replacer = string | ((substring: string, ...args: any[]) => string);

const PATTERNS: Array<[RegExp, Replacer]> = [
  // -- GitHub tokens --------------------------------------------------------
  [/ghp_[A-Za-z0-9]{36}/g, "[REDACTED_GITHUB_TOKEN]"],
  [/github_pat_[A-Za-z0-9_]{22,}/g, "[REDACTED_GITHUB_TOKEN]"],
  [/ghs_[A-Za-z0-9]{36}/g, "[REDACTED_GITHUB_TOKEN]"],       // GitHub App installation tokens
  [/ghr_[A-Za-z0-9]{36}/g, "[REDACTED_GITHUB_TOKEN]"],       // GitHub refresh tokens

  // -- AWS ------------------------------------------------------------------
  [/AKIA[0-9A-Z]{16}/g, "[REDACTED_AWS_KEY_ID]"],
  // AWS secret access keys are typically 40 chars of base64url after "aws_secret"
  [
    /(aws_secret_access_key\s*[=:]\s*)([A-Za-z0-9/+]{40})/gi,
    (_m: string, prefix: string) => `${prefix}[REDACTED_AWS_SECRET]`,
  ],

  // -- PEM blocks -----------------------------------------------------------
  [/-----BEGIN (RSA|EC|OPENSSH|PGP|DSA) PRIVATE KEY-----[\s\S]+?-----END \1 PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]"],
  [/-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]"],

  // -- Slack ----------------------------------------------------------------
  [/xox[baprs]-[0-9A-Za-z-]{10,}/g, "[REDACTED_SLACK_TOKEN]"],

  // -- Stripe ---------------------------------------------------------------
  [/sk_live_[A-Za-z0-9]{24,}/g, "[REDACTED_STRIPE_KEY]"],
  [/rk_live_[A-Za-z0-9]{24,}/g, "[REDACTED_STRIPE_KEY]"],

  // -- Google / GCP ---------------------------------------------------------
  // Service account JSON contains "private_key_id" and "private_key" fields
  [/"private_key"\s*:\s*"[^"]{20,}"/g, '"private_key": "[REDACTED_GCP_KEY]"'],
  [/"private_key_id"\s*:\s*"[A-Fa-f0-9]{40}"/g, '"private_key_id": "[REDACTED]"'],

  // -- npm tokens -----------------------------------------------------------
  [/npm_[A-Za-z0-9]{36}/g, "[REDACTED_NPM_TOKEN]"],

  // -- Bearer auth headers --------------------------------------------------
  [/(Authorization:\s*Bearer\s+)[A-Za-z0-9\-._~+/]{16,}/gi,
    (_m: string, prefix: string) => `${prefix}[REDACTED_BEARER_TOKEN]`,
  ],

  // -- Generic key=value / key: "value" assignments (env vars, config) ------
  // Matches: api_key="abc123", SECRET: 'abc123', TOKEN=abc123 etc.
  [
    /((?:api[_-]?key|secret|token|password|credentials?|auth)\s*[:=]\s*)(['"]?)([^'"\s]{8,})\2/gi,
    (_match: string, prefix: string, quote: string) =>
      `${prefix}${quote}[REDACTED]${quote}`,
  ],
];

export function redactSecrets(input: string): string {
  let result = input;
  for (const [pattern, replacement] of PATTERNS) {
    result = result.replace(pattern, replacement as any);
  }
  return result;
}
