import os
from dotenv import load_dotenv
from huggingface_hub import InferenceClient

load_dotenv()

# Note: use token=, not api_key=, in standard InferenceClient
client = InferenceClient(
    model="meta-llama/Llama-3.1-8B-Instruct",
    token=os.environ.get("HF_TOKEN")
)

response = client.chat_completion(
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "What is Germany's capital city?"}
    ],
    max_tokens=100,
    temperature=0.1
)

print(response.choices[0].message.content)