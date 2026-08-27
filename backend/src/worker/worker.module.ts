import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { DatabaseModule } from "../database/database.module";
import { GithubModule } from "../github/github.module";
import { AiModule } from "../ai/ai.module";
import { BUILD_FAILURE_QUEUE } from "../queue/queue.module";
import { BuildFailureProcessor } from "./build-failure.processor";
import { RetrievalModule } from "../retrieval/retrieval.module";
import { SandboxModule } from "../sandbox/sandbox.module";
import { ObservabilityModule } from "../observability/observability.module";
import { NotificationModule } from "../notification/notification.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? "localhost",
        port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379,
      },
    }),
    BullModule.registerQueue({ name: BUILD_FAILURE_QUEUE }),
    DatabaseModule,
    GithubModule,
    AiModule,
    RetrievalModule,
    SandboxModule,
    ObservabilityModule,
    NotificationModule,
  ],
  providers: [BuildFailureProcessor],
})
export class WorkerModule {}
