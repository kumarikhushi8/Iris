import { Module } from "@nestjs/common";
import { WebhookController } from "./webhook.controller";
import { QueueModule } from "../queue/queue.module";
import { GithubModule } from "../github/github.module";
import { AiModule } from "../ai/ai.module";
import { RetrievalModule } from "../retrieval/retrieval.module";

@Module({
  imports: [QueueModule, GithubModule, AiModule, RetrievalModule],
  controllers: [WebhookController],
})
export class WebhookModule {}