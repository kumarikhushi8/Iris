import { Test, TestingModule } from "@nestjs/testing";
import { ReposController } from "./repos.controller";
import { ReposService } from "./repos.service";
import { UnauthorizedException } from "@nestjs/common";

describe("ReposController", () => {
  let controller: ReposController;
  let service: ReposService;

  const mockReposService = {
    listForUser: jest.fn(),
    connect: jest.fn(),
    setAutonomy: jest.fn(),
    disconnect: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReposController],
      providers: [
        {
          provide: ReposService,
          useValue: mockReposService,
        },
      ],
    }).compile();

    controller = module.get<ReposController>(ReposController);
    service = module.get<ReposService>(ReposService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("list", () => {
    it("should throw UnauthorizedException if x-user-id is missing", () => {
      expect(() => controller.list(undefined as any)).toThrow(UnauthorizedException);
    });

    it("should call reposService.listForUser", async () => {
      const mockRepos = [{ id: "1", name: "test/repo" }];
      mockReposService.listForUser.mockResolvedValue(mockRepos);

      const result = await controller.list("user123");
      expect(result).toEqual(mockRepos);
      expect(mockReposService.listForUser).toHaveBeenCalledWith("user123");
    });
  });

  describe("connect", () => {
    it("should call reposService.connect", async () => {
      mockReposService.connect.mockResolvedValue({ id: "2" });
      const result = await controller.connect("user123", "github456", "test/repo", "inst789", "comment_only");
      
      expect(result).toEqual({ id: "2" });
      expect(mockReposService.connect).toHaveBeenCalledWith({
        userId: "user123",
        githubRepoId: "github456",
        name: "test/repo",
        installationId: "inst789",
        autonomyLevel: "comment_only",
      });
    });
  });

  describe("setAutonomy", () => {
    it("should call reposService.setAutonomy", async () => {
      mockReposService.setAutonomy.mockResolvedValue({ id: "1", autonomyLevel: "draft_pr_eligible" });
      const result = await controller.setAutonomy("repo1", "user123", "draft_pr_eligible");
      
      expect(result).toEqual({ id: "1", autonomyLevel: "draft_pr_eligible" });
      expect(mockReposService.setAutonomy).toHaveBeenCalledWith("repo1", "user123", "draft_pr_eligible");
    });
  });

  describe("disconnect", () => {
    it("should call reposService.disconnect", async () => {
      mockReposService.disconnect.mockResolvedValue({ id: "1" });
      const result = await controller.disconnect("repo1", "user123");
      
      expect(result).toEqual({ id: "1" });
      expect(mockReposService.disconnect).toHaveBeenCalledWith("repo1", "user123");
    });
  });
});
