import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "dotenv";
config();

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
  
  const ai = new GoogleGenerativeAI(apiKey);
  
  try {
    const model = ai.getGenerativeModel({ model: "text-embedding-004" });
    const res = await model.batchEmbedContents({
      requests: [{ content: { role: "user", parts: [{ text: "Hello" }] } } as any]
    });
    console.log("Success with text-embedding-004:", res.embeddings?.[0]?.values?.length);
  } catch (e) {
    console.error("SDK Error:", e.message);
  }
}
main();
