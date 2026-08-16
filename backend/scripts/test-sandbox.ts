import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { SandboxModule } from "../src/sandbox/sandbox.module";
import { SandboxExecutorService } from "../src/sandbox/sandbox-executor.service";

// Standalone harness to verify the sandbox executor works in isolation,
// including patch application (Phase 3b), before it's wired into the
// real webhook -> queue -> worker pipeline.
// Usage: npm run test:sandbox -- <commitSha> [--with-fix]

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), SandboxModule],
})
class TestHarnessModule {}

// A real unified diff correcting the known broken assertion in test.js
// at commit fc537922c679c64c404195f96afe2673986527a5.
const SAMPLE_FIX_DIFF = `--- a/test.js
+++ b/test.js
@@ -1,5 +1,5 @@
 // A deliberately passing test to start with — we'll break this on demand later
 // retest with PR lookup fix
 const assert = require("assert");
-assert.strictEqual(1 + 1, 3);
+assert.strictEqual(1 + 1, 2);
 console.log("test passed");
`;

async function main() {
  const commitSha = process.argv[2];
  const withFix = process.argv[3] === "withfix";

  if (!commitSha) {
    console.error("Usage: npm run test:sandbox -- <commitSha> [withfix]");
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(TestHarnessModule);
  const sandbox = app.get(SandboxExecutorService);

  console.log(`\nRunning sandbox against commit ${commitSha}${withFix ? " WITH proposed fix applied" : " (no patch)"}...\n`);

  const result = await sandbox.runTests(
    process.env.GITHUB_APP_ID_INSTALLATION ?? "151340409",
    "kumarikhushi8",
    "iris-test-repo",
    commitSha,
    withFix ? { filePath: "test.js", diff: SAMPLE_FIX_DIFF } : undefined,
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