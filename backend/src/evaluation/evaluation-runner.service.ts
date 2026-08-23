import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

// Satisfies: FR-21, FR-22
// Compares the most recent diagnosis for each evaluation_set entry against
// its human-verified expected root cause, and records a match/no-match.
// This is a deliberately simple keyword-overlap check for now -- not
// semantic similarity via embeddings, which is a documented future
// upgrade (see implementation-plan.md Phase 5 notes). The goal here is a
// tracked, non-zero accuracy signal over time, not a perfect grader.
@Injectable()
export class EvaluationRunnerService {
  private readonly logger = new Logger(EvaluationRunnerService.name);

  async runAll(): Promise<{ total: number; matched: number; accuracy: number }> {
    const entries = await this.prisma.evaluationSet.findMany({
      include: { build: { include: { diagnosis: true } } },
    });

    let matched = 0;
    for (const entry of entries) {
      const diagnosis = entry.build.diagnosis;
      const isMatch = diagnosis?.rootCause
        ? this.isSemanticOverlap(diagnosis.rootCause, entry.expectedRootCause)
        : false;

      await this.prisma.evaluationSet.update({
        where: { id: entry.id },
        data: { match: isMatch },
      });

      if (isMatch) matched++;
      this.logger.log(`Evaluation entry ${entry.id}: ${isMatch ? "MATCH" : "no match"}`);
    }

    const accuracy = entries.length > 0 ? matched / entries.length : 0;
    this.logger.log(`Evaluation run complete: ${matched}/${entries.length} (${(accuracy * 100).toFixed(1)}%)`);
    return { total: entries.length, matched, accuracy };
  }

  /**
   * Deliberately simple: normalizes both strings and checks for meaningful
   * word overlap above a threshold. Real root-cause text varies in phrasing
   * even when correct, so exact string match would under-count true
   * positives -- but this is still a rough heuristic, not a claim of
   * semantic understanding.
   */
  private isSemanticOverlap(actual: string, expected: string): boolean {
    const normalize = (s: string) =>
      new Set(
        s
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, "")
          .split(/\s+/)
          .filter((w) => w.length > 3), // drop short/common words
      );

    const actualWords = normalize(actual);
    const expectedWords = normalize(expected);
    if (expectedWords.size === 0) return false;

    let overlap = 0;
    for (const word of expectedWords) {
      if (actualWords.has(word)) overlap++;
    }

    return overlap / expectedWords.size >= 0.4; // at least 40% of key expected words present
  }

  constructor(private readonly prisma: PrismaService) {}
}