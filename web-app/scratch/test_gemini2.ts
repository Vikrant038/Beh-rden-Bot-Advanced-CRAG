import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "dotenv";
config();

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
  
  const ai = new GoogleGenerativeAI(apiKey);
  
  try {
    const model = ai.getGenerativeModel({ model: "text-embedding-004" });
    const request: {
      content: { role: string; parts: Array<{ text: string }> };
      outputDimensionality: number;
    } = { content: { role: "user", parts: [{ text: "Hello" }] }, outputDimensionality: 768 };
    const res = await model.batchEmbedContents({ requests: [request] });
    console.log("Success with text-embedding-004:", res.embeddings?.[0]?.values?.length);
  } catch (e) {
    console.error("SDK Error:", e instanceof Error ? e.message : e);
  }
}
main();
