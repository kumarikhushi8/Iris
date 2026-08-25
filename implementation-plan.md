# Iris — Implementation Plan

This plan is sequenced by **dependency order**, not calendar time — see `prd.md` §11 for the milestone-level view this expands on. Each phase has a stated goal, a task list, and acceptance criteria tied to the functional requirements in `prd.md` §7. Phases are not strictly serial where noted; some tasks can run in parallel once their prerequisites are met.

The guiding principle throughout: build a **thin, working, end-to-end pipeline first** (Phase 0), then hardening and depth are added in place, one subsystem at a time. This is deliberately different from building each subsystem to full completion in isolation — it surfaces integration problems (webhook quirks, queue timing, GitHub API permission issues) early, when they're cheap to fix, instead of at the end.

---

## Phase 0 — Walking Skeleton

**Goal:** every stage of the pipeline exists and actually runs, end to end, even in deliberately simplified form. No sandbox, no approval queue yet — output is an informational PR comment only.

**Tasks:**
- [x] Register a GitHub App (App ID, webhook secret, private key, required permissions) ✅ done (PR #3c1ec84)
- [x] Scaffold NestJS backend (`main.ts`, `app.module.ts`, base config) ✅ done (PR #8cfb434)
- [x] `docker-compose.yml` for Postgres (with pgvector) and Redis ✅ done (PR #3ab3110)
- [x] Prisma schema for `users`, `repos`, `builds`, `diagnoses` (subset of `backend-schema.md`) ✅ done (PR #60d6a17)
- [x] Webhook receiver: signature validation, fast-ack, enqueue (FR-4, FR-5) ✅ done (PR #b2e0f07)
- [x] BullMQ queue + a separate worker process ✅ done (PR #459212a)
- [x] `GithubService`: installation auth, fetch a placeholder log string, post a PR comment ✅ done (PR #b0d0b25)
- [x] `AiProvider` interface + a working Groq implementation ✅ done (PR #6092619)
- [x] Worker: on a queued job, call the AI provider with placeholder context and post the result as a comment ✅ done (PR #46e557d)

**Acceptance criteria:**
- Pushing a commit that fails CI on a connected test repository results in a PR comment within a reasonable time, with no manual intervention.
- The webhook endpoint returns `202` in under 1 second regardless of how long diagnosis takes afterward.
- No code path in this phase can open a pull request or modify repository content — comment-only, unconditionally.

---

## Phase 1 — Foundation

**Goal:** the parts of the system that everything else depends on are complete and correctly modeled, not just stubbed.

**Depends on:** Phase 0.

**Tasks:**
- [x] Full Prisma schema per `backend-schema.md` (all 8 tables, indexes, constraints) ✅ done (PR #60d6a17)
- [ ] OAuth login flow for users (FR-1)
- [ ] Repository connection flow, including `autonomy_level` selection (FR-2)
- [ ] `push` and `pull_request` event ingestion, not just `workflow_run` (FR-3)
- [ ] Secrets redaction utility applied to all log/code content at ingestion (FR-6)
- [x] Per-repo/per-branch distributed locking via Redis (FR-7) ✅ done (PR #6cc02f7)

**Acceptance criteria:**
- A new user can authenticate via GitHub OAuth and connect a repository end to end through the UI or API, with the chosen autonomy level persisted.
- A crafted log string containing a fake GitHub token, AWS key, or private key block is redacted before it is ever written to the database — verified with a unit test per pattern in `common/redact-secrets.ts`.
- Two build failures on the same branch in quick succession result in only one active diagnosis job; the second is not processed concurrently.

---

## Phase 2 — Retrieval

**Goal:** diagnosis is grounded in real, relevant context instead of a placeholder string.

**Depends on:** Phase 1 (needs `repos`/`builds` schema and redaction in place).

**Tasks:**
- [ ] Log archive download + unzip from the GitHub Actions API
- [x] Log normalization: strip ANSI/timestamps, deduplicate stack frames, extract error signature (FR-8) ✅ done (PR #af5b0a9)
- [ ] Embedding pipeline: chunk repository code, generate embeddings, populate `code_embeddings`
- [ ] Diff-aware re-indexing on push (only changed files re-embedded)
- [ ] pgvector similarity search (semantic retrieval half of FR-9)
- [x] Tree-sitter AST parsing + dependency graph traversal (structural retrieval half of FR-9) ✅ done (PR #c20d42a)
- [ ] Retrieval ranking: combine and de-duplicate results from both retrieval paths

**Acceptance criteria:**
- Given a real failing test in a test repository, the retrieval step returns the actual file containing the failure, not just semantically similar files.
- Re-indexing after a push to a 500+ file test repository only re-embeds the files that changed, verified by embedding-generation call count.
- A query against `code_embeddings` using the HNSW index returns in well under a second for a repository-scale corpus.

---

## Phase 3 — Diagnosis and Validation

**Goal:** the AI diagnosis loop produces fixes, and nothing produced is trusted until it has actually been executed.

**Depends on:** Phase 2 (retrieval feeds the diagnosis loop's context).

**Tasks:**
- [x] Bounded tool-calling diagnosis loop (read code, propose diff, self-report confidence) (FR-10) ✅ done (PR #46e557d)
- [ ] Prompt-injection guard: repository content is passed as data, never merged into system instructions (FR-10, NFR-Security)
- [ ] Infra-failure classifier: short-circuits the fix-generation path for `fix_type = 'infra'` (FR-11)
- [x] Sandbox executor: Docker + gVisor runtime, resource limits (CPU/memory/time) (FR-12) ✅ done (PR #7d0ad98)
- [x] Patch application + build/lint/test execution inside the sandbox ✅ done (PR #7b0db71)
- [ ] Bounded retry loop: sandbox failure → back to diagnosis loop with failure context, up to configured max (FR-13)
- [ ] Resource-safety timeout distinct from a performance target (FR-14)
- [ ] Self-hosted `AiProvider` implementation (vLLM/Ollama-served open-weight model), swappable via the existing interface

**Acceptance criteria:**
- A deliberately broken test (e.g., an off-by-one assertion) run through the full pipeline produces a diagnosis with `fix_type = 'test'` and a sandbox result of `pass` on the corrected patch.
- A sandbox run that hits its time limit is recorded as `result = 'timeout'`, distinct from `result = 'fail'`, and does not hang the worker process.
- Swapping `AI_PROVIDER` from `groq` to a self-hosted provider requires no changes outside `ai/ai.module.ts`.
- A crafted comment inside a test repository's code containing an instruction like "ignore previous instructions" does not change the diagnosis agent's tool permissions or behavior — verified with a dedicated adversarial test case.

---

## Phase 4 — Human Oversight

**Goal:** every validated fix requires an explicit human decision before it can reach GitHub — enforced structurally, not just by default configuration.

**Depends on:** Phase 3 (needs validated diagnoses to review).

**Tasks:**
- [x] `approvals` table wiring + `ApprovalService` ✅ done (PR #331959f)
- [x] Approval queue API: list pending diagnoses with diff, sandbox log, and confidence attached (FR-15) ✅ done (PR #331959f)
- [x] Approve / request-changes / reject actions (FR-16) ✅ done (PR #3b660db)
- [x] Structural enforcement: `github.openDraftPullRequest()` requires an `approvals` row with `decision = 'approved'` as a precondition (FR-17) ✅ done (PR #3b660db)
- [ ] Rejection logging, no PR path on rejection (FR-18)
- [ ] Confidence-threshold gating for reviewer notifications (FR-19)
- [ ] Frontend: approval queue UI (`frontend/app/approvals`)

**Acceptance criteria:**
- Attempting to call the PR-opening code path directly, bypassing the approval service, fails — this should be provable with a unit test that asserts the precondition check, not just documented as a convention.
- A rejected diagnosis never results in a GitHub API call to open a PR, verified by mocking the GitHub client and asserting zero invocations.
- A diagnosis below the configured confidence threshold does not trigger a reviewer notification, but is still visible in the queue on manual inspection.

---

## Phase 5 — Evaluation, Observability, and Hardening

**Goal:** diagnosis quality is measured, not assumed, and the system is operable and defensible under security review.

**Depends on:** Phase 4 (needs real diagnosis history to instrument and evaluate).

**Tasks:**
- [ ] `evaluation_set` seeded with hand-verified historical failures (FR-21)
- [x] Scheduled evaluation runner comparing live pipeline output to `expected_root_cause` (FR-22) ✅ done (PR #bc90c6e)
- [ ] Accuracy trend reporting, surfaced on the dashboard
- [x] Prometheus metrics: queue depth, diagnosis latency, sandbox pass/fail rate, approval rate ✅ done (PR #00463a3)
- [ ] Loki structured log shipping
- [ ] Grafana dashboards (operational) + application dashboard (product-facing, FR-20)
- [ ] Security review pass: sandbox escape testing, prompt-injection adversarial test suite, secrets-redaction pattern coverage review
- [ ] Load testing: concurrent builds across multiple repositories, confirming horizontal worker scaling holds

**Acceptance criteria:**
- The evaluation runner produces a tracked accuracy percentage after each scheduled run, queryable historically (not just the latest run).
- Grafana dashboards reflect real queue depth and sandbox outcomes during a live test run, cross-checked against database records.
- The security review pass has a written sign-off note per checked item (sandbox network isolation confirmed off, resource limits confirmed enforced, redaction patterns confirmed against a test corpus of fake secrets).

---

## Cross-cutting, ongoing throughout all phases

These are not a phase — they apply continuously from Phase 0 onward:

- **Testing:** every service gets unit tests as it's built, not retrofitted later. Integration tests for the full webhook → queue → worker → comment/PR path are added incrementally as each stage becomes real.
- **CI for Iris itself:** `.github/workflows/ci.yml` runs lint, type-check, and test on every PR to the Iris repository from Phase 0 onward — dogfooding the discipline the project itself is built around.
- **Documentation parity:** `backend-schema.md`, `folder-structure.md`, and `features.md` are updated in the same PR as any schema or module change that affects them, not after the fact.

## Explicit non-parallelizable dependencies

To avoid wasted work, note these hard sequencing constraints:

- Sandbox validation (Phase 3) cannot be meaningfully tested until retrieval (Phase 2) provides real code context — an empty-context diagnosis has nothing real to validate.
- The approval queue (Phase 4) cannot be tested end-to-end until sandbox validation (Phase 3) produces real `sandbox_runs` rows to display.
- The evaluation runner (Phase 5) cannot produce a meaningful accuracy number until Phase 4 is producing a steady stream of real, human-reviewed diagnoses to compare against.
