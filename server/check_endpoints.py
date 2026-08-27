import os
import json
import httpx
from dotenv import load_dotenv
from google import genai

load_dotenv()

hf_token = os.getenv("HF_TOKEN")
gemini_key = os.getenv("GEMINI_API_KEY")

print("Checking Gemini available models...")
if gemini_key:
    try:
        client = genai.Client(api_key=gemini_key)
        models = list(client.models.list())
        for m in models:
            name = getattr(m, 'name', str(m))
            supported = getattr(m, 'supported_actions', [])
            print(f"Gemini Model: {name} (actions: {supported})")
    except Exception as e:
        print("Gemini list models error:", e)

print("\nChecking Hugging Face Router models...")
models_to_test = [
    "Qwen/Qwen2.5-VL-7B-Instruct",
    "Qwen/Qwen2.5-VL-3B-Instruct",
    "Qwen/Qwen2.5-VL-72B-Instruct",
    "Qwen/Qwen2.5-7B-Instruct",
    "Qwen/Qwen2.5-Coder-32B-Instruct",
    "meta-llama/Llama-3.2-11B-Vision-Instruct",
    "meta-llama/Llama-3.2-3B-Instruct",
    "meta-llama/Llama-3.1-8B-Instruct",
    "mistralai/Mistral-7B-Instruct-v0.3",
    "microsoft/Phi-3.5-mini-instruct",
]

if hf_token:
    for model in models_to_test:
        try:
            res = httpx.post(
                "https://router.huggingface.co/v1/chat/completions",
                headers={"Authorization": f"Bearer {hf_token}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": "hello"}],
                    "max_tokens": 10
                },
                timeout=10.0
            )
            print(f"HF Model: {model} -> Status {res.status_code}: {res.text[:150]}")
        except Exception as e:
            print(f"HF Model: {model} -> Error: {e}")
