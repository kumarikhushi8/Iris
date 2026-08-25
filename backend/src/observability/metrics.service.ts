import { Injectable, OnModuleInit } from "@nestjs/common";
import * as client from "prom-client";

// Satisfies observability goals from features.md §8.1
// Central registry for all Iris-specific metrics. Node's default process
// metrics (memory, CPU, event loop lag) are collected automatically too --
// useful operational signal we get for free.
//
// KNOWN LIMITATION: this service is instantiated once PER PROCESS. The API
// process (src/main.ts) and the worker process (src/worker/main.ts) each
// get their own MetricsService with their own separate in-memory Registry
// -- prom-client counters do not merge across Node processes. Concretely:
// iris_webhooks_received_total (incremented in webhook.controller.ts, API
// process) is visible at GET /metrics on port 3000. iris_diagnoses_total
// and iris_sandbox_runs_total (incremented in build-failure.processor.ts
// and sandbox-executor.service.ts, worker process) accumulate correctly
// but are NOT visible there, because the worker process has no HTTP server
// exposing them at all.
//
// Correct fix (not yet implemented): give the worker its own lightweight
// /metrics endpoint on a separate port, and scrape both processes as
// distinct Prometheus targets -- this is the standard pattern for
// multi-process metrics, not something to solve by sharing in-process
// state. See README.md "Known Limitations" for the user-facing note.
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