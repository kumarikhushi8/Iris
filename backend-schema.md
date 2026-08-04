# Iris — Backend Schema

Single PostgreSQL 16 instance, extended with the `pgvector` extension. All relational data and embedding vectors live in this one database — see `prd.md` §8 (Non-Functional Requirements, Portability/Data locality) and the rationale in the architecture documentation for why this is one database rather than a database plus a separate vector store.

Field names below match `backend/prisma/schema.prisma` exactly (camelCase in Prisma/TypeScript, `snake_case` in the actual Postgres columns via `@map`).

---

## Extension setup

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

---

## `users`

Authenticated accounts. A user is either a developer (connects repositories) or a reviewer (approves/rejects fixes) — the same account can hold both roles.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `github_id` | `text` | UNIQUE, NOT NULL | GitHub account ID, source of truth for identity |
| `name` | `text` | NULL | |
| `email` | `text` | NULL | |
| `role` | `text` | NOT NULL, default `'developer'` | `developer` \| `reviewer` \| `admin` |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

**Indexes:** unique index on `github_id` (identity lookup on every OAuth login).

**Relationships:** one user → many `repos` (owner); one user → many `approvals` (as reviewer).

---

## `repos`

A repository connected to Iris via GitHub App installation.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `user_id` | `uuid` | FK → `users.id`, NOT NULL | Connecting user |
| `github_repo_id` | `text` | NOT NULL | GitHub's numeric repo ID |
| `name` | `text` | NOT NULL | `owner/name` |
| `installation_id` | `text` | NOT NULL | GitHub App installation ID, required for every API call against this repo |
| `autonomy_level` | `text` | NOT NULL, default `'comment_only'` | `comment_only` \| `draft_pr_eligible` — see `features.md` §1.3 |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

**Indexes:** unique index on `github_repo_id`; index on `user_id`.

**Relationships:** many repos → one user; one repo → many `builds`; one repo → many `code_embeddings`.

**Invariant:** `autonomy_level = 'draft_pr_eligible'` changes *whether a draft PR can be opened after approval*. It never changes whether approval is required — see `approvals` below and FR-17.

---

## `builds`

One row per CI run (a `workflow_run` completion, successful or failed).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `repo_id` | `uuid` | FK → `repos.id`, NOT NULL | |
| `commit_sha` | `text` | NOT NULL | |
| `branch` | `text` | NOT NULL | Used for the per-branch concurrency lock, see `queue/repo-branch-lock.service.ts` |
| `status` | `text` | NOT NULL | `queued` \| `diagnosing` \| `passed` \| `failed` |
| `duration_ms` | `integer` | NULL | CI run duration, for MTTR/dashboard calculations |
| `started_at` | `timestamptz` | NOT NULL, default `now()` | |
| `finished_at` | `timestamptz` | NULL | |

**Indexes:** index on `(repo_id, branch)` (concurrency lock lookups, FR-7); index on `(repo_id, started_at)` (dashboard trend queries, FR-20).

**Relationships:** many builds → one repo; one build → zero-or-one `diagnoses`; one build → zero-or-one `evaluation_set` entry.

---

## `diagnoses`

The AI's analysis of a single failed build. One diagnosis per build — retries within the sandbox validation loop update this row rather than creating new ones (see `sandbox_runs` for the individual attempt history).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `build_id` | `uuid` | FK → `builds.id`, UNIQUE, NOT NULL | One-to-one with `builds` |
| `root_cause` | `text` | NULL | Populated once diagnosis completes |
| `fix_type` | `text` | NULL | `lint` \| `test` \| `dependency` \| `infra` \| `unknown` — FR-10 |
| `confidence` | `real` | NULL | 0.0–1.0 |
| `retry_count` | `integer` | NOT NULL, default `0` | Incremented on each sandbox-validation-failure retry, bounded per FR-13 |
| `status` | `text` | NOT NULL, default `'diagnosing'` | `diagnosing` \| `validating` \| `awaiting_approval` \| `approved` \| `rejected` \| `inconclusive` |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

**Indexes:** unique index on `build_id`; index on `status` (queue/dashboard queries).

**Relationships:** one diagnosis → one build; one diagnosis → many `sandbox_runs`; one diagnosis → zero-or-one `approval`.

**Invariant:** `status = 'inconclusive'` is set only when `retry_count` reaches the configured maximum (default 3) and the most recent `sandbox_runs` entry is `fail` — see FR-13.

---

## `sandbox_runs`

Every individual sandbox validation attempt for a diagnosis. A diagnosis with `retry_count = 2` has up to 3 `sandbox_runs` rows (initial attempt + 2 retries).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `diagnosis_id` | `uuid` | FK → `diagnoses.id`, NOT NULL | |
| `result` | `text` | NOT NULL | `pass` \| `fail` \| `timeout` |
| `test_log` | `text` | NULL | Full build/lint/test output from the sandbox, redacted per FR-6 before storage |
| `duration_ms` | `integer` | NULL | Actual wall-clock time the validation took — tracked but never used as a target, per FR-14 |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

**Indexes:** index on `diagnosis_id`.

**Relationships:** many sandbox runs → one diagnosis.

**Invariant:** a `result = 'timeout'` row means the resource-safety limit was hit (FR-14) — this is distinct from `fail`, which means the validation ran to completion and the patched code did not pass.

---

## `approvals`

The human decision on a diagnosis that reached `awaiting_approval`. This table is the structural enforcement point for FR-17.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `diagnosis_id` | `uuid` | FK → `diagnoses.id`, UNIQUE, NOT NULL | One-to-one with `diagnoses` |
| `reviewer_id` | `uuid` | FK → `users.id`, NULL | NULL while `decision = 'pending'` |
| `decision` | `text` | NOT NULL, default `'pending'` | `pending` \| `approved` \| `changes_requested` \| `rejected` |
| `pr_url` | `text` | NULL | Populated only after `decision = 'approved'` AND the PR is actually opened |
| `reviewed_at` | `timestamptz` | NULL | |

**Indexes:** unique index on `diagnosis_id`; index on `decision` (approval queue listing, FR-15).

**Relationships:** many approvals → one diagnosis (1:1 in practice); many approvals → one user (reviewer).

**Invariant — enforced in `approval.service.ts`, not just by schema:** `github.openDraftPullRequest()` may only be called when a corresponding `approvals` row exists with `decision = 'approved'`. `pr_url` being non-null is proof this invariant held.

---

## `code_embeddings`

Vectorized chunks of a repository's source code, used for semantic retrieval (FR-9). Lives in the same Postgres instance as every other table — see `prd.md` §8 for why.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `repo_id` | `uuid` | FK → `repos.id`, NOT NULL | |
| `file_path` | `text` | NOT NULL | Repo-relative path |
| `chunk_text` | `text` | NOT NULL | The actual code chunk, redacted per FR-6 |
| `embedding` | `vector(768)` | NOT NULL | pgvector column |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` | |

**Indexes:**
```sql
CREATE INDEX code_embeddings_repo_id_idx ON code_embeddings (repo_id);
CREATE INDEX code_embeddings_embedding_idx ON code_embeddings
  USING hnsw (embedding vector_cosine_ops);
```
An HNSW index is used over IVFFlat because the write pattern is incremental (files change one at a time on push) rather than bulk-loaded, and HNSW does not require a training/build step before it becomes useful.

**Relationships:** many embeddings → one repo.

**Re-indexing policy:** on each push to a connected repository's default branch, only changed files are re-embedded (diff-aware indexing), not the full repository — this is a resource-management stance, see `README.md` for the reasoning parallel to sandbox cost control.

---

## `evaluation_set`

Labeled historical failures with a known, verified root cause, used to measure diagnosis accuracy over time (FR-21, FR-22). Deliberately decoupled from live `diagnoses` traffic.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `build_id` | `uuid` | FK → `builds.id`, UNIQUE, NOT NULL | The original failure being used as a labeled example |
| `expected_root_cause` | `text` | NOT NULL | Human-verified correct answer |
| `match` | `boolean` | NULL | Set by the evaluation runner after comparing the live pipeline's output to `expected_root_cause`; NULL until the pipeline has been run against this entry |

**Indexes:** unique index on `build_id`.

**Relationships:** one evaluation entry → one build.

**Population policy:** entries are added deliberately (by a maintainer confirming a diagnosis was correct, or hand-labeling a known historical failure) — never auto-populated from live traffic, to avoid the evaluation set silently absorbing the pipeline's own mistakes as ground truth.

---

## Full relationship diagram (textual)

```
users ──1:many──> repos ──1:many──> builds ──1:0-or-1──> diagnoses ──1:many──> sandbox_runs
  │                  │                  │                     │
  │                  └──1:many──> code_embeddings              └──1:0-or-1──> approvals ──many:1──> users (reviewer)
  │                                                    
  └──────────────────1:many (as reviewer)─────────────> approvals

builds ──1:0-or-1──> evaluation_set
```

## Migration and seed notes

- Run `npm run prisma:migrate` after any schema change; never hand-edit generated SQL migrations.
- Local development seed data should include at least one `repo` with `autonomy_level = 'comment_only'` and one with `draft_pr_eligible`, to exercise both code paths described in `features.md` §1.3.
- `evaluation_set` should be seeded with a small number of hand-verified entries before Milestone 5 (`implementation-plan.md`) begins — the evaluation runner has nothing to measure against otherwise.
