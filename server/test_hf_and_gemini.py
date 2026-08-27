import asyncio
import json
from config import settings
from providers import SYSTEM_PROMPT, HuggingFaceProvider, GeminiProvider

img_data = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

context = {
    "page": {"title": "YouTube"},
    "elements": [
        {"id": "el_search", "tag": "input", "label": "Search", "type": "text", "selector": "input#search"}
    ]
}

async def run_tests():
    print("=== Testing Hugging Face ===")
    hf = HuggingFaceProvider(settings.HF_TOKEN, settings.HF_MODEL)
    try:
        action = await hf.generate_action("search for striver", context, sanitized_image=img_data)
        print("HF Action:", action.model_dump_json(indent=2))
    except Exception as e:
        print("HF Error:", type(e), e)

    print("\n=== Testing Gemini ===")
    gemini = GeminiProvider(settings.GEMINI_API_KEY, settings.GEMINI_MODEL)
    try:
        action = await gemini.generate_action("search for striver", context, sanitized_image=img_data)
        print("Gemini Action:", action.model_dump_json(indent=2))
    except Exception as e:
        print("Gemini Error:", type(e), e)

if __name__ == "__main__":
    asyncio.run(run_tests())
