import { config } from "dotenv";
config();

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
  
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  const data = (await res.json()) as { models: Array<{ name: string }> };
  console.log("Text Models:", data.models.filter((m) => m.name.includes("text")).map((m) => m.name));
}

main();
