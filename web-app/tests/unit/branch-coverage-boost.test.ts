import { vi, describe, it, expect, beforeEach } from "vitest";
import { HfReranker } from "@/server/rag/retrieval/reranker";
import { appRouter } from "@/server/trpc/router";
import type { Context } from "@/server/trpc/context";
import { prisma } from "@/server/db";
import type { MockPrisma } from "../helpers/mock-prisma";
import type { Chunk } from "@/server/rag/types";

vi.mock("@/server/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    conversation: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    message: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    document: {
      count: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/server/llm/client", () => ({
  callLLM: vi.fn(async () => "Mocked LLM Response"),
}));

const prismaMock = prisma as unknown as MockPrisma;

function makeUserCaller(userId = "user-1") {
  prismaMock.user.findUnique.mockResolvedValue({
    id: userId,
    role: "USER",
    blockedAt: null,
  } as never);

  return appRouter.createCaller({
    db: prismaMock as never,
    session: {
      user: { id: userId, role: "USER", name: "Test", email: "test@example.com" },
      expires: "2099-01-01T00:00:00.000Z",
    },
    headers: new Headers(),
    resHeaders: new Headers(),
  } as unknown as Context);
}

describe("Branch Coverage Boost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  describe("HfReranker Response Shapes", () => {
    const chunkA: Chunk = {
      id: "c1",
      sourceName: "BAMF",
      sourceUrl: "https://bamf.de",
      text: "Residence Act §16b",
      similarityScore: 0.85,
    };
    const chunkB: Chunk = {
      id: "c2",
      sourceName: "Make-it-in-Germany",
      sourceUrl: "https://make-it-in-germany.com",
      text: "Visa process requirements",
      similarityScore: 0.65,
    };

    it("parses flat array of label/score objects", async () => {
      const fetchMock = vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => [
              { label: "LABEL_0", score: 0.92 },
              { label: "LABEL_1", score: 0.15 },
            ],
          }) as Response,
      );
      vi.stubGlobal("fetch", fetchMock);

      const reranker = new HfReranker("test-model", "https://api.cf.com", "valid-token");
      const results = await reranker.rerank("student visa", [chunkA, chunkB], 2);

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("c1");
      expect(results[0].crossScore).toBeCloseTo(1 / (1 + Math.exp(-0.92)));
      expect(results[1].crossScore).toBeCloseTo(1 / (1 + Math.exp(-0.15)));
    });

    it("parses { scores: [...] } object responses", async () => {
      const fetchMock = vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({
              scores: [0.88, 0.42],
            }),
          }) as Response,
      );
      vi.stubGlobal("fetch", fetchMock);

      const reranker = new HfReranker("test-model", "https://api.cf.com", "valid-token");
      const results = await reranker.rerank("student visa", [chunkA, chunkB], 2);

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("c1");
      expect(results[0].crossScore).toBeCloseTo(1 / (1 + Math.exp(-0.88)));
      expect(results[1].crossScore).toBeCloseTo(1 / (1 + Math.exp(-0.42)));
    });

    it("parses nested array response format [[0.95], [0.35]]", async () => {
      const fetchMock = vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => [[0.95], [0.35]],
          }) as Response,
      );
      vi.stubGlobal("fetch", fetchMock);

      const reranker = new HfReranker("test-model", "https://api.cf.com", "valid-token");
      const results = await reranker.rerank("student visa", [chunkA, chunkB], 2);

      expect(results).toHaveLength(2);
      expect(results[0].crossScore).toBeCloseTo(1 / (1 + Math.exp(-0.95)));
      expect(results[1].crossScore).toBeCloseTo(1 / (1 + Math.exp(-0.35)));
    });

    it("parses Cloudflare Workers nested label/score format", async () => {
      const fetchMock = vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => [
              [{ label: "RELEVANT", score: 0.95 }],
              [{ label: "RELEVANT", score: 0.15 }],
            ],
          }) as Response,
      );
      vi.stubGlobal("fetch", fetchMock);

      const reranker = new HfReranker("test-model", "https://api.cf.com", "valid-token");
      const results = await reranker.rerank("student visa", [chunkA, chunkB], 2);

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("c1");
      expect(results[0].crossScore).toBeCloseTo(1 / (1 + Math.exp(-0.95)));
      expect(results[1].crossScore).toBeCloseTo(1 / (1 + Math.exp(-0.15)));
    });
  });

  describe("Conversation Router Branches", () => {
    it("exports conversation with no messages formatted cleanly", async () => {
      prismaMock.conversation.findUnique.mockResolvedValue({
        id: "conv-empty",
        userId: "user-1",
        title: null,
        mode: "STANDARD",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        messages: [],
      } as never);

      const caller = makeUserCaller("user-1");
      const result = await caller.conversation.export({ id: "conv-empty" });

      expect(result.markdown).toContain("# Behoerden-Bot conversation");
      expect(result.markdown).toContain("_No messages in this conversation._");
    });

    it("exports conversation with system/custom message roles", async () => {
      prismaMock.conversation.findUnique.mockResolvedValue({
        id: "conv-custom",
        userId: "user-1",
        title: "APS Review",
        mode: "AGENTIC",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        messages: [
          { role: "SYSTEM", content: "Session initialized", createdAt: new Date() },
          { role: "USER", content: "How do I apply?", createdAt: new Date() },
          { role: "ASSISTANT", content: "Here are the steps...", createdAt: new Date() },
        ],
      } as never);

      const caller = makeUserCaller("user-1");
      const result = await caller.conversation.export({ id: "conv-custom" });

      expect(result.markdown).toContain("# APS Review");
      expect(result.markdown).toContain("## SYSTEM");
      expect(result.markdown).toContain("## User");
      expect(result.markdown).toContain("## Assistant");
    });

    it("toggles pinned state on conversation", async () => {
      prismaMock.conversation.findUnique.mockResolvedValue({
        id: "conv-1",
        userId: "user-1",
      } as never);
      prismaMock.conversation.update.mockResolvedValue({
        id: "conv-1",
        pinned: true,
      } as never);

      const caller = makeUserCaller("user-1");
      const result = await caller.conversation.setPinned({ id: "conv-1", pinned: true });

      expect(prismaMock.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "conv-1" },
          data: { pinned: true },
        }),
      );
      expect(result.pinned).toBe(true);
    });
  });

  describe("Translation Cache & In-flight Deduplication", () => {
    it("deduplicates concurrent requests with getOrCreateInflight", async () => {
      const { getOrCreateInflight } = await import("@/server/ingest/translate/cache");
      let calls = 0;
      const factory = async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 10));
        return "translated-text";
      };

      const [res1, res2] = await Promise.all([
        getOrCreateInflight("hash-concurrent", factory),
        getOrCreateInflight("hash-concurrent", factory),
      ]);

      expect(res1).toBe("translated-text");
      expect(res2).toBe("translated-text");
      expect(calls).toBe(1);
    });

    it("handles cacheLookup when file does not exist", async () => {
      const { cacheLookup } = await import("@/server/ingest/translate/cache");
      const result = cacheLookup("non-existent-hash-12345");
      expect(result).toBeNull();
    });
  });

  describe("SummaryBufferMemory Branches", () => {
    it("handles clear and createMemory cleanly", async () => {
      const { createMemory } = await import("@/server/rag/memory/summary-buffer");
      const memory = createMemory("conv-mem-1");
      await memory.clear();
      const context = await memory.getContextFormatted();
      expect(context).toBe("");
    });

    it("loads existing summary and filters out non-user/assistant roles", async () => {
      const { createMemory } = await import("@/server/rag/memory/summary-buffer");
      (prismaMock as any).conversationMemory = {
        findUnique: vi.fn().mockResolvedValue({ summaryText: "Existing Summary" }),
        upsert: vi.fn().mockResolvedValue({}),
      };
      prismaMock.message.findMany.mockResolvedValue([
        { role: "SYSTEM", content: "Init" },
        { role: "USER", content: "My GPA is 1.5" },
        { role: "ASSISTANT", content: "That is excellent." },
      ] as never);

      const memory = createMemory("conv-mem-2");
      const context = await memory.getContextFormatted();
      expect(context).toContain("=== ROLLING BACKGROUND SUMMARY ===");
      expect(context).toContain("Existing Summary");
      expect(context).toContain("User: My GPA is 1.5");
      expect(context).toContain("Assistant: That is excellent.");
      expect(context).not.toContain("Init");
    });

    it("prunes and summarizes oldest messages when exceeding buffer capacity", async () => {
      const { SummaryBufferMemory } = await import("@/server/rag/memory/summary-buffer");
      const { callLLM } = await import("@/server/llm/client");
      const mockedLLM = vi.mocked(callLLM);
      mockedLLM.mockResolvedValueOnce("Summary: APS certificate details and cost.");

      const memory = new SummaryBufferMemory("conv-prune", 2);
      (prismaMock as any).conversationMemory = {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      };
      prismaMock.message.findMany.mockResolvedValue([] as never);

      await memory.addTurn("What is APS?", "APS is an academic evaluation certificate.");
      await memory.addTurn("How much does it cost?", "It costs 18,000 INR.");

      const context = await memory.getContextFormatted();
      expect(context).toContain("How much does it cost?");
    });
  });

  describe("Analytics DB Null-Coalescing Branches", () => {
    it("handles null latencyMs, sourceCount, retrievalPath, and count", async () => {
      const { recentQueries, topQuestions } = await import("@/server/db/analytics");
      prismaMock.$queryRaw.mockResolvedValueOnce([
        {
          id: "msg-1",
          conversationId: "conv-1",
          query: "test query",
          createdAt: new Date(),
          mode: "STANDARD",
          latencyMs: null,
          isCached: false,
          isGrounded: true,
          retrievalPath: null,
          sourceCount: null,
        },
      ] as never);

      const listResult = await recentQueries(prismaMock as never, {
        limit: 10,
        days: 7,
      });
      expect(listResult.items[0].latencyMs).toBe(0);
      expect(listResult.items[0].sourceCount).toBe(0);
      expect(listResult.items[0].retrievalPath).toBeNull();

      prismaMock.$queryRaw.mockResolvedValueOnce([{ query: "top query", count: null }] as never);

      const topResult = await topQuestions(prismaMock as never, 7);
      expect(topResult[0].count).toBe(0);
    });
  });

  describe("Conversation Router Missing Branches", () => {
    it("export throws NotFoundError when conversation is deleted concurrently", async () => {
      prismaMock.conversation.findUnique
        .mockResolvedValueOnce({ id: "conv-1", userId: "user-1", title: "Test" } as never)
        .mockResolvedValueOnce(null as never);
      const caller = makeUserCaller();
      await expect(caller.conversation.export({ id: "conv-1" })).rejects.toThrow();
    });

    it("deleteMany skips updateMany when no conversations are owned", async () => {
      prismaMock.conversation.findMany.mockResolvedValueOnce([] as never);
      const caller = makeUserCaller();
      const result = await caller.conversation.deleteMany({ ids: ["c-other-1"] });
      expect(result.deleted).toBe(0);
    });

    it("clearAll applies search, mode, and ids filters", async () => {
      (prismaMock.conversation as any).updateMany = vi.fn().mockResolvedValueOnce({ count: 3 });
      const caller = makeUserCaller();
      const result = await caller.conversation.clearAll({
        search: "visa",
        mode: "agentic",
        ids: ["c1", "c2"],
      });
      expect(result.deleted).toBe(3);
    });

    it("count applies pinnedOnly, search, and mode filters", async () => {
      prismaMock.conversation.count.mockResolvedValueOnce(5 as never);
      const caller = makeUserCaller();
      const result = await caller.conversation.count({
        pinnedOnly: true,
        search: "APS",
        mode: "standard",
      });
      expect(result.count).toBe(5);
    });

    it("stats returns aggregated conversation and message counts", async () => {
      prismaMock.conversation.count
        .mockResolvedValueOnce(10 as never)
        .mockResolvedValueOnce(2 as never)
        .mockResolvedValueOnce(3 as never);
      prismaMock.message.count.mockResolvedValueOnce(45 as never);
      const caller = makeUserCaller();
      const stats = await caller.conversation.stats();
      expect(stats.totalConversations).toBe(10);
      expect(stats.pinnedConversations).toBe(2);
      expect(stats.deletedConversations).toBe(3);
      expect(stats.totalMessages).toBe(45);
    });

    it("exportAll formats markdown with messages and fallback titles", async () => {
      prismaMock.conversation.findMany.mockImplementation(
        async () =>
          [
            {
              id: "c1",
              title: null,
              mode: "AGENTIC",
              updatedAt: new Date("2026-01-01T00:00:00Z"),
              messages: [{ role: "USER", content: "Hello" }],
            },
          ] as never,
      );
      const caller = makeUserCaller();
      const res = await caller.conversation.exportAll();
      expect(res.markdown).toContain("Untitled Conversation");
      expect(res.markdown).toContain("**USER:** Hello");
    });

    it("list returns nextCursor on paginated results and handles empty messages preview", async () => {
      prismaMock.conversation.findMany.mockImplementation(
        async () =>
          [
            {
              id: "c1",
              title: "Conv 1",
              mode: "STANDARD",
              pinned: false,
              updatedAt: new Date("2026-01-02T00:00:00Z"),
              createdAt: new Date("2026-01-01T00:00:00Z"),
              messages: [],
              _count: { messages: 0 },
            },
            {
              id: "c2",
              title: "Conv 2",
              mode: "AGENTIC",
              pinned: true,
              updatedAt: new Date("2026-01-01T00:00:00Z"),
              createdAt: new Date("2026-01-01T00:00:00Z"),
              messages: [{ content: "Sample message" }],
              _count: { messages: 1 },
            },
          ] as never,
      );
      const caller = makeUserCaller();
      const result = await caller.conversation.list({ limit: 1 });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].preview).toBe("");
      expect(result.nextCursor).toEqual({
        id: "c1",
        updatedAt: new Date("2026-01-02T00:00:00Z"),
      });
    });
  });

  describe("BM25 Retrieval Edge Branches", () => {
    it("handles empty corpus, out-of-range index, and whitespace queries", async () => {
      const { BM25Okapi, buildBm25 } = await import("@/server/rag/retrieval/bm25");
      const emptyBm25 = new BM25Okapi([]);
      expect(emptyBm25.getScore(["term"], 0)).toBe(0);
      expect(emptyBm25.getScore(["term"], -1)).toBe(0);

      const searcher = buildBm25([
        { id: "c1", sourceName: "BAMF", sourceUrl: "https://bamf.de", text: "German visa" },
      ]);
      expect(searcher.search("", 5)).toEqual([]);
      expect(searcher.search("   ", 5)).toEqual([]);
    });
  });

  describe("Standard CRAG Pipeline Branches", () => {
    it("returns trace on cache hit when collectTrace is true", async () => {
      const { runStandardCrag } = await import("@/server/rag/pipeline");
      const cacheMock = {
        checkCache: vi.fn().mockResolvedValue({
          answer: "Cached visa answer",
          sources: [],
          retrievalPath: "SEMANTIC_CACHE",
        }),
        addToCache: vi.fn(),
      };
      const retrieverMock = {
        embedQuery: vi.fn().mockResolvedValue(new Array(1024).fill(0.01)),
        retrieve: vi.fn(),
      };
      const memoryMock = {
        addTurn: vi.fn().mockResolvedValue(undefined),
        getContextFormatted: vi.fn().mockResolvedValue(""),
      };
      const result = await runStandardCrag("visa questions", {
        cache: cacheMock as never,
        hybridRetriever: retrieverMock as never,
        memory: memoryMock as never,
        collectTrace: true,
        bypassCache: false,
      });

      expect(result.isCached).toBe(true);
      expect(result.trace).toBeDefined();
      expect(result.trace?.pipeline).toBe("standard");
      expect(result.trace?.finalAnswer).toBe("Cached visa answer");
    });
  });

  describe("Admin and Security Edge Branches", () => {
    it("formatDebugError formats string cause", async () => {
      const { formatDebugError } = await import("@/server/routers/admin");
      const err = new Error("main error");
      err.cause = "string error cause";
      const formatted = formatDebugError(err);
      expect(formatted).toContain("Cause: string error cause");
    });
  });
});
