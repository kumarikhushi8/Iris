import { Module } from "@nestjs/common";
import { ConfidenceThresholdService } from "./confidence-threshold.service";
import { NotificationService } from "./notification.service";

@Module({
  providers: [ConfidenceThresholdService, NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
