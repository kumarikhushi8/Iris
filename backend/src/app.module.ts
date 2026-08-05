import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { DatabaseModule } from "./database/database.module";
import { WebhookModule } from "./webhook/webhook.module";
import { QueueModule } from "./queue/queue.module";
import { GithubModule } from "./github/github.module";
import { AiModule } from "./ai/ai.module";

// Phase 0 wiring only. retrieval/, sandbox/, approval/, notification/,
// evaluation/, and observability/ exist as directories (see
// folder-structure.md) but are not yet imported here -- see
// implementation-plan.md Phases 2-5 for when each is wired in.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? "localhost",
        port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379,
      },
    }),
    DatabaseModule,
    GithubModule,
    AiModule,
    QueueModule,
    WebhookModule,
  ],
})
export class AppModule {}
