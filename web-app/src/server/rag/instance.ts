import { HybridRetriever } from "@/server/rag/retrieval/hybrid";
import { PrismaCorpusProvider } from "@/server/rag/retrieval/corpus";
import { HfReranker } from "@/server/rag/retrieval/reranker";
import { GeminiEmbeddingClient } from "@/server/embeddings/client";

let retriever: HybridRetriever | null = null;
let corpusProvider: PrismaCorpusProvider | null = null;

export function getCorpusProvider(): PrismaCorpusProvider {
  if (!corpusProvider) {
    corpusProvider = new PrismaCorpusProvider();
  }
  return corpusProvider;
}

export function getHybridRetriever(): HybridRetriever {
  if (!retriever) {
    retriever = new HybridRetriever({
      embeddingClient: new GeminiEmbeddingClient(),
      reranker: new HfReranker(),
      corpusProvider: getCorpusProvider(),
    });
  }
  return retriever;
}
