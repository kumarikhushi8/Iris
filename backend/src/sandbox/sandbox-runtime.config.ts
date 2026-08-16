import { ConfigService } from "@nestjs/config";

// Satisfies: FR-14
// Centralizes the resource-safety limits for sandbox execution. These are
// safety bounds only -- see the note in sandbox-executor.service.ts about
// why "timeout" is treated as distinct from "fail".
export interface SandboxRuntimeConfig {
  image: string;
  memoryLimitMb: string;
  cpuLimit: string;
  maxRuntimeMs: number;
}

export function getSandboxRuntimeConfig(config: ConfigService): SandboxRuntimeConfig {
  return {
    image: config.get<string>("SANDBOX_IMAGE") ?? "node:20-alpine",
    memoryLimitMb: config.get<string>("SANDBOX_MEMORY_LIMIT_MB") ?? "2048",
    cpuLimit: config.get<string>("SANDBOX_CPU_LIMIT") ?? "1",
    maxRuntimeMs: parseInt(config.get<string>("SANDBOX_MAX_RUNTIME_MS") ?? "600000", 10),
  };
}