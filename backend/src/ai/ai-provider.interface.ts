// Satisfies: FR-10 (provider-agnostic diagnosis contract)
// Every AI backend Iris can use -- Groq today, a self-hosted model later
// (see ai/self-hosted.provider.ts, not yet implemented -- Phase 3) --
// implements this same interface. Nothing elsewhere in the codebase knows
// or cares which concrete provider is behind it.

export interface DiagnosisRequest {
  errorSignature: string;
  logExcerpt: string;
  relevantCode: Array<{ filePath: string; content: string }>;
}

export interface DiagnosisResult {
  rootCause: string;
  fixType: "lint" | "test" | "dependency" | "infra" | "unknown";
  confidence: number; // 0..1
  proposedDiff: string | null;
}

export interface AiProvider {
  readonly name: string;
  diagnose(request: DiagnosisRequest): Promise<DiagnosisResult>;
}
