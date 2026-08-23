import { Module } from "@nestjs/common";
import { GithubModule } from "../github/github.module";
import { ApprovalController } from "./approval.controller";
import { ApprovalService } from "./approval.service";

@Module({
  imports: [GithubModule],
  controllers: [ApprovalController],
  providers: [ApprovalService],
  exports: [ApprovalService],
})
export class ApprovalModule {}