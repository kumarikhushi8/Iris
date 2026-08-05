-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "github_id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "role" TEXT NOT NULL DEFAULT 'developer',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repos" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "github_repo_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "autonomy_level" TEXT NOT NULL DEFAULT 'comment_only',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "builds" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "duration_ms" INTEGER,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "builds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnoses" (
    "id" TEXT NOT NULL,
    "build_id" TEXT NOT NULL,
    "root_cause" TEXT,
    "fix_type" TEXT,
    "confidence" DOUBLE PRECISION,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'diagnosing',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sandbox_runs" (
    "id" TEXT NOT NULL,
    "diagnosis_id" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "test_log" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sandbox_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL,
    "diagnosis_id" TEXT NOT NULL,
    "reviewer_id" TEXT,
    "decision" TEXT NOT NULL DEFAULT 'pending',
    "pr_url" TEXT,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_embeddings" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "chunk_text" TEXT NOT NULL,
    "embedding" vector(768) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_set" (
    "id" TEXT NOT NULL,
    "build_id" TEXT NOT NULL,
    "expected_root_cause" TEXT NOT NULL,
    "match" BOOLEAN,

    CONSTRAINT "evaluation_set_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_github_id_key" ON "users"("github_id");

-- CreateIndex
CREATE UNIQUE INDEX "repos_github_repo_id_key" ON "repos"("github_repo_id");

-- CreateIndex
CREATE INDEX "builds_repo_id_branch_idx" ON "builds"("repo_id", "branch");

-- CreateIndex
CREATE INDEX "builds_repo_id_started_at_idx" ON "builds"("repo_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "diagnoses_build_id_key" ON "diagnoses"("build_id");

-- CreateIndex
CREATE INDEX "diagnoses_status_idx" ON "diagnoses"("status");

-- CreateIndex
CREATE INDEX "sandbox_runs_diagnosis_id_idx" ON "sandbox_runs"("diagnosis_id");

-- CreateIndex
CREATE UNIQUE INDEX "approvals_diagnosis_id_key" ON "approvals"("diagnosis_id");

-- CreateIndex
CREATE INDEX "approvals_decision_idx" ON "approvals"("decision");

-- CreateIndex
CREATE INDEX "code_embeddings_repo_id_idx" ON "code_embeddings"("repo_id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_set_build_id_key" ON "evaluation_set"("build_id");

-- AddForeignKey
ALTER TABLE "repos" ADD CONSTRAINT "repos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "builds" ADD CONSTRAINT "builds_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "builds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sandbox_runs" ADD CONSTRAINT "sandbox_runs_diagnosis_id_fkey" FOREIGN KEY ("diagnosis_id") REFERENCES "diagnoses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_diagnosis_id_fkey" FOREIGN KEY ("diagnosis_id") REFERENCES "diagnoses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_embeddings" ADD CONSTRAINT "code_embeddings_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_set" ADD CONSTRAINT "evaluation_set_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "builds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
