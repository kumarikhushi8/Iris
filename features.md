# Iris — Feature Specification

This document enumerates every feature of Iris, grouped by subsystem. Each feature lists its behavior, the configuration or constraints that govern it, and the functional requirement(s) it satisfies (see `prd.md`, Section 7). Nothing listed here is optional scope — every feature is part of the system as designed, not a stretch goal.

---

## 1. Repository Integration

### 1.1 GitHub App connection
Repositories are connected via GitHub App installation, not personal access tokens. Installation grants Iris only the scopes it needs (Actions: read, Contents: read, Pull requests: read/write, Issues: write) and can be revoked per-repository by the owner at any time.
*Satisfies: FR-1*

### 1.2 OAuth-based user authentication
Individual users authenticate via GitHub OAuth. A user's identity is tied to their GitHub account; there is no separate password system to secure.
*Satisfies: FR-1*

### 1.3 Per-repository autonomy configuration
Each connected repository has an independent autonomy setting:
- **`comment_only`** (default for newly connected repositories) — Iris posts its diagnosis as a pull request comment only. No code is ever proposed as a diff to GitHub.
- **`draft_pr_eligible`** — a validated, approved fix may be opened as a **draft** pull request. This setting does not permit auto-merge under any circumstance; see Section 6.
*Satisfies: FR-2*

### 1.4 Event ingestion
Iris subscribes to and processes `push`, `pull_request`, and `workflow_run` webhook events for every connected repository.
*Satisfies: FR-3*

---

## 2. Ingestion & Security

### 2.1 Webhook signature validation
Every incoming webhook payload is validated against its `X-Hub-Signature-256` header using the shared webhook secret before any further processing occurs. Payloads that fail validation are rejected with `401` and never reach the queue.
*Satisfies: FR-4*

### 2.2 Fast acknowledgment, asynchronous processing
The webhook receiver validates and enqueues within GitHub's delivery timeout window. No log fetching, retrieval, diagnosis, or sandbox work ever happens on the webhook request path — all of it happens in a separate worker process, off a queue.
*Satisfies: FR-5*

### 2.3 Secrets redaction
All log content and code retrieved from a repository passes through a redaction pass — pattern-based (known token/key formats) and entropy-based (high-entropy strings resembling secrets) — before being persisted to the database or included in any prompt sent to a model.
*Satisfies: FR-6*

### 2.4 Per-repository, per-branch concurrency locking
A distributed lock (keyed on repository + branch) ensures only one diagnosis attempt is active per branch at a time. A second failure on the same branch while a diagnosis is in progress is queued behind the first, not processed concurrently, which prevents two independently-generated fixes from conflicting.
*Satisfies: FR-7*

---

## 3. Diagnosis

### 3.1 Log retrieval and normalization
On a failed `workflow_run`, Iris downloads the run's log archive, extracts the failing job/step, and normalizes it: strips ANSI codes and timestamps, deduplicates repeated stack frames, and isolates the actual error signature from surrounding noise.
*Satisfies: FR-8*

### 3.2 Hybrid code retrieval
Relevant code is retrieved two ways in combination, not one:
- **Semantic retrieval** — pgvector similarity search over embedded code chunks
- **Structural retrieval** — Tree-sitter-based AST parsing and dependency graph traversal, to resolve exact imports/symbols the failure references

Combining both is required because embedding similarity alone frequently misses exact symbol references, and structural analysis alone misses conceptually related code that isn't a direct dependency.
*Satisfies: FR-9*

### 3.3 AI diagnosis loop
A bounded, explicit tool-calling loop (not a single prompt/response) reads code, reasons about the failure, and produces:
- `rootCause` — a concise explanation of what actually broke
- `fixType` — one of `lint`, `test`, `dependency`, `infra`, `unknown`
- `confidence` — a 0.0–1.0 score
- `proposedDiff` — a unified diff, or `null` if no safe fix can be proposed

All repository content passed into this loop is treated as untrusted data. Nothing encountered while reading logs or code can expand the agent's tool permissions or alter its instructions (prompt-injection resistance).
*Satisfies: FR-10*

### 3.4 Infrastructure-failure classification
Failures classified as `infra` (network, permissions, cloud/runner outages, secret misconfiguration) are reported with their classification and evidence, but **no fix is attempted**. This is a hard scope boundary, not a quality shortfall to be improved later.
*Satisfies: FR-11*

---

## 4. Sandbox Validation

### 4.1 Isolated execution
Every proposed fix — before any human ever sees it — is applied inside a fresh, disposable container and validated by running the repository's own build, lint, and test commands against the patched code.

### 4.2 Hardened isolation
Sandbox containers run under a hardened runtime (gVisor) rather than a plain shared-kernel container, with:
- No network access by default
- Enforced CPU, memory, and wall-clock time limits
- Full destruction of the container after every run, win or lose
*Satisfies: FR-12*

### 4.3 Bounded retry loop
A fix that fails sandbox validation is returned to the diagnosis loop (Section 3.3) with the failure output as new context, and a new attempt is generated — up to a fixed retry limit (default: 3). After the limit is reached, the diagnosis is marked `inconclusive` and a reviewer is notified without a proposed fix.
*Satisfies: FR-13*

### 4.4 Resource-safety time bound, not a performance target
Sandbox validation is allowed to run as long as the repository's own CI process typically takes. A timeout exists only to kill a run that has clearly stalled (default: repository's typical CI duration × a safety multiplier), never to cut off a validation that is still legitimately running.
*Satisfies: FR-14*

---

## 5. Human Approval

### 5.1 Mandatory approval queue
Every fix that passes sandbox validation is placed in a review queue, never sent directly to GitHub. The queue entry shows, together, in one place:
- The proposed diff
- The full sandbox test log and pass/fail result
- The diagnosis confidence score
*Satisfies: FR-15*

### 5.2 Reviewer decisions
A reviewer may **approve**, **request changes**, or **reject** a queued fix. Approval is the only path that results in a pull request being opened.
*Satisfies: FR-16*

### 5.3 Non-configurable approval gate
No autonomy setting, confidence score, or configuration flag can cause a fix to be opened as a pull request without a recorded human approval decision. This is enforced structurally (the PR-opening code path requires an `Approval` record with `decision = approved` as a precondition), not just by default configuration.
*Satisfies: FR-17*

### 5.4 Rejection logging
A rejection decision is recorded against the diagnosis, including which reviewer rejected it, for future accuracy analysis. No pull request is opened on rejection.
*Satisfies: FR-18*

---

## 6. Notifications & Dashboard

### 6.1 Confidence-gated notifications
Reviewers are not notified of low-confidence or unvalidated findings. A configurable confidence threshold determines what reaches a human as an actionable notification versus what is logged silently for later review.
*Satisfies: FR-19*

### 6.2 Operational dashboard
A dashboard (Next.js frontend, reading from PostgreSQL and Prometheus/Loki) reports, per connected repository:
- Build success/failure trend over time
- Flaky test detection (tests that fail intermittently on the same commit)
- Mean time to resolution (MTTR)
- Diagnosis accuracy, tracked against the evaluation set (Section 7)
*Satisfies: FR-20*

---

## 7. Evaluation & Quality Assurance

### 7.1 Labeled evaluation set
A maintained set of historical build failures, each with a verified, known-correct root cause, is stored independently of live diagnosis traffic.
*Satisfies: FR-21*

### 7.2 Recurring accuracy measurement
The current diagnosis pipeline is run against the evaluation set on a recurring schedule (not just once at launch), producing a tracked accuracy metric over time. This allows changes to prompts, retrieval logic, or the underlying model to be evaluated against a consistent baseline before being adopted.
*Satisfies: FR-22*

---

## 8. Observability

### 8.1 Metrics
Prometheus collects time-series metrics: queue depth, diagnosis latency, sandbox pass/fail rates, approval rates, and per-repository build volume.

### 8.2 Log aggregation
Loki centralizes structured application logs (not build logs — those are handled separately and redacted per Section 2.3) for operational debugging of Iris itself.

### 8.3 Dashboards
Grafana visualizes Prometheus and Loki data for operational monitoring, separate from the application-level dashboard described in Section 6.2, which is product-facing rather than operations-facing.

---

## Feature summary table

| # | Feature | Subsystem | FR reference |
|---|---|---|---|
| 1 | GitHub App connection | Repository Integration | FR-1 |
| 2 | OAuth authentication | Repository Integration | FR-1 |
| 3 | Per-repository autonomy setting | Repository Integration | FR-2 |
| 4 | Event ingestion | Repository Integration | FR-3 |
| 5 | Webhook signature validation | Ingestion & Security | FR-4 |
| 6 | Fast-ack, async processing | Ingestion & Security | FR-5 |
| 7 | Secrets redaction | Ingestion & Security | FR-6 |
| 8 | Per-repo/branch locking | Ingestion & Security | FR-7 |
| 9 | Log retrieval and normalization | Diagnosis | FR-8 |
| 10 | Hybrid code retrieval | Diagnosis | FR-9 |
| 11 | AI diagnosis loop | Diagnosis | FR-10 |
| 12 | Infra-failure classification | Diagnosis | FR-11 |
| 13 | Isolated sandbox execution | Sandbox Validation | FR-12 |
| 14 | Bounded retry loop | Sandbox Validation | FR-13 |
| 15 | Resource-safety time bound | Sandbox Validation | FR-14 |
| 16 | Mandatory approval queue | Human Approval | FR-15 |
| 17 | Reviewer decisions | Human Approval | FR-16 |
| 18 | Non-configurable approval gate | Human Approval | FR-17 |
| 19 | Rejection logging | Human Approval | FR-18 |
| 20 | Confidence-gated notifications | Notifications & Dashboard | FR-19 |
| 21 | Operational dashboard | Notifications & Dashboard | FR-20 |
| 22 | Labeled evaluation set | Evaluation & QA | FR-21 |
| 23 | Recurring accuracy measurement | Evaluation & QA | FR-22 |
| 24 | Metrics collection | Observability | — |
| 25 | Log aggregation | Observability | — |
| 26 | Operational dashboards | Observability | — |
