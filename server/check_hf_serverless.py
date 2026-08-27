import os
import json
import httpx
from dotenv import load_dotenv

load_dotenv()
token = os.getenv("HF_TOKEN")

# Test standard Hugging Face Inference API / Serverless API endpoint: https://api-inference.huggingface.co/models/<model>
models = [
    "Qwen/Qwen2.5-VL-7B-Instruct",
    "Qwen/Qwen2.5-VL-3B-Instruct",
    "Qwen/Qwen2.5-7B-Instruct",
    "Qwen/Qwen2.5-1.5B-Instruct",
    "Qwen/Qwen2.5-Coder-7B-Instruct",
    "meta-llama/Llama-3.2-3B-Instruct",
    "meta-llama/Llama-3.2-1B-Instruct",
    "HuggingFaceH4/zephyr-7b-beta",
    "google/gemma-2-2b-it",
    "google/gemma-2-9b-it",
    "mistralai/Mistral-7B-Instruct-v0.2",
    "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B",
    "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B"
]

print("--- Testing Hugging Face api-inference.huggingface.co/models/<model> (Serverless) ---")
for m in models:
    try:
        url = f"https://api-inference.huggingface.co/models/{m}/v1/chat/completions"
        res = httpx.post(
            url,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"messages": [{"role": "user", "content": "hi"}], "max_tokens": 10},
            timeout=10.0
        )
        print(f"Serverless /v1: {m} -> Status {res.status_code}: {res.text[:120]}")
    except Exception as e:
        print(f"Serverless /v1: {m} -> Error {e}")

print("\n--- Testing Hugging Face api-inference.huggingface.co/models/<model> (Legacy endpoint) ---")
for m in models[:4]:
    try:
        url = f"https://api-inference.huggingface.co/models/{m}"
        res = httpx.post(
            url,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"inputs": "hello", "parameters": {"max_new_tokens": 10}},
            timeout=10.0
        )
        print(f"Serverless legacy: {m} -> Status {res.status_code}: {res.text[:120]}")
    except Exception as e:
        print(f"Serverless legacy: {m} -> Error {e}")
