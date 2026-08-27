import os
import json
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")

client = genai.Client(api_key=api_key)

models_to_test = [
    "gemini-3.1-flash-lite",
    "gemini-3-flash-preview",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite-preview",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
]

prompt = """You are an AI Browser Agent that operates strictly on sanitized web page representations and redacted visual previews.
You must decide the single best next action to accomplish the user's task.
Output ONLY a valid JSON object matching this schema:
{
  "action": "CLICK" | "TYPE" | "KEY" | "SCROLL" | "WAIT" | "STOP",
  "target": {
    "elementId": "<id of target element>",
    "selector": "<css selector if available>"
  },
  "value": "<text to type if action is TYPE, or null>",
  "key": "<key name like ENTER, ESCAPE, TAB if action is KEY, or null>",
  "reason": "<short explanation of why this action was chosen>"
}

User Task: search for striver
Sanitized Page Title: YouTube
Available Interactive Elements:
[
  {
    "id": "rakshak-el-1",
    "tag": "input",
    "type": "text",
    "label": "Search",
    "selector": "input#search"
  }
]"""

print("Testing Gemini generation across models with configured API key...")
for m in models_to_test:
    try:
        resp = client.models.generate_content(
            model=m,
            contents=[prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1,
            ),
        )
        print(f"\n[SUCCESS] Model: {m}")
        print(f"Response:\n{resp.text}")
    except Exception as e:
        print(f"\n[FAILED] Model: {m} -> Error: {e}")
