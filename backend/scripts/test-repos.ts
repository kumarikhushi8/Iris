import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Creating test user...");
  let user = await prisma.user.findUnique({ where: { githubId: "test-user-123" } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        githubId: "test-user-123",
        name: "Test User",
        email: "test@example.com",
      }
    });
  }
  console.log("User ID:", user.id);

  console.log("\nTesting POST /repos...");
  const postRes = await fetch("http://localhost:3000/repos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-id": user.id,
    },
    body: JSON.stringify({
      githubRepoId: "test-repo-" + Date.now(),
      name: "test-owner/test-repo",
      installationId: "inst-123",
      autonomyLevel: "comment_only",
    })
  });
  
  if (!postRes.ok) {
    console.error("POST /repos failed:", postRes.status, await postRes.text());
    return;
  }
  console.log("POST /repos successful:", await postRes.json());

  console.log("\nTesting GET /repos...");
  const getRes = await fetch("http://localhost:3000/repos", {
    headers: {
      "x-user-id": user.id,
    },
  });

  if (!getRes.ok) {
    console.error("GET /repos failed:", getRes.status, await getRes.text());
    return;
  }
  console.log("GET /repos successful. Repos found:", (await getRes.json()).length);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
