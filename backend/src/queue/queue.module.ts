import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";

export const BUILD_FAILURE_QUEUE = "build-failure-diagnosis";

@Module({
  imports: [BullModule.registerQueue({ name: BUILD_FAILURE_QUEUE })],
  exports: [BullModule],
})
export class QueueModule {}
