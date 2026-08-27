import { Injectable, Logger } from "@nestjs/common";
import { ConfidenceThresholdService } from "./confidence-threshold.service";

export interface NotificationPayload {
  diagnosisId: string;
  repoName: string;
  pullRequestNumber?: number;
  branch: string;
  confidence: number;
}

// Satisfies: FR-19 (Notification dispatch)
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly threshold: ConfidenceThresholdService) {}

  /**
   * Notifies reviewers that a diagnosis is awaiting approval, provided it
   * meets the confidence threshold.
   *
   * Note: As requested, external channels (Slack/Discord) are omitted for now.
   * This simply logs to stdout/Loki as a mocked notification.
   */
  async notifyReviewers(payload: NotificationPayload): Promise<void> {
    if (!this.threshold.meetsThreshold(payload.confidence)) {
      this.logger.log(
        `Suppressed notification for diagnosis ${payload.diagnosisId} ` +
        `(confidence ${(payload.confidence * 100).toFixed(0)}% < threshold)`,
      );
      return;
    }

    // Mock sending notification
    const prContext = payload.pullRequestNumber ? ` (PR #${payload.pullRequestNumber})` : "";
    this.logger.log(
      `🔔 NOTIFICATION SENT: A validated fix for ${payload.repoName}@${payload.branch}${prContext} ` +
      `is ready for review. Confidence: ${(payload.confidence * 100).toFixed(0)}%. ` +
      `Review at: /approvals`,
    );
  }
}
