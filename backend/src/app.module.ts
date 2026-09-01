import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { DatabaseModule } from "./database/database.module";
import { WebhookModule } from "./webhook/webhook.module";
import { QueueModule } from "./queue/queue.module";
import { GithubModule } from "./github/github.module";
import { AiModule } from "./ai/ai.module";
import { ApprovalModule } from "./approval/approval.module";
import { EvaluationModule } from "./evaluation/evaluation.module";
import { ObservabilityModule } from "./observability/observability.module";
import { ReposModule } from "./repos/repos.module";
import { UsersModule } from "./users/users.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { WorkerModule } from "./worker/worker.module";

// Phase 0 + Phase 1 modules wired. retrieval/, sandbox/, notification/
// exist as directories but are not yet imported -- see
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
    UsersModule,
    ReposModule,
    ApprovalModule,
    EvaluationModule,
    ObservabilityModule,
    DashboardModule,
    WorkerModule,
  ],
})
export class AppModule {}
