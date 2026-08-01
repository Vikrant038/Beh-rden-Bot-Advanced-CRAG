import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import { runAgenticRag } from "./src/server/rag/agents/orchestrator";
import { getHybridRetriever } from "./src/server/rag/instance";
import { semanticCache } from "./src/server/rag/cache/semantic-cache";
import { createMemory } from "./src/server/rag/memory/summary-buffer";

async function main() {
  try {
    const memory = createMemory("test-conversation");
    const result = await runAgenticRag("What documents do I need for a German student visa?", {
      hybridRetriever: getHybridRetriever(),
      cache: semanticCache,
      memory,
    });
    console.log("SUCCESS:");
    console.log(result);
  } catch (err) {
    console.error("ERROR:", err);
  }
}
main();
