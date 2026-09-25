import { Module } from "@nestjs/common";
import { ReposController } from "./repos.controller";
import { ReposService } from "./repos.service";
import { GithubModule } from "../github/github.module";

@Module({
  imports: [GithubModule],
  controllers: [ReposController],
  providers: [ReposService],
  exports: [ReposService],
})
export class ReposModule {}
