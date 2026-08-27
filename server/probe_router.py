import os
import httpx
from dotenv import load_dotenv

load_dotenv()
token = os.getenv("HF_TOKEN")

models_to_probe = [
    "Qwen/Qwen2.5-Coder-7B-Instruct",
    "Qwen/Qwen2.5-Coder-3B-Instruct",
    "Qwen/Qwen3-4B-Instruct-2507",
    "Qwen/Qwen3-8B",
    "zai-org/GLM-4.6V-Flash",
    "zai-org/GLM-5.3-Flash",
    "ibm-granite/granite-4.2-3b",
    "ibm-granite/granite-4.2-8b",
    "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
    "deepseek-ai/DeepSeek-R1-Distill-Llama-8B",
    "stepfun-ai/Step-3.5-Flash",
    "stepfun-ai/Step-3.7-Flash",
    "CohereLabs/c4ai-command-r7b-12-2024",
    "google/gemma-4-26B-A4B-it",
    "google/gemma-3-27b-it"
]

print(f"Probing {len(models_to_probe)} models on router.huggingface.co...")
for m in models_to_probe:
    try:
        r = httpx.post(
            "https://router.huggingface.co/v1/chat/completions",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"model": m, "messages": [{"role": "user", "content": "hi"}], "max_tokens": 10},
            timeout=10.0
        )
        print(f"{m} -> HTTP {r.status_code}: {r.text[:140]}")
    except Exception as e:
        print(f"{m} -> Exception: {e}")
