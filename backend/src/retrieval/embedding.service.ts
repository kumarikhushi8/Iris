import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../database/prisma.service";

// Satisfies: FR-9 (semantic retrieval complement to structural path matching)
//
// Converts source code chunks into dense vector embeddings (via the
// Gemini embedContent API, which is free-tier eligible) and stores them
// in the code_embeddings pgvector table. At query time, the same model
// converts the log excerpt into an embedding and performs an ANN search
// to return the most semantically similar chunks — even if the log doesn't
// reference the file by path.
//
// Embedding model: text-embedding-004 (768 dimensions, matches Prisma schema)
// Why not OpenAI text-embedding-ada-002? Gemini's API key is already
// present in .env (GEMINI_API_KEY), so no additional credential needed.
//
// Chunking strategy:
//   Split each file on blank lines, yielding logical paragraphs.
//   Chunks < 40 chars (e.g. blank lines, lone brackets) are skipped.
//   Each chunk is stored separately so the retrieval result is a precise
//   code region, not an entire large file.

const EMBEDDING_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent";
const MAX_CHUNK_CHARS = 1500;
const MIN_CHUNK_CHARS = 40;
const EMBED_BATCH_SIZE = 5; // sequential to stay within free-tier rate limits

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly apiKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.apiKey = this.config.get<string>("GEMINI_API_KEY") ?? "";
  }

  // ── Indexing ────────────────────────────────────────────────────────────────

  /**
   * Index a single file for a repository.
   * Idempotent: deletes existing embeddings for this file then re-inserts.
   * Called by the push handler for changed files (diff-aware re-indexing).
   */
  async indexFile(repoId: string, filePath: string, content: string): Promise<void> {
    if (!this.apiKey) {
      this.logger.warn("GEMINI_API_KEY not set — skipping embedding indexing");
      return;
    }

    const chunks = this.chunk(content);
    if (chunks.length === 0) return;

    // Delete stale embeddings for this file
    await this.prisma.$executeRaw`
      DELETE FROM code_embeddings WHERE repo_id = ${repoId} AND file_path = ${filePath}
    `;

    // Embed and insert in small batches to respect rate limits
    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
      for (const chunk of batch) {
        try {
          const vector = await this.embed(chunk);
          await this.prisma.$executeRaw`
            INSERT INTO code_embeddings (id, repo_id, file_path, chunk_text, embedding, updated_at)
            VALUES (gen_random_uuid(), ${repoId}, ${filePath}, ${chunk}, ${`[${vector.join(",")}]`}::vector, now())
          `;
        } catch (err) {
          this.logger.warn(`Failed to embed chunk from ${filePath}: ${(err as Error).message}`);
        }
      }
    }

    this.logger.log(`Indexed ${chunks.length} chunk(s) for ${filePath} in repo ${repoId}`);
  }

  // ── Retrieval ───────────────────────────────────────────────────────────────

  /**
   * Returns the top-k most semantically similar code chunks to the given
   * log excerpt. Uses cosine distance (<=> operator) via pgvector.
   *
   * Results are ordered by similarity (closest first).
   * Returns at most maxChunks items, each with the file path and chunk text.
   */
  async retrieveSimilar(
    repoId: string,
    logExcerpt: string,
    maxChunks = 5,
  ): Promise<Array<{ filePath: string; content: string }>> {
    if (!this.apiKey) {
      this.logger.warn("GEMINI_API_KEY not set — skipping semantic retrieval");
      return [];
    }

    let queryVector: number[];
    try {
      queryVector = await this.embed(logExcerpt.slice(0, MAX_CHUNK_CHARS));
    } catch (err) {
      this.logger.warn(`Query embedding failed: ${(err as Error).message}`);
      return [];
    }

    const vectorStr = `[${queryVector.join(",")}]`;

    // pgvector ANN search: <=> is cosine distance (0 = identical, 2 = opposite)
    const rows = await this.prisma.$queryRaw<Array<{ file_path: string; chunk_text: string }>>`
      SELECT file_path, chunk_text
      FROM code_embeddings
      WHERE repo_id = ${repoId}
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${maxChunks}
    `;

    this.logger.log(`Semantic retrieval returned ${rows.length} chunk(s) for repo ${repoId}`);

    // Deduplicate: if multiple chunks from the same file, merge them
    const merged = new Map<string, string[]>();
    for (const row of rows) {
      if (!merged.has(row.file_path)) merged.set(row.file_path, []);
      merged.get(row.file_path)!.push(row.chunk_text);
    }

    return [...merged.entries()].map(([filePath, chunks]) => ({
      filePath,
      content: chunks.join("\n\n…\n\n"),
    }));
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private chunk(content: string): string[] {
    // Split on double newlines (paragraph boundaries).
    // Slide a window for chunks that are too large.
    const paragraphs = content.split(/\n{2,}/);
    const result: string[] = [];

    for (const p of paragraphs) {
      const trimmed = p.trim();
      if (trimmed.length < MIN_CHUNK_CHARS) continue;

      if (trimmed.length <= MAX_CHUNK_CHARS) {
        result.push(trimmed);
      } else {
        // Slide a fixed-size window over oversized paragraphs
        for (let i = 0; i < trimmed.length; i += MAX_CHUNK_CHARS) {
          const slice = trimmed.slice(i, i + MAX_CHUNK_CHARS);
          if (slice.length >= MIN_CHUNK_CHARS) result.push(slice);
        }
      }
    }
    return result;
  }

  private async embed(text: string): Promise<number[]> {
    const response = await fetch(`${EMBEDDING_API_URL}?key=${this.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/text-embedding-004",
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_DOCUMENT",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Gemini embedding API ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json();
    const values: number[] | undefined = data?.embedding?.values;
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error("Gemini embedding API returned empty values array");
    }
    return values;
  }
}
