vi.mock("@/server/tracing", () => ({
  observeGeneration: vi.fn((_name, _args) => ({
    end: vi.fn(),
    endError: vi.fn(),
  })),
}));

import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  GeminiEmbeddingClient,
  HfEmbeddingClient,
  GEMINI_BATCH_LIMIT,
} from "@/server/embeddings/client";
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
    const parsed = JSON.parse(body) as {
      requests?: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
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

  it("retries once on a rate-limit error and succeeds", async () => {
    const bodies: string[] = [];
    let calls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(typeof init?.body === "string" ? init.body : String(input));
      calls += 1;
      if (calls === 1) {
        // Simulate the GoogleGenerativeAI SDK surfacing a 429 resource-exhausted
        // response as a thrown error from the HTTP layer.
        throw new Error("429 RESOURCE_EXHAUSTED: rate limit");
      }
      const parsed = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
        requests?: Array<{ content: { parts: Array<{ text: string }> } }>;
      };
      const count = parsed.requests?.length ?? 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          embeddings: Array.from({ length: count }, (_v, i) => ({ values: [i + 1, 1, 0] })),
        }),
        text: async () => "",
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new GeminiEmbeddingClient("test-key");

    const vectors = await client.embedTexts(["a", "b"]);
    expect(calls).toBe(2);
    expect(vectors).toHaveLength(2);
  });

  it("gives up after max attempts on a persistent rate limit", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("429 Too Many Requests");
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new GeminiEmbeddingClient("test-key");

    await expect(client.embedTexts(["x"])).rejects.toThrow(/429 Too Many Requests/);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("does not retry non-retryable errors", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("400 BAD REQUEST: invalid model");
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new GeminiEmbeddingClient("test-key");

    await expect(client.embedTexts(["x"])).rejects.toThrow(/400 BAD REQUEST/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("wraps provider failures in a clear LLMProviderError", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network exploded");
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new GeminiEmbeddingClient("test-key");

    await expect(client.embedTexts(["x"])).rejects.toThrow(/Gemini Embedding API error/);
    await expect(client.embedTexts(["x"])).rejects.toThrow(/network exploded/);
  });

  it("rejects an invalid response shape from Gemini", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => "",
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new GeminiEmbeddingClient("test-key");

    await expect(client.embedTexts(["x"])).rejects.toThrow(/Invalid response from Gemini API/);
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
    const fetchMock = vi.fn(
      async (_input: unknown, _init?: RequestInit) =>
        ({
          ok: true,
          status: 200,
          json: async () => [[1, 0, 0]],
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new HfEmbeddingClient("model", "https://hf.api", "token");
    const vectors = await client.embedTexts(["hello"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vectors).toEqual([[1, 0, 0]]);
    const callUrl = fetchMock.mock.calls[0][0];
    expect(callUrl).toBe("https://hf.api/pipeline/feature-extraction/model");
  });

  it("throws an error on non-200 API response", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 503,
          text: async () => "Service Unavailable",
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new HfEmbeddingClient("model", "url", "token");

    await expect(client.embedTexts(["hello"])).rejects.toThrow(/Embedding API error 503/);
  });

  it("wraps network failures with a connection hint", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new HfEmbeddingClient("model", "https://hf.api", "token");

    await expect(client.embedTexts(["hello"])).rejects.toThrow(/Hugging Face API is unreachable/);
  });

  it("throws when the API returns a malformed response body", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ not: "vectors" }),
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new HfEmbeddingClient("model", "url", "token");

    await expect(client.embedTexts(["hello"])).rejects.toThrow(/malformed response/);
  });

  it("throws when the vector count does not match the input count", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => [[1, 0, 0]],
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new HfEmbeddingClient("model", "url", "token");

    await expect(client.embedTexts(["a", "b"])).rejects.toThrow(/malformed response/);
  });

  it("returns a zero vector unchanged by normalization", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => [[0, 0, 0]],
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new HfEmbeddingClient("model", "url", "token");

    await expect(client.embedTexts(["zero"])).resolves.toEqual([[0, 0, 0]]);
  });

  it("embedQuery prefixes the text and calls embedTexts", async () => {
    const fetchMock = vi.fn(
      async (_input: unknown, _init?: RequestInit) =>
        ({
          ok: true,
          status: 200,
          json: async () => [[1, 0, 0]],
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new HfEmbeddingClient("model", "url", "token");
    const vector = await client.embedQuery("search query");

    expect(vector).toEqual([1, 0, 0]);
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(requestBody.inputs).toEqual([`${QUERY_EMBEDDING_PREFIX}search query`]);
  });

  it("serves repeat batches from the in-memory cache without re-calling the API", async () => {
    const fetchMock = vi.fn(
      async (_input: unknown, _init?: RequestInit) =>
        ({
          ok: true,
          status: 200,
          json: async () => [
            [1, 0, 0],
            [0, 1, 0],
          ],
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new HfEmbeddingClient("model", "url", "token");

    const first = await client.embedTexts(["aps", "visa"]);
    const second = await client.embedTexts(["aps", "visa"]);

    expect(first).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    expect(second).toEqual(first);
    // One network round-trip for both calls — the second is a Map hit, which is
    // what keeps a cold embedding endpoint from being re-paid per pipeline stage.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache the same text across distinct batches (exact-batch key)", async () => {
    const fetchMock = vi.fn(
      async (_input: unknown, _init?: RequestInit) =>
        ({
          ok: true,
          status: 200,
          json: async () => [[1, 0, 0]],
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new HfEmbeddingClient("model", "url", "token");

    await client.embedTexts(["aps"]);
    await client.embedTexts(["visa"]);

    // Different batch composition → different key → both hit the network.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
