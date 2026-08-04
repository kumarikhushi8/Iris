# Iris — Product Requirements Document

| Field | Value |
|---|---|
| Document status | Draft |
| Version | 1.0 |
| Owner | Product / Engineering (single-owner project) |
| Related documents | `features.md`, `backend-schema.md`, `folder-structure.md`, `implementation-plan.md` |

---

## 1. Purpose

This document defines what Iris must do, for whom, and how success will be measured. It is the requirements-level counterpart to `implementation-plan.md` and `backend-schema.md`: this document defines *what* and *why*; those define *how* and *in what order*.

## 2. Problem Statement

Failing CI/CD pipelines are a significant and recurring source of lost engineering time. A typical failure requires an engineer to interrupt their current work, inspect CI logs, and manually trace the failure back to the responsible code change. This has three recurring costs:

- Diagnosis is manual and repetitive: logs, code, and pull request context are scattered and must be reassembled by hand for every failure.
- Flaky or intermittent failures are frequently re-run rather than diagnosed, wasting compute without addressing the underlying defect.
- Resolution time is inconsistent and unmeasured, making it difficult for a team to know whether pipeline reliability is improving or degrading.

## 3. Goals

- Reduce the time between a CI failure occurring and its root cause being understood.
- Ensure every suggested fix has been executed and tested before a human ever evaluates it.
- Keep a human decision-maker in control of every change proposed to a repository, with no exception.
- Make diagnosis quality measurable over time rather than assumed.
- Support the diagnosis pipeline on either a hosted or a self-hosted AI backend, so the privacy posture can change without a redesign.

## 4. Non-Goals

- Iris does not attempt to resolve infrastructure-level failures (network outages, cloud provider incidents, permission misconfiguration). These are classified and reported, not fixed.
- Iris does not merge or push changes directly to a protected branch under any configuration. The most autonomous mode still stops at a draft pull request awaiting human approval.
- Iris is not a general-purpose coding agent. Its scope is CI/CD failure diagnosis and remediation, not feature development or arbitrary code changes.
- Broad multi-host support (GitLab, Bitbucket) is not in scope for the initial version; the initial target is GitHub.

## 5. Target Users

### 5.1 Primary persona — the Reviewing Engineer
A backend or full-stack engineer on a small-to-mid-sized team who owns or frequently touches CI configuration. They are the person Iris's approval queue is built for: they need enough evidence (diff, test results, confidence) in one place to make a fast, informed decision without re-deriving the diagnosis themselves.

### 5.2 Secondary persona — the Repository Owner / Tech Lead
Configures which repositories Iris watches and what autonomy level (comment-only vs. draft-PR) is appropriate for each. Cares most about the audit trail and about Iris never taking an action without traceable justification.

## 6. User Stories

| As a... | I want to... | So that... |
|---|---|---|
| Reviewing Engineer | see a failed build's likely root cause without opening the raw CI logs myself | I can resolve failures faster |
| Reviewing Engineer | see the actual test results of a proposed fix before I approve it | I'm not trusting an unverified suggestion |
| Reviewing Engineer | reject a proposed fix with the rejection recorded | the system can improve and I retain full control |
| Repository Owner | configure whether Iris only comments or also opens draft PRs, per repository | I can adopt it cautiously on sensitive repositories |
| Repository Owner | see build health and diagnosis accuracy trends over time | I can judge whether the tool is actually helping |
| Repository Owner | be confident that no fix reaches my repository without a human decision | I can trust the system enough to adopt it at all |

## 7. Functional Requirements

Full behavioral detail for each requirement below is in `features.md`; this section is the canonical numbered list referenced everywhere else.

### 7.1 Repository Integration
- **FR-1**: The system must support connecting a repository via GitHub App installation and OAuth authorization.
- **FR-2**: The system must allow a per-repository autonomy setting of at least: `comment_only`, `draft_pr_eligible`.
- **FR-3**: The system must ingest `push`, `pull_request`, and `workflow_run` webhook events for connected repositories.

### 7.2 Ingestion and Security
- **FR-4**: All incoming webhook payloads must have their signature validated before being processed.
- **FR-5**: The webhook handler must acknowledge GitHub's delivery and enqueue the event for asynchronous processing without performing diagnosis work inline.
- **FR-6**: All logs and code content must pass through a secrets-redaction step before storage or transmission to any AI model.
- **FR-7**: The system must prevent two concurrent diagnosis attempts on the same repository and branch.

### 7.3 Diagnosis
- **FR-8**: On a detected build failure, the system must retrieve the relevant logs and correlated source code.
- **FR-9**: Code retrieval must combine semantic similarity search with structural (AST/dependency) analysis.
- **FR-10**: The system must produce a root cause explanation, a fix-type classification, a proposed diff (if applicable), and a numeric confidence score for each diagnosis.
- **FR-11**: The system must classify failures it cannot meaningfully diagnose (e.g., infrastructure-level) rather than attempt an unsupported fix.

### 7.4 Validation
- **FR-12**: Every proposed fix must be applied and executed inside an isolated sandbox running the repository's own build, lint, and test commands before being surfaced to a reviewer.
- **FR-13**: A fix that fails sandbox validation must be returned to the diagnosis step with the failure as context, for a bounded number of retries, after which it is marked inconclusive.
- **FR-14**: Sandbox execution must be bounded by resource limits (CPU, memory, time) that terminate a stalled run without treating that limit as a performance target.

### 7.5 Human Approval
- **FR-15**: A validated fix must be placed in an approval queue showing the diff, the full sandbox test result, and the confidence score.
- **FR-16**: A reviewer must be able to approve, request changes, or reject a queued fix.
- **FR-17**: No fix may be opened as a pull request without a recorded approval decision. This requirement is not configurable by any autonomy setting.
- **FR-18**: A rejection must be recorded against the diagnosis for future accuracy review.

### 7.6 Notifications and Dashboard
- **FR-19**: Notifications to reviewers must be gated by a confidence threshold to avoid low-value noise.
- **FR-20**: A dashboard must display build health trends, flaky-test detection, mean time to resolution, and diagnosis accuracy per repository.

### 7.7 Evaluation
- **FR-21**: The system must maintain a labeled evaluation set of historical failures with known root causes.
- **FR-22**: Diagnosis accuracy must be measured against the evaluation set on a recurring basis and tracked over time.

## 8. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Security | Repository content must be treated as untrusted data; nothing encountered while reading logs or code may expand the AI agent's tool permissions. |
| Security | The sandbox must run under a hardened container runtime with no network access by default and must be fully destroyed after each run. |
| Reliability | The webhook receiver must respond within GitHub's delivery timeout window regardless of diagnosis pipeline load. |
| Auditability | Every diagnosis, sandbox result, and approval decision must be retained with a full, queryable history. |
| Portability | The AI inference layer must be swappable between a hosted provider and a self-hosted model without changes to the diagnosis pipeline. |
| Scalability | Worker processing must scale horizontally via queue-based workers without architectural change. |
| Data locality | Self-hosted inference must be supported as a first-class deployment option for organizations with code confidentiality requirements. |

## 9. Success Metrics

- Every proposed fix is executed and tested in an isolated sandbox before a human reviewer sees it — 100% of surfaced fixes have an attached sandbox result.
- Zero fixes reach a repository without a logged human approval decision.
- Diagnosis accuracy is tracked against the evaluation set on a recurring cadence, with a visible trend over time rather than a single static number.
- Validation time is bounded only by resource-safety limits, never treated as a latency target to optimize against correctness.
- The dashboard's build history and MTTR figures reconcile with the underlying build and diagnosis records on inspection.

## 10. Risks

A full risk register with mitigations (security, engineering, product/trust, legal/compliance, operational) lives alongside the architecture documentation. The risks judged most consequential to product adoption specifically:

- **Loss of user trust from even a small number of incorrect suggestions** — mitigated by mandatory sandbox validation and visible confidence scoring.
- **Notification fatigue from low-value findings** — mitigated by confidence-based notification thresholds.
- **Data confidentiality concerns from sending proprietary code to a third-party model** — mitigated by first-class self-hosted deployment support.

## 11. Release Milestones

Sequenced by dependency, not calendar date. A milestone is complete when its Section 7 acceptance criteria are met — see `implementation-plan.md` for the granular task breakdown behind each one.

- **Milestone 1 — Foundation**: repository connection, authentication, event ingestion, secrets redaction, core data model.
- **Milestone 2 — Retrieval**: asynchronous pipeline, log normalization, hybrid (semantic + structural) code retrieval.
- **Milestone 3 — Diagnosis and validation**: AI diagnosis loop and sandbox validation producing verified, tested fix candidates.
- **Milestone 4 — Oversight**: human approval queue and GitHub pull request integration; nothing reaches a repository without approval.
- **Milestone 5 — Evaluation and hardening**: accuracy tracking against the evaluation set, observability instrumentation, security review of the sandbox and prompt-handling layers.

## 12. Open Questions

- What is the appropriate default confidence threshold below which a diagnosis is not surfaced to a reviewer at all?
- Should the evaluation set be seeded from publicly available CI failure datasets, from the maintainer's own repositories, or both?
- At what point does self-hosted inference become the default rather than an optional deployment mode, given current hardware constraints?
