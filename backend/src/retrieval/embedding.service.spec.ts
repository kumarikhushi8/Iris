import { Test, TestingModule } from "@nestjs/testing";
import { EmbeddingService } from "./embedding.service";
import { PrismaService } from "../database/prisma.service";
import { ConfigService } from "@nestjs/config";

describe("EmbeddingService", () => {
  let service: EmbeddingService;
  let prisma: PrismaService;
  let config: ConfigService;

  const mockPrismaService = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbeddingService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<EmbeddingService>(EmbeddingService);
    prisma = module.get<PrismaService>(PrismaService);
    config = module.get<ConfigService>(ConfigService);
    
    // Silence logger
    (service as any).logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("when disabled", () => {
    beforeEach(() => {
      mockConfigService.get.mockImplementation((key) => {
        if (key === "SEMANTIC_RETRIEVAL_ENABLED") return "false";
        if (key === "GEMINI_API_KEY") return "real_key";
        return null;
      });
      // Re-initialize to pickup mocked config
      service = new EmbeddingService(prisma, config);
      (service as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    });

    it("should return early from indexFile without executing queries", async () => {
      await service.indexFile("repo1", "file.ts", "some content");
      expect(mockPrismaService.$executeRaw).not.toHaveBeenCalled();
    });

    it("should return empty array from retrieveSimilar without executing queries", async () => {
      const result = await service.retrieveSimilar("repo1", "query text");
      expect(result).toEqual([]);
      expect(mockPrismaService.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe("when enabled but key is invalid", () => {
    beforeEach(() => {
      mockConfigService.get.mockImplementation((key) => {
        if (key === "SEMANTIC_RETRIEVAL_ENABLED") return "true";
        if (key === "GEMINI_API_KEY") return "AQ.Ab8fake";
        return null;
      });
      service = new EmbeddingService(prisma, config);
      (service as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    });

    it("should warn and return early from indexFile", async () => {
      await service.indexFile("repo1", "file.ts", "some content");
      expect((service as any).logger.warn).toHaveBeenCalledWith(expect.stringContaining("Valid GEMINI_API_KEY not set"));
      expect(mockPrismaService.$executeRaw).not.toHaveBeenCalled();
    });

    it("should warn and return empty array from retrieveSimilar", async () => {
      const result = await service.retrieveSimilar("repo1", "query text");
      expect(result).toEqual([]);
      expect((service as any).logger.warn).toHaveBeenCalledWith(expect.stringContaining("Valid GEMINI_API_KEY not set"));
      expect(mockPrismaService.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
