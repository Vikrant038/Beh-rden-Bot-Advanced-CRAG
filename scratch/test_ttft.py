import asyncio
import os
from langfuse.openai import AsyncOpenAI
from src.tracing import observe
from langfuse import get_client
from datetime import datetime, timezone

async def run_stream():
    client = AsyncOpenAI(api_key=os.environ.get("GROQ_API_KEY"), base_url="https://api.groq.com/openai/v1")
    stream = await client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": "Hello, write a 10 word poem."}],
        stream=True
    )
    first = False
    async for chunk in stream:
        if not first and chunk.choices and chunk.choices[0].delta.content:
            first = True
            lf = get_client()
            print("First token received! Setting completion_start_time...")
            lf.update_current_generation(completion_start_time=datetime.now(timezone.utc))
        print(chunk.choices[0].delta.content or "", end="")
    print("\nStream finished")

@observe(name="test_ttft")
async def main():
    await run_stream()
    # Flush langfuse
    get_client().flush()

if __name__ == "__main__":
    asyncio.run(main())
