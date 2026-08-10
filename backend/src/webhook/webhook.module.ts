import { Module } from "@nestjs/common";
import { WebhookController } from "./webhook.controller";
import { QueueModule } from "../queue/queue.module";
import { GithubModule } from "../github/github.module";

@Module({
  imports: [QueueModule, GithubModule],
  controllers: [WebhookController],
})
export class WebhookModule {}