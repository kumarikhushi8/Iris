import { Module } from "@nestjs/common";
import { GithubModule } from "../github/github.module";
import { SandboxExecutorService } from "./sandbox-executor.service";

@Module({
  imports: [GithubModule],
  providers: [SandboxExecutorService],
  exports: [SandboxExecutorService],
})
export class SandboxModule {}