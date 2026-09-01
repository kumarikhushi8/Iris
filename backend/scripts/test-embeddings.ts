import { EmbeddingService } from "../src/retrieval/embedding.service";
import { ConfigService } from "@nestjs/config";

// Mock ConfigService to return the Gemini API key from the environment
const configService = {
  get: (key: string) => process.env[key],
} as ConfigService;

// We need a dummy logger
const logger = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  debug: console.log,
  verbose: console.log,
  fatal: console.error,
};

async function main() {
  console.log("Testing Gemini Embedding API...");
  
  // @ts-ignore
  const service = new EmbeddingService(null, configService);
  // @ts-ignore
  service.logger = logger;
  
  try {
    const textToEmbed = "This is a test of the Gemini embedding service.";
    // @ts-ignore - calling private method for testing
    const vector = await service.embed(textToEmbed);
    console.log("Success! Received embedding of length:", vector.length);
    console.log("First 5 dimensions:", vector.slice(0, 5));
  } catch (error) {
    console.error("Failed to generate embedding:", error);
  }
}

main().catch(console.error);
