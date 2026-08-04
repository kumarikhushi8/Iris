# Iris — Folder Structure

This is the complete, target project layout — including subsystems not yet built in the initial walking-skeleton scaffold (`retrieval/`, `sandbox/`, `approval/`, `observability/`, `frontend/`). See `implementation-plan.md` for the order these are built in. Every folder listed here maps to a functional requirement in `prd.md` §7.

```
iris/
│
├── docker-compose.yml              # Postgres+pgvector, Redis (local dev infra)
├── .gitignore
├── README.md
├── prd.md
├── features.md
├── backend-schema.md
├── implementation-plan.md
├── LICENSE                         # MIT
│
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── nest-cli.json
│   ├── .env.example
│   ├── secrets/                    # gitignored — GitHub App private key lives here locally
│   │
│   ├── prisma/
│   │   ├── schema.prisma           # full data model — see backend-schema.md
│   │   └── migrations/
│   │
│   └── src/
│       ├── main.ts                 # API / webhook process entrypoint
│       ├── app.module.ts
│       │
│       ├── webhook/                 # FR-4, FR-5
│       │   ├── webhook.controller.ts   # signature validation, fast-ack, enqueue
│       │   └── webhook.module.ts
│       │
│       ├── queue/                   # FR-5, FR-7
│       │   ├── queue.module.ts          # BullMQ queue registration
│       │   ├── build-failure.job.ts     # job payload type
│       │   └── repo-branch-lock.service.ts   # distributed per-repo/branch locking
│       │
│       ├── worker/                  # separate process from the API
│       │   ├── main.ts                  # worker process entrypoint
│       │   ├── worker.module.ts
│       │   └── build-failure.processor.ts   # orchestrates the full diagnosis pipeline
│       │
│       ├── retrieval/                # FR-8, FR-9
│       │   ├── retrieval.module.ts
│       │   ├── log-normalization.service.ts   # strips noise, extracts error signature
│       │   ├── semantic-retrieval.service.ts  # pgvector similarity search
│       │   ├── structural-retrieval.service.ts # Tree-sitter AST + dependency graph
│       │   └── embedding.service.ts           # generates/updates code_embeddings rows
│       │
│       ├── ai/                       # FR-10, FR-11
│       │   ├── ai.module.ts              # provider selection (AI_PROVIDER token)
│       │   ├── ai-provider.interface.ts  # DiagnosisRequest / DiagnosisResult contract
│       │   ├── groq.provider.ts          # hosted, free-tier — development default
│       │   ├── self-hosted.provider.ts   # vLLM/Ollama-served open-weight model
│       │   ├── diagnosis-loop.service.ts # bounded tool-calling orchestration
│       │   └── prompt-injection-guard.ts # treats repo content as data, not instructions
│       │
│       ├── sandbox/                  # FR-12, FR-13, FR-14
│       │   ├── sandbox.module.ts
│       │   ├── sandbox-executor.service.ts   # spins up container, applies patch, runs build/lint/test
│       │   ├── sandbox-runtime.config.ts     # gVisor runtime, resource limits
│       │   └── retry-policy.service.ts       # bounded retry loop back to ai/diagnosis-loop
│       │
│       ├── approval/                 # FR-15, FR-16, FR-17, FR-18
│       │   ├── approval.module.ts
│       │   ├── approval.controller.ts    # reviewer-facing API (approve/request-changes/reject)
│       │   └── approval.service.ts       # enforces: no PR without an Approval record
│       │
│       ├── notification/             # FR-19
│       │   ├── notification.module.ts
│       │   └── confidence-threshold.service.ts
│       │
│       ├── evaluation/               # FR-21, FR-22
│       │   ├── evaluation.module.ts
│       │   ├── evaluation-runner.service.ts   # scheduled accuracy run against evaluation_set
│       │   └── accuracy-report.service.ts
│       │
│       ├── github/                   # FR-1, FR-3
│       │   ├── github.module.ts
│       │   └── github.service.ts         # Octokit wrapper: App auth, logs, comments, PRs
│       │
│       ├── database/
│       │   ├── database.module.ts
│       │   └── prisma.service.ts         # shared Postgres + pgvector connection
│       │
│       ├── observability/            # Section 8 of features.md
│       │   ├── observability.module.ts
│       │   ├── metrics.service.ts        # Prometheus client, custom metrics
│       │   └── logger.service.ts         # structured logs, shipped to Loki
│       │
│       └── common/
│           ├── redact-secrets.ts         # FR-6
│           ├── express-raw-body.d.ts
│           └── dashboard/                # FR-20: build stats query helpers shared with frontend API
│
├── frontend/
│   ├── package.json
│   ├── next.config.js
│   ├── tailwind.config.ts
│   └── app/
│       ├── dashboard/                # FR-20: build health, MTTR, accuracy trend
│       ├── approvals/                # FR-15, FR-16: reviewer queue UI
│       ├── repos/                    # FR-2: per-repository autonomy configuration
│       └── auth/                     # FR-1: GitHub OAuth flow
│
├── infra/
│   ├── prometheus/
│   │   └── prometheus.yml
│   ├── loki/
│   │   └── loki-config.yml
│   └── grafana/
│       └── dashboards/               # provisioned dashboard JSON
│
└── .github/
    └── workflows/
        ├── ci.yml                    # lint, test, build on every PR
        └── deploy.yml
```

## Module-to-requirement cross-reference

| Folder | Primary responsibility | Satisfies |
|---|---|---|
| `webhook/` | Signature validation, fast acknowledgment | FR-4, FR-5 |
| `queue/` | Async job handoff, per-branch locking | FR-5, FR-7 |
| `worker/` | Orchestrates the full pipeline per job | — (composition root) |
| `retrieval/` | Log normalization, hybrid code retrieval | FR-8, FR-9 |
| `ai/` | Diagnosis loop, provider abstraction, injection resistance | FR-10, FR-11 |
| `sandbox/` | Isolated fix validation, bounded retries | FR-12, FR-13, FR-14 |
| `approval/` | Human review gate | FR-15, FR-16, FR-17, FR-18 |
| `notification/` | Confidence-gated alerts | FR-19 |
| `evaluation/` | Accuracy tracking over time | FR-21, FR-22 |
| `github/` | All GitHub API interaction | FR-1, FR-3 |
| `observability/` | Metrics and log shipping | Section 8, features.md |
| `frontend/dashboard` | Build health / accuracy UI | FR-20 |
| `frontend/approvals` | Reviewer decision UI | FR-15, FR-16 |
| `frontend/repos` | Autonomy configuration UI | FR-2 |

## Notes on structure decisions

- **`worker/` is a separate process from `main.ts`**, not a background thread inside the API. This is what makes FR-5 (fast webhook acknowledgment) actually true under load — the API process is never blocked by diagnosis work.
- **`ai/` never imports from `sandbox/` or `approval/` directly.** The diagnosis loop produces a `DiagnosisResult`; it does not know what happens to that result afterward. This keeps the AI provider swap (Groq → self-hosted) from ever touching validation or approval logic.
- **`sandbox/` never imports from `github/`.** The sandbox only knows about the repository's build/test commands and a patch to apply — it has no ability to reach the network or call the GitHub API, which is a deliberate consequence of the sandbox's no-network-by-default posture (see `features.md` §4.2).
- **`approval/` is the only module permitted to trigger `github.openDraftPullRequest`.** This is enforced in code, not just by convention, so FR-17 (no fix reaches GitHub without approval) is structurally true rather than a policy that could be bypassed by a future change elsewhere in the codebase.
