import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { SandboxModule } from "../src/sandbox/sandbox.module";
import { SandboxExecutorService } from "../src/sandbox/sandbox-executor.service";

// Standalone harness to verify the sandbox executor works in isolation,
// before it's wired into the real webhook -> queue -> worker pipeline.
// Usage: npm run test:sandbox -- <commitSha>

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), SandboxModule],
})
class TestHarnessModule {}

async function main() {
  const commitSha = process.argv[2];
  if (!commitSha) {
    console.error("Usage: npm run test:sandbox -- <commitSha>");
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(TestHarnessModule);
  const sandbox = app.get(SandboxExecutorService);

  console.log(`\nRunning sandbox against commit ${commitSha}...\n`);

  const result = await sandbox.runTests(
    process.env.GITHUB_APP_ID_INSTALLATION ?? "151340409",
    "kumarikhushi8",
    "iris-test-repo",
    commitSha,
  );

  console.log("\n=== SANDBOX RESULT ===");
  console.log("Result:", result.result);
  console.log("Duration:", result.durationMs, "ms");
  console.log("\n--- Test log (last 8000 chars) ---");
  console.log(result.testLog);

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Sandbox test failed:", err);
  process.exit(1);
});