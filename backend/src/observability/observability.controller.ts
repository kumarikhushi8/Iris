import { Controller, Get, Header } from "@nestjs/common";
import { MetricsService } from "./metrics.service";

@Controller()
export class ObservabilityController {
  constructor(private readonly metrics: MetricsService) {}

  @Get("metrics")
  @Header("Content-Type", "text/plain")
  async getMetrics() {
    return this.metrics.getMetricsText();
  }
}