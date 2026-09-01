# Iris

**An AI-powered DevOps copilot that diagnoses, validates, and proposes fixes for failing CI/CD pipelines — with mandatory human approval before any change reaches a repository.**

Iris connects to a GitHub repository and watches its continuous integration pipeline. When a build fails, Iris retrieves the relevant logs and code, diagnoses the likely root cause, and generates a candidate fix. Before that fix is ever shown to a person, it is applied inside an isolated sandbox and validated by actually running the repository's own build, lint, and test commands. Only a fix that passes validation — together with its test evidence and a confidence score — is placed in a review queue. A human reviewer has final authority to approve, request changes, or reject it. No change reaches a repository without an explicit, logged human decision.

---

## Table of contents

- [Why Iris](#why-iris)
- [Core features](#core-features)
- [System architecture](#system-architecture)
- [End-to-end workflow](#end-to-end-workflow)
- [Technology stack](#technology-stack)
- [Database design](#database-design)
- [Security and trust model](#security-and-trust-model)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Development workflow](#development-workflow)
- [Build roadmap](#build-roadmap)
- [Known limitations](#known-limitations)

---

## Why Iris

Failing CI/CD pipelines are one of the most common sources of lost engineering time. A typical failure requires an engineer to stop what they're doing, open the CI logs, and manually trace the failure back to the responsible code change — while flaky tests get blindly re-run instead of diagnosed, and resolution time goes unmeasured.

Established tools already address parts of this problem — autonomous coding agents and CI-focused review products exist from several vendors, and their existence validates the demand rather than reducing the value of building this. What differentiates Iris is not the diagnosis step itself, which comparable tools also perform, but the **validation and trust layer around it**: every proposed fix is executed and tested in isolation before a human ever sees it, and every fix additionally requires explicit human approval before it is proposed to a repository. This is a deliberately more conservative, more auditable design than a system that opens pull requests directly from a single model completion.

## Core features

- **Repository integration** — GitHub App installation and OAuth, with per-repository autonomy configuration
- **Event ingestion** — listens for push, pull request, and workflow run activity, with per-repository and per-branch locking to prevent conflicting concurrent fixes
- **Secrets redaction** — all logs and code are scrubbed for credentials and tokens before storage or before being sent to any model
- **Hybrid retrieval** — combines pgvector semantic search with AST-based structural analysis and dependency graph traversal, so diagnosis is grounded in the code that actually matters, not just what "sounds similar"
- **Bounded AI diagnosis loop** — a tool-calling agent reads code, proposes a fix, and reports a confidence score; it does not have standing permission to act beyond that
- **Sandbox validation** — every proposed fix is applied inside an isolated, resource-limited container and validated by actually running the repository's own build, lint, and test commands before anything is trusted
- **Bounded retry loop** — a fix that fails sandbox validation is returned to the diagnosis agent with the failure as new context, up to a fixed retry limit, after which it is marked inconclusive rather than retried indefinitely
- **Mandatory human approval** — every validated fix is queued for review with its diff, its sandbox test results, and its confidence score attached; no autonomy setting permits a fully automatic merge
- **Confidence-based notification thresholds** — low-confidence or unvalidated findings are not pushed to reviewers as noise
- **Evaluation harness** — a maintained, labeled set of historical failures with known root causes, used to measure diagnosis accuracy over time rather than assume it
- **Operational dashboard** — build health trends, flaky test detection, mean time to resolution (MTTR), and diagnosis accuracy

## System architecture

Iris is organized into six layers:

1. **Source & trigger** — the GitHub repository itself, emitting push and build events
2. **Ingestion & security** — webhook receipt and signature validation, secrets redaction, and the job queue
3. **Context & retrieval** — the worker and its hybrid (semantic + structural) code retrieval
4. **Diagnosis & validation** — the AI diagnosis agent and the sandbox executor that validates its output
5. **Human oversight** — the mandatory approval queue
6. **Data & observability** — PostgreSQL/pgvector, Prometheus, Loki, and Grafana

The webhook receiver responds to GitHub within its delivery timeout and does no slow work inline — everything past validation and enqueueing happens asynchronously in a background worker. This is a deliberate reliability boundary, not an implementation detail: GitHub retries deliveries that don't get a fast 2xx response, so nothing diagnosis-related is allowed to sit in that code path.

## End-to-end workflow

1. A developer pushes code; GitHub Actions runs the CI pipeline
2. The build fails; GitHub sends a `workflow_run` webhook
3. The webhook receiver validates the signature, redacts secrets, and enqueues a job — in under a second
4. A worker retrieves logs and code context via hybrid retrieval
5. The AI agent diagnoses the root cause and proposes a fix
6. The sandbox applies the patch and runs the repository's own build, lint, and test commands
7. The validation result is recorded with a confidence score
   - If validation fails, the failure is returned to the AI agent as context for a bounded number of retries
8. A reviewer sees the diff, the sandbox test results, and the confidence score, and approves, requests changes, or rejects
   - A rejection is logged; no pull request is opened
9. An approved fix is opened as a draft pull request
10. The outcome is stored, and the dashboard reflects it (build trend, MTTR, accuracy)

Validation is **not time-boxed to a fixed duration**. It runs for as long as the repository's own build and test process actually takes. A bounded upper limit exists only as a resource safeguard — to terminate a run that has clearly stalled — not as a performance target. Correctness takes priority over speed throughout this pipeline.

## Technology stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js, React, TypeScript, Tailwind CSS | Server-side rendering and file-based routing reduce boilerplate; static typing catches integration errors before runtime |
| Backend API | Node.js with NestJS, TypeScript | Modular, dependency-injected architecture suited to a system with several distinct subsystems (ingestion, retrieval, diagnosis, approval) |
| Database | PostgreSQL with the pgvector extension | One relational store for transactional data and vector similarity search — no second specialized database to operate |
| Asynchronous processing | Redis with BullMQ | Decouples the webhook response from longer-running diagnosis work; provides retries, backoff, and distributed per-repo/per-branch locking |
| Structural retrieval | Tree-sitter (AST parsing) + dependency graph traversal | Supplements semantic embedding search with exact symbol and import resolution |
| AI inference | Pluggable provider interface — Groq (hosted, free tier) for development; self-hosted open-weight model as the production target | Keeps the diagnosis pipeline independent of which model is behind it; see [Known limitations](#known-limitations) for current hardware constraints |
| Agent orchestration | A custom, explicitly defined tool-calling loop | Each diagnosis step is inspectable and testable, and resistant to instructions embedded in untrusted repository content (prompt injection) |
| Sandbox execution | Docker with a hardened runtime (gVisor), enforced CPU/memory/time limits, no network access by default | Real build/test execution against a proposed fix, isolated from the host at the kernel level |
| Secrets redaction | Pattern- and entropy-based scrubbing | Prevents credentials in logs/code from being persisted or transmitted unnecessarily |
| Authentication | GitHub OAuth + GitHub App installation | Reuses the identity and permission model GitHub already requires for repository access |
| Containerization | Docker | Consistent runtime across development and deployment |
| CI/CD | GitHub Actions | Automates testing and deployment of Iris itself |
| Metrics | Prometheus | Time-series metrics: queue depth, diagnosis latency, sandbox outcomes, approval rates |
| Logs | Loki | Centralized structured application logs, paired with Prometheus |
| Dashboards | Grafana | Visualizes Prometheus/Loki data, alongside the application's own build/accuracy dashboard |

## Database design

All relational data and vector embeddings live in a single PostgreSQL instance extended with pgvector, so a single query can combine relational filtering with a similarity search over code embeddings.

| Table | Purpose |
|---|---|
| `users` | Authenticated accounts, including reviewer role designation |
| `repos` | Connected repositories and their configured autonomy level |
| `builds` | Individual CI run records |
| `diagnoses` | AI-generated root cause, fix type, confidence score, retry count |
| `sandbox_runs` | The executed validation result and test log for each attempted fix |
| `approvals` | The reviewer, decision, and resulting pull request for each diagnosis |
| `code_embeddings` | Vectorized code chunks used for semantic retrieval |
| `evaluation_set` | Labeled historical failures used to measure diagnosis accuracy |

## Security and trust model

Iris reads, executes, and proposes changes to real source code, so its security posture is treated as a first-class part of the design, not an afterthought:

- **The sandbox is itself an attack surface.** It runs untrusted repository code, so it uses a hardened container runtime (gVisor), no network access by default, and strict resource limits, with full destruction after every run.
- **Repository content is data, never instructions.** Adversarial text embedded in code or logs (prompt injection) cannot expand the AI agent's tool permissions, which are fixed at the start of a run.
- **Secrets never leave unredacted.** All logs and code are scrubbed for credentials before storage or transmission to any model.
- **Nothing merges without a human.** Autonomy configuration controls whether a fix is surfaced as a comment or a draft PR — it never controls whether human approval is required. That gate is not configurable.

## Project structure

```
iris/
  docker-compose.yml          Postgres+pgvector, Redis
  backend/
    prisma/schema.prisma      Full data model
    src/
      main.ts                  API / webhook process entrypoint
      webhook/                 Signature verification + fast enqueue
      queue/                   BullMQ queue definition + job payload types
      worker/
        main.ts                 Legacy worker process entrypoint
        build-failure.processor.ts   The diagnosis pipeline
      retrieval/                Hybrid (pgvector + AST) code retrieval
      ai/                       Provider-agnostic diagnosis interface + implementations
      sandbox/                  Isolated fix validation (Docker + gVisor)
      approval/                 Human review queue
      github/                   Octokit wrapper (App auth, logs, comments, PRs)
      database/                 Prisma service (shared Postgres + pgvector)
      observability/            Prometheus metrics, structured logging
      common/                   Cross-cutting utilities (secrets redaction, etc.)
  frontend/
    (Next.js dashboard and approval UI)
```

## Getting started

### Prerequisites

- Node.js 20+
- Docker
- A GitHub account you can register a GitHub App under
- A free Groq API key (development inference — see [Known limitations](#known-limitations))

### Setup

```bash
# 1. Start Postgres and Redis
docker compose up -d

# 2. Register a GitHub App (Settings -> Developer settings -> GitHub Apps)
#    - Webhook URL: <your tunnel>/webhooks/github
#    - Permissions: Actions (read), Contents (read), Pull requests (read/write), Issues (write)
#    - Subscribe to: workflow_run
#    - Generate and download a private key

# 3. Configure environment
cd backend
cp .env.example .env
# fill in GITHUB_APP_ID, GITHUB_WEBHOOK_SECRET, GROQ_API_KEY
# place the downloaded .pem at backend/secrets/github-app-private-key.pem

# 4. Install dependencies and set up the database
npm install
npm run prisma:generate
npm run prisma:migrate

# 5. Run it (two terminals)
ngrok http 3000            # tunnel so GitHub can reach the webhook
npm run start:dev          # API, webhook receiver, and background workers
```

Install the GitHub App on a small test repository, push a commit that fails CI, and watch the worker pick up the job.

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `DIRECT_URL` | Postgres connection strings (`DIRECT_URL` used for migrations) |
| `REDIS_HOST`, `REDIS_PORT` | Queue connection |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH`, `GITHUB_WEBHOOK_SECRET` | GitHub App auth |
| `AI_PROVIDER`, `GROQ_API_KEY`, `GROQ_MODEL` | AI inference provider selection |
| `SANDBOX_MAX_RUNTIME_MS`, `SANDBOX_MEMORY_LIMIT_MB`, `SANDBOX_CPU_LIMIT` | Sandbox resource safety bounds |
| `PORT` | API server port |

## Development workflow

Recommended build order — a *working, thin, end-to-end pipeline first*, hardened incrementally, rather than each subsystem built to completion in isolation:

1. Webhook receipt → queue → worker, with a placeholder diagnosis and a PR comment
2. Real log retrieval and normalization
3. Hybrid retrieval (pgvector + AST/dependency graph)
4. Real AI diagnosis via the provider interface
5. Sandbox validation
6. Human approval queue
7. Observability (Prometheus/Loki/Grafana) and the evaluation harness

## Build roadmap

- **Phase 1 — Foundation:** repository integration, authentication, event ingestion, secrets redaction, core data schema
- **Phase 2 — Retrieval:** asynchronous processing pipeline, log normalization, embedding-based and structural retrieval
- **Phase 3 — Diagnosis and validation:** the AI diagnosis loop, sandbox execution environment, bounded retry mechanism
- **Phase 4 — Oversight and observability:** human approval queue, GitHub PR integration, Prometheus/Loki instrumentation, dashboards
- **Phase 5 — Evaluation and hardening:** the labeled evaluation set, accuracy tracking, concurrency locking, security review of the sandbox and prompt-handling layers

## Known limitations

- **Local development hardware cannot run a capable model.** A 4GB laptop GPU can't fit any of the coding models with adequate accuracy for this task. Development uses a hosted free-tier provider (Groq) against non-sensitive test repositories; self-hosting remains the target for any deployment against private or proprietary code, once running on adequate hardware.
- **Infrastructure-level failures are out of scope for automated fixes.** Network, permissions, cloud outages, and secret misconfiguration are classified and reported, not auto-resolved.
- **Multi-language support is incremental**, not universal at launch — each language/ecosystem needs its own log-parsing and build-system adapter.
- **Diagnosis accuracy is bounded by model capability.** Self-hostable open-weight coding models currently trail frontier closed models by a meaningful margin on real-world software engineering benchmarks; this is a known, tracked trade-off, not a hidden one.
- **Semantic retrieval implemented but not yet enabled.** The code embedding and cosine similarity query logic is complete, but it is explicitly disabled by default (`SEMANTIC_RETRIEVAL_ENABLED=false`). It requires a real Gemini API key to function. The system successfully relies on AST/structural retrieval (regex-based matching) in the meantime.
