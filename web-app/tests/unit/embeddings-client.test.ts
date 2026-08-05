vi.mock("@/server/tracing", () => ({
  observeGeneration: vi.fn((_name, _args) => ({
    end: vi.fn(),
    endError: vi.fn(),
  })),
}));

import { vi, describe, it, expect, beforeEach } from "vitest";
import { GeminiEmbeddingClient, HfEmbeddingClient, GEMINI_BATCH_LIMIT } from "@/server/embeddings/client";
import { QUERY_EMBEDDING_PREFIX } from "@/server/rag/types";

/**
 * Mocks the GoogleGenerativeAI SDK's HTTP layer (it uses global fetch) with a
 * fake `batchEmbedContents` endpoint that echoes one embedding per request.
 */
function mockGeminiFetch(): { fetchMock: ReturnType<typeof vi.fn>; bodies: string[] } {
  const bodies: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : String(input);
    bodies.push(body);
    const parsed = JSON.parse(body) as { requests?: Array<{ content: { parts: Array<{ text: string }> } }> };
    const count = parsed.requests?.length ?? 1;
    // First component encodes the index so we can verify order preservation;
    // the client L2-normalizes, so use a second component to keep it unique.
    const embeddings = Array.from({ length: count }, (_v, i) => ({
      values: [i + 1, 1, 0],
    }));
    return {
      ok: true,
      status: 200,
      json: async () => ({ embeddings }),
      text: async () => "",
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, bodies };
}

describe("GeminiEmbeddingClient", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("splits inputs into batches of at most GEMINI_BATCH_LIMIT", async () => {
    const { fetchMock, bodies } = mockGeminiFetch();
    const client = new GeminiEmbeddingClient("test-key");

    const texts = Array.from({ length: 250 }, (_v, i) => `chunk ${i}`);
    const vectors = await client.embedTexts(texts);

    expect(vectors).toHaveLength(250);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // 100 + 100 + 50
    const sizes = bodies.map((b) => (JSON.parse(b) as { requests: unknown[] }).requests.length);
    expect(sizes).toEqual([100, 100, 50]);
    // First component is monotonic in the chunk index (post-normalization).
    expect(vectors[0][0]).toBeLessThan(vectors[1][0]);
    expect(vectors[98][0]).toBeLessThan(vectors[99][0]);
    // Order restarts per batch: index 0 of batch 2 == index 0 of batch 1.
    expect(vectors[0][0]).toBeCloseTo(vectors[100][0], 5);
    // Index 49 of batch 3 (last) == index 49 of batch 1.
    expect(vectors[49][0]).toBeCloseTo(vectors[249][0], 5);
  });

  it("makes a single call for inputs under the limit", async () => {
    const { fetchMock } = mockGeminiFetch();
    const client = new GeminiEmbeddingClient("test-key");
    const vectors = await client.embedTexts(Array.from({ length: 3 }, () => "x"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vectors).toHaveLength(3);
  });

  it("returns [] for empty input without any API call", async () => {
    const { fetchMock } = mockGeminiFetch();
    const client = new GeminiEmbeddingClient("test-key");
    await expect(client.embedTexts([])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws a clear error when no API key is configured", async () => {
    const { fetchMock } = mockGeminiFetch();
    const client = new GeminiEmbeddingClient("");
    await expect(client.embedTexts(["x"])).rejects.toThrow(/GEMINI_API_KEY not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exports a sane batch limit", () => {
    expect(GEMINI_BATCH_LIMIT).toBeGreaterThan(0);
    expect(GEMINI_BATCH_LIMIT).toBeLessThanOrEqual(100);
  });
});

describe("HfEmbeddingClient", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns [] for empty input without any API call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new HfEmbeddingClient("model", "url", "token");
    await expect(client.embedTexts([])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws a clear error when no API token is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new HfEmbeddingClient("model", "url", "");
    await expect(client.embedTexts(["x"])).rejects.toThrow(/HF_TOKEN not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("makes an API call and returns embeddings on success", async () => {
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => [[1, 0, 0]],
    } as Response));
    vi.stubGlobal("fetch", fetchMock);
    const client = new HfEmbeddingClient("model", "https://hf.api", "token");
    const vectors = await client.embedTexts(["hello"]);
    
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vectors).toEqual([[1, 0, 0]]);
    const callUrl = fetchMock.mock.calls[0][0];
    expect(callUrl).toBe("https://hf.api/pipeline/feature-extraction/model");
  });

  it("throws an error on non-200 API response", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    } as Response));
    vi.stubGlobal("fetch", fetchMock);
    const client = new HfEmbeddingClient("model", "url", "token");
    
    await expect(client.embedTexts(["hello"])).rejects.toThrow(/Embedding API error 503/);
  });

  it("embedQuery prefixes the text and calls embedTexts", async () => {
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => [[1, 0, 0]],
    } as Response));
    vi.stubGlobal("fetch", fetchMock);
    const client = new HfEmbeddingClient("model", "url", "token");
    const vector = await client.embedQuery("search query");
    
    expect(vector).toEqual([1, 0, 0]);
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(requestBody.inputs).toEqual([`${QUERY_EMBEDDING_PREFIX}search query`]);
  });
});
