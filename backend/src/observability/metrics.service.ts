import { Injectable, OnModuleInit } from "@nestjs/common";
import * as client from "prom-client";

// Satisfies observability goals from features.md §8.1
// Central registry for all Iris-specific metrics. Node's default process
// metrics (memory, CPU, event loop lag) are collected automatically too --
// useful operational signal we get for free.
@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new client.Registry();

  readonly diagnosisLatency = new client.Histogram({
    name: "iris_diagnosis_duration_seconds",
    help: "Time from job pickup to diagnosis completion",
    buckets: [1, 5, 10, 30, 60, 120, 300],
    registers: [this.registry],
  });

  readonly sandboxRuns = new client.Counter({
    name: "iris_sandbox_runs_total",
    help: "Total sandbox validation runs, labeled by result",
    labelNames: ["result"] as const,
    registers: [this.registry],
  });

  readonly diagnosesTotal = new client.Counter({
    name: "iris_diagnoses_total",
    help: "Total diagnoses completed, labeled by outcome",
    labelNames: ["outcome"] as const,
    registers: [this.registry],
  });

  readonly approvalsTotal = new client.Counter({
    name: "iris_approvals_total",
    help: "Total approval decisions, labeled by decision",
    labelNames: ["decision"] as const,
    registers: [this.registry],
  });

  readonly webhooksReceived = new client.Counter({
    name: "iris_webhooks_received_total",
    help: "Total GitHub webhooks received, labeled by outcome",
    labelNames: ["outcome"] as const,
    registers: [this.registry],
  });

  onModuleInit() {
    client.collectDefaultMetrics({ register: this.registry });
  }

  async getMetricsText(): Promise<string> {
    return this.registry.metrics();
  }
}