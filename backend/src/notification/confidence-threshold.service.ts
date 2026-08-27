import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

// Satisfies: FR-19 (Confidence-threshold gating)
@Injectable()
export class ConfidenceThresholdService {
  private readonly threshold: number;

  constructor(private readonly config: ConfigService) {
    // Default to 70% confidence if not configured
    this.threshold = parseFloat(this.config.get<string>("NOTIFICATION_CONFIDENCE_THRESHOLD") ?? "0.7");
  }

  /**
   * Returns true if the diagnosis confidence meets or exceeds the configured threshold.
   */
  meetsThreshold(confidence: number | null | undefined): boolean {
    if (typeof confidence !== "number") return false;
    return confidence >= this.threshold;
  }
}
