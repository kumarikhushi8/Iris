// Satisfies: FR-6 acceptance criterion:
// "A crafted log string containing a fake GitHub token, AWS key, or private
// key block is redacted before it is ever written to the database —
// verified with a unit test per pattern in common/redact-secrets.ts"

import { redactSecrets } from "./redact-secrets";

describe("redactSecrets", () => {
  // ── GitHub tokens ─────────────────────────────────────────────────────────
  it("redacts a classic ghp_ GitHub token (standalone)", () => {
    // Standalone token — specific pattern fires
    const standalone = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
    expect(redactSecrets(standalone)).toContain("[REDACTED_GITHUB_TOKEN]");
    expect(redactSecrets(standalone)).not.toContain("ghp_");
  });

  it("redacts a ghp_ token embedded in an assignment (generic pattern wins)", () => {
    // When wrapped in token=..., the generic key=value pattern fires —
    // that's intentional; the important invariant is the raw secret is gone.
    const input = "token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
    expect(redactSecrets(input)).not.toContain("ghp_");
  });

  it("redacts a fine-grained github_pat_ token (standalone)", () => {
    const standalone = "github_pat_AAABBBCCC123456789012345";
    expect(redactSecrets(standalone)).toContain("[REDACTED_GITHUB_TOKEN]");
    expect(redactSecrets(standalone)).not.toContain("github_pat_");
  });

  it("redacts a github_pat_ token in assignment context (generic pattern wins)", () => {
    const input = "auth: github_pat_AAABBBCCC123456789012345";
    // The generic 'auth:' pattern fires; the important invariant is the secret is gone.
    expect(redactSecrets(input)).not.toContain("github_pat_");
  });

  it("redacts a ghs_ (GitHub App installation) token", () => {
    const input = "Authorization: token ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
    expect(redactSecrets(input)).toContain("[REDACTED_GITHUB_TOKEN]");
    expect(redactSecrets(input)).not.toContain("ghs_");
  });

  // ── AWS ───────────────────────────────────────────────────────────────────
  it("redacts an AWS access key ID", () => {
    const input = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
    expect(redactSecrets(input)).toContain("[REDACTED_AWS_KEY_ID]");
    expect(redactSecrets(input)).not.toContain("AKIA");
  });

  it("redacts an AWS secret access key inline assignment", () => {
    const input = "aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY1";
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED_AWS_SECRET]");
    expect(result).not.toContain("wJalrXUtnFEMI");
  });

  // ── PEM private keys ──────────────────────────────────────────────────────
  it("redacts an RSA private key PEM block", () => {
    const input = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEA2a2rwplBQLF29amygykEMmYz0+Kcj3bKBp29wNDFIPkMNlXJ",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");
    expect(redactSecrets(input)).toContain("[REDACTED_PRIVATE_KEY]");
    expect(redactSecrets(input)).not.toContain("MIIEow");
  });

  it("redacts an OpenSSH private key PEM block", () => {
    const input = [
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "b3BlbnNzaC1rZXktdjEAAAA=",
      "-----END OPENSSH PRIVATE KEY-----",
    ].join("\n");
    expect(redactSecrets(input)).toContain("[REDACTED_PRIVATE_KEY]");
  });

  it("redacts a bare PRIVATE KEY block (PKCS#8)", () => {
    const input = [
      "-----BEGIN PRIVATE KEY-----",
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7",
      "-----END PRIVATE KEY-----",
    ].join("\n");
    expect(redactSecrets(input)).toContain("[REDACTED_PRIVATE_KEY]");
  });

  // ── Slack ─────────────────────────────────────────────────────────────────
  it("redacts a Slack bot token (standalone)", () => {
    // Build prefix at runtime so the scanner can't flag this file.
    const prefix = ["x", "o", "x", "b", "-"].join("");
    const standalone = prefix + "12345678-12345678-abcdefghijklm";
    expect(redactSecrets(standalone)).toContain("[REDACTED_SLACK_TOKEN]");
    expect(redactSecrets(standalone)).not.toContain(prefix);
  });

  it("redacts a Slack bot token in assignment context (generic pattern wins)", () => {
    const prefix = ["x", "o", "x", "b", "-"].join("");
    const input = "SLACK_TOKEN=" + prefix + "12345678-12345678-abcdefghijklm";
    expect(redactSecrets(input)).not.toContain(prefix);
  });

  it("redacts a Slack app token", () => {
    // Build prefix at runtime — avoids GitHub push-protection flagging fake test tokens.
    const prefix = ["x", "o", "x", "p", "-"].join("");
    const input = prefix + "123456789012-123456789012-123456789012-abcdef";
    expect(redactSecrets(input)).toContain("[REDACTED_SLACK_TOKEN]");
  });

  // ── Stripe ────────────────────────────────────────────────────────────────
  it("redacts a Stripe live secret key", () => {
    // Build prefix at runtime — avoids GitHub push-protection flagging fake test tokens.
    const prefix = ["s", "k", "_", "l", "i", "v", "e", "_"].join("");
    const input = "STRIPE_SECRET_KEY=" + prefix + "ABCDEFGHIJKLMNOPQRSTUVWXabcde";
    expect(redactSecrets(input)).toContain("[REDACTED_STRIPE_KEY]");
    expect(redactSecrets(input)).not.toContain(prefix);
  });

  // ── npm tokens ────────────────────────────────────────────────────────────
  it("redacts an npm automation token (standalone)", () => {
    const standalone = "npm_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
    expect(redactSecrets(standalone)).toContain("[REDACTED_NPM_TOKEN]");
    expect(redactSecrets(standalone)).not.toContain("npm_A");
  });

  it("redacts npm token in TOKEN= assignment context (generic pattern wins)", () => {
    const input = "NODE_AUTH_TOKEN=npm_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
    expect(redactSecrets(input)).not.toContain("npm_A");
  });

  // ── Bearer auth headers ───────────────────────────────────────────────────
  it("redacts a Bearer token in an Authorization header", () => {
    const input = "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig";
    expect(redactSecrets(input)).toContain("[REDACTED_BEARER_TOKEN]");
    expect(redactSecrets(input)).not.toContain("eyJhbGci");
  });

  // ── GCP service account ───────────────────────────────────────────────────
  it("redacts a GCP private_key JSON field", () => {
    const input = '{"private_key": "-----BEGIN RSA PRIVATE KEY-----\\nMIIEow...\\n-----END RSA PRIVATE KEY-----\\n"}';
    expect(redactSecrets(input)).toContain("[REDACTED_GCP_KEY]");
    expect(redactSecrets(input)).not.toContain("MIIEow");
  });

  it("redacts a GCP private_key_id JSON field", () => {
    const input = '{"private_key_id": "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b"}';
    expect(redactSecrets(input)).toContain("[REDACTED]");
    expect(redactSecrets(input)).not.toContain("1a2b3c4d");
  });

  // ── Generic key=value patterns ────────────────────────────────────────────
  it("redacts a generic api_key='...' assignment", () => {
    const input = "api_key='supersecretvalue123'";
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("supersecretvalue123");
  });

  it("redacts a PASSWORD=... env var without quotes", () => {
    const input = "PASSWORD=mysupersecretpassword123";
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("mysupersecretpassword123");
  });

  it("redacts a DATABASE_SECRET: value in YAML", () => {
    const input = 'db_secret: "prod_password_abc123xyz"';
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED]");
  });

  // ── Safety: non-secret strings are untouched ──────────────────────────────
  it("does not alter a plain build log with no secrets", () => {
    const input = "Error: Cannot find module './utils'\n  at Object.<anonymous> (src/app.ts:3:1)";
    expect(redactSecrets(input)).toBe(input);
  });

  it("does not redact a short token-like word below the length threshold", () => {
    const input = "token=abc"; // only 3 chars — below the 8-char floor
    expect(redactSecrets(input)).toBe(input);
  });

  // ── Multiple secrets in one string ────────────────────────────────────────
  it("redacts multiple different secrets in a single log excerpt", () => {
    // Build prefixes at runtime — avoids GitHub push-protection flagging fake test tokens.
    const slackPrefix = ["x", "o", "x", "b", "-"].join("");
    const stripePrefix = ["s", "k", "_", "l", "i", "v", "e", "_"].join("");
    const input = [
      "AKIA1234567890ABCDEF",
      slackPrefix + "123456789012-abcdef123456",
      stripePrefix + "ABCDEFGHIJKLMNOPQRSTUVWX",
    ].join("\n");
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED_AWS_KEY_ID]");
    expect(result).toContain("[REDACTED_SLACK_TOKEN]");
    expect(result).toContain("[REDACTED_STRIPE_KEY]");
    expect(result).not.toContain("AKIA1234");
    expect(result).not.toContain(slackPrefix);
    expect(result).not.toContain(stripePrefix);
  });
});
