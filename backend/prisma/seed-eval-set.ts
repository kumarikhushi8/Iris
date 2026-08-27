import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding Evaluation Set...");

  // 1. Ensure we have a dummy user and repo
  const user = await prisma.user.upsert({
    where: { githubId: "999999" },
    update: {},
    create: {
      githubId: "999999",
      name: "eval-user",
    },
  });

  const repo = await prisma.repo.upsert({
    where: { githubRepoId: "eval_repo_1" },
    update: {},
    create: {
      githubRepoId: "eval_repo_1",
      name: "iris-eval-repo",
      installationId: "eval_inst_1",
      autonomyLevel: "comment_only",
      userId: user.id,
    },
  });

  // 2. Ensure we have dummy builds
  const build1 = await prisma.build.create({
    data: {
      repoId: repo.id,
      commitSha: "evalsha111111111111111111111111111111111",
      branch: "main",
      status: "failed",
    },
  });

  const build2 = await prisma.build.create({
    data: {
      repoId: repo.id,
      commitSha: "evalsha222222222222222222222222222222222",
      branch: "main",
      status: "failed",
    },
  });

  // 3. Create evaluation set entries
  await prisma.evaluationSet.create({
    data: {
      buildId: build1.id,
      expectedRootCause: "Cannot read properties of undefined reading token",
    },
  });

  await prisma.evaluationSet.create({
    data: {
      buildId: build2.id,
      expectedRootCause: "SyntaxError Unexpected token }",
    },
  });

  console.log("Seeding complete. 2 evaluation entries added.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
