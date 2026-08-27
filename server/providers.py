import json
import logging
import re
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
import httpx
from pydantic import BaseModel, Field

from config import settings

logger = logging.getLogger("rakshak-providers")
logging.basicConfig(level=logging.INFO)

VALID_ACTIONS = {"CLICK", "TYPE", "KEY", "SCROLL", "WAIT", "STOP", "PLAY", "FILL_CREDENTIALS", "FILL_EMAIL", "FILL_PASSWORD"}


class ActionTarget(BaseModel):
    elementId: Optional[str] = None
    selector: Optional[str] = None
    x: Optional[int] = None
    y: Optional[int] = None


class BrowserAction(BaseModel):
    action: str = Field(description="Must be one of CLICK, TYPE, KEY, SCROLL, WAIT, STOP, PLAY, FILL_CREDENTIALS, FILL_EMAIL, FILL_PASSWORD")
    target: Optional[ActionTarget] = None
    emailTarget: Optional[str] = None
    passwordTarget: Optional[str] = None
    value: Optional[str] = None
    key: Optional[str] = None
    reason: str
    providerUsed: str


SYSTEM_PROMPT = """You are an AI Browser Agent that operates strictly on sanitized web page representations and redacted visual previews.
Your role is to decide the SINGLE BEST NEXT ACTION to make progress toward accomplishing the user's overall goal.

CRITICAL PRIVACY & CREDENTIAL HANDLING RULES:
1. You only see sanitized DOM representations (e.g. [REDACTED_EMAIL], [REDACTED_PASSWORD]) and redacted visual previews.
2. When the user's goal involves logging in, signing in, or filling credentials:
   - If both username/email and password fields are present on the login form, return:
     {
       "action": "FILL_CREDENTIALS",
       "emailTarget": "<elementId of the email/username input>",
       "passwordTarget": "<elementId of the password input>",
       "reason": "Filling login credentials into form fields locally"
     }
   - Or you can return "FILL_EMAIL" with target email input elementId, and "FILL_PASSWORD" with target password input elementId.
   - NEVER return raw redaction strings like "[REDACTED_PASSWORD]" in a TYPE value. Use semantic credential actions instead.
3. After credentials are filled:
   - Inspect the submit / login / sign in button and return "CLICK" on the login button.

CRITICAL MULTI-STEP REASONING RULES:
1. NEVER return "STOP" on the first step or immediately after typing/searching if the user requested a multi-step task (e.g. searching and opening/playing a video or logging in).
2. If the user's goal involves finding, playing, or watching a song, video, tutorial, or item:
   - Step 1 (Search Box found): "TYPE" the search query into the search input with key="ENTER".
   - Step 2 (Search results loaded): Do NOT STOP. Inspect the newly loaded search results and "CLICK" the most relevant thumbnail, title, or link.
   - Step 3 (Video/content page loaded): If media is not already playing, "PLAY" or "CLICK" the player/play button.
   - Step 4 (Media playing or content reached): Only now return "STOP" when the video is playing or the goal is fully achieved.
3. If search was just typed in a previous step, but results have not yet loaded:
   - If a search button exists, "CLICK" the search button, or use "KEY" with key="ENTER" on the search input, or "WAIT".
4. Distinguish between "an individual action succeeded (e.g. credentials typed)" vs "the user's overall goal is completed (e.g. logged in)". Only return "STOP" when the final intended goal has genuinely been achieved on the page.
5. If the goal is not yet completed, you MUST select an action ("FILL_CREDENTIALS", "TYPE", "CLICK", "KEY", "SCROLL", "PLAY", "WAIT") on an interactable element from the provided list.

You must output ONLY a valid JSON object matching this schema:
{
  "action": "CLICK" | "TYPE" | "KEY" | "SCROLL" | "WAIT" | "STOP" | "PLAY" | "FILL_CREDENTIALS" | "FILL_EMAIL" | "FILL_PASSWORD",
  "target": {
    "elementId": "<exact id of target element from available elements list>",
    "selector": "<css selector if available>"
  },
  "emailTarget": "<elementId of email/username input if FILL_CREDENTIALS>",
  "passwordTarget": "<elementId of password input if FILL_CREDENTIALS>",
  "value": "<text to type if action is TYPE, direction 'up'/'down' if SCROLL, or null>",
  "key": "<key name like ENTER, ESCAPE, TAB if action is KEY or included with TYPE, or null>",
  "reason": "<clear explanation of why this specific action was chosen to progress toward the user goal>"
}
Do not wrap in markdown or conversational commentary; output purely the JSON object."""


def _build_prompt_text(
    task: str,
    page_context: Dict[str, Any],
    step_history: Optional[list] = None,
    current_step: int = 1,
    max_steps: int = 10,
) -> str:
    """Builds structured prompt containing user goal, multi-step history, media playback state, and sanitized DOM context."""
    history_section = ""
    if step_history:
        lines = []
        for i, s in enumerate(step_history):
            tgt = s.get("target") or ""
            val = s.get("value") or ""
            res = s.get("result") or "Success"
            msg = s.get("message") or ""
            lines.append(
                f"  Step {s.get('step', i+1)}: Action={s.get('action')} Target={tgt} Value={val} Result={res} Note={msg}"
            )
        history_section = f"\nPrevious Steps Executed in this Session:\n" + "\n".join(lines) + "\n"

    page_info = page_context.get("page", {})
    media_state = page_info.get("mediaState") or page_context.get("mediaState") or {}
    elements = page_context.get("elements", [])

    media_info_str = ""
    if media_state:
        media_info_str = f"Media State on Current Page: Playing={media_state.get('isPlaying', False)}, HasMediaElements={media_state.get('hasMedia', False)}\n"

    return (
        f"{SYSTEM_PROMPT}\n\n"
        f"User Overall Goal: {task}\n"
        f"Step Progress: Step {current_step} of {max_steps}\n"
        f"{history_section}\n"
        f"Current Sanitized Page Title: {page_info.get('title', '')}\n"
        f"Current Sanitized Page URL: {page_info.get('url', '')}\n"
        f"{media_info_str}"
        f"Available Interactive Elements on Current Page ({len(elements)} items):\n"
        f"{json.dumps(elements, indent=2)}\n"
    )


def _extract_and_validate_json(raw_text: str, default_provider_name: str) -> BrowserAction:
    """Safely extracts JSON from raw model output, enforces schema, and validates action type."""
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"```$", "", cleaned)
        cleaned = cleaned.strip()

    # Find JSON block if extra text exists
    match = re.search(r"(\{.*\})", cleaned, re.DOTALL)
    if match:
        cleaned = match.group(1)

    parsed = {}
    try:
        parsed = json.loads(cleaned)
    except Exception as parse_err:
        logger.warning(f"Failed to parse JSON directly from output: {parse_err}. Raw: {raw_text[:200]}")
        # Try finding key-value pairs
        action_match = re.search(r'"action"\s*:\s*"([A-Z]+)"', raw_text, re.IGNORECASE)
        if action_match:
            parsed["action"] = action_match.group(1).upper()
        reason_match = re.search(r'"reason"\s*:\s*"([^"]+)"', raw_text)
        if reason_match:
            parsed["reason"] = reason_match.group(1)

    raw_action = str(parsed.get("action") or "").upper()
    
    # If action is missing, infer from structure instead of silently defaulting to STOP
    if not raw_action:
        if parsed.get("value") is not None:
            raw_action = "TYPE"
        elif parsed.get("target") or parsed.get("elementId"):
            raw_action = "CLICK"
        else:
            raw_action = "CLICK"

    if raw_action not in VALID_ACTIONS:
        logger.warning(f"Unrecognized action '{raw_action}' from model, validating nearest match")
        raw_action = "CLICK"

    target_data = parsed.get("target")
    target_obj = None
    if isinstance(target_data, dict):
        target_obj = ActionTarget(
            elementId=target_data.get("elementId"),
            selector=target_data.get("selector"),
            x=target_data.get("x"),
            y=target_data.get("y"),
        )
    elif isinstance(target_data, str) and target_data.strip():
        val = target_data.strip()
        if val.startswith("#") or "." in val or ">" in val:
            target_obj = ActionTarget(selector=val)
        else:
            target_obj = ActionTarget(elementId=val)
    elif parsed.get("elementId") or parsed.get("selector"):
        target_obj = ActionTarget(
            elementId=parsed.get("elementId"),
            selector=parsed.get("selector"),
        )

    return BrowserAction(
        action=raw_action,
        target=target_obj,
        emailTarget=parsed.get("emailTarget"),
        passwordTarget=parsed.get("passwordTarget"),
        value=parsed.get("value"),
        key=parsed.get("key"),
        reason=parsed.get("reason", f"Action selected by {default_provider_name}"),
        providerUsed=default_provider_name,
    )


class BaseModelProvider(ABC):
    @abstractmethod
    async def generate_action(
        self,
        task: str,
        page_context: Dict[str, Any],
        sanitized_image: Optional[str] = None,
        step_history: Optional[list] = None,
        current_step: int = 1,
        max_steps: int = 10,
    ) -> BrowserAction:
        pass


class HuggingFaceProvider(BaseModelProvider):
    """
    Primary provider using Hugging Face Qwen VLM (Vision-Language Model).
    Receives only sanitized DOM context and redacted screenshots.
    Uses Hugging Face Router endpoint.
    """

    def __init__(self, token: Optional[str], model_name: str):
        self.token = token
        self.model_name = model_name or "Qwen/Qwen2.5-VL-72B-Instruct"

    async def generate_action(
        self,
        task: str,
        page_context: Dict[str, Any],
        sanitized_image: Optional[str] = None,
        step_history: Optional[list] = None,
        current_step: int = 1,
        max_steps: int = 10,
    ) -> BrowserAction:
        if not self.token:
            raise ValueError("HF_TOKEN is missing or not configured")

        prompt_text = _build_prompt_text(
            task=task,
            page_context=page_context,
            step_history=step_history,
            current_step=current_step,
            max_steps=max_steps,
        )

        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

        # Build multimodal or text message content
        if sanitized_image and sanitized_image.startswith("data:image"):
            user_content = [
                {"type": "text", "text": prompt_text},
                {"type": "image_url", "image_url": {"url": sanitized_image}}
            ]
        else:
            user_content = prompt_text

        # Hugging Face Router endpoint
        url = "https://router.huggingface.co/v1/chat/completions"
        payload = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            "temperature": 0.1,
            "max_tokens": 512,
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=headers, json=payload)
            if response.status_code != 200:
                err_detail = response.text[:200]
                raise RuntimeError(f"Hugging Face Router error (status {response.status_code}): {err_detail}")

            data = response.json()
            raw_content = data["choices"][0]["message"]["content"]
            return _extract_and_validate_json(raw_content, f"huggingface ({self.model_name})")


class GeminiProvider(BaseModelProvider):
    """
    Fallback provider using Gemini API.
    Receives exact same sanitized DOM context and redacted screenshot.
    """

    def __init__(self, api_key: Optional[str], model_name: str):
        self.api_key = api_key
        self.model_name = model_name or "gemini-3.1-flash-lite"

    async def generate_action(
        self,
        task: str,
        page_context: Dict[str, Any],
        sanitized_image: Optional[str] = None,
        step_history: Optional[list] = None,
        current_step: int = 1,
        max_steps: int = 10,
    ) -> BrowserAction:
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY is missing or not configured")

        from google import genai
        from google.genai import types

        client = genai.Client(api_key=self.api_key)
        prompt_text = _build_prompt_text(
            task=task,
            page_context=page_context,
            step_history=step_history,
            current_step=current_step,
            max_steps=max_steps,
        )

        contents = []
        if sanitized_image and sanitized_image.startswith("data:image"):
            import base64
            match = re.search(r"data:image/(?:png|jpeg|webp);base64,(.*)", sanitized_image)
            if match:
                img_bytes = base64.b64decode(match.group(1))
                mime_type = "image/jpeg" if "image/jpeg" in sanitized_image else "image/png"
                contents.append(types.Part.from_bytes(data=img_bytes, mime_type=mime_type))

        contents.append(prompt_text)

        # Build candidate list with primary model and active working fallbacks
        candidates = [
            self.model_name,
            "gemini-3.1-flash-lite",
            "gemini-3-flash-preview",
            "gemini-3.5-flash-lite",
            "gemini-3.1-flash-lite-preview",
            "gemini-3.7-flash",
            "gemini-3.6-flash",
            "gemini-3.5-flash",
        ]
        seen = set()
        unique_candidates = [c for c in candidates if c and not (c in seen or seen.add(c))]

        last_err = None
        for candidate_model in unique_candidates:
            try:
                response = client.models.generate_content(
                    model=candidate_model,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT,
                        response_mime_type="application/json",
                        temperature=0.1,
                    ),
                )
                raw_content = response.text or ""
                return _extract_and_validate_json(raw_content, f"gemini ({candidate_model})")
            except Exception as e:
                last_err = e
                logger.warning(f"Gemini model candidate '{candidate_model}' attempt failed: {e}")
                continue

        raise RuntimeError(f"Gemini API generation failed across candidates: {last_err}")


class DeterministicSimulatorProvider(BaseModelProvider):
    """Deterministic reasoning simulator for multi-step tasks, explicit simulation mode and test verification."""

    async def generate_action(
        self,
        task: str,
        page_context: Dict[str, Any],
        sanitized_image: Optional[str] = None,
        step_history: Optional[list] = None,
        current_step: int = 1,
        max_steps: int = 10,
    ) -> BrowserAction:
        elements = page_context.get("elements", [])
        page_info = page_context.get("page", {})
        media_state = page_info.get("mediaState") or page_context.get("mediaState") or {}
        task_lower = task.lower()
        step_history = step_history or []
        past_actions = [s.get("action") for s in step_history]

        # Extract search query dynamically if goal contains search/find/play intent
        search_query_match = re.search(r"(?:search (?:for )?|play (?:the video of )?|find |look up |watch )(.+?)(?: and | to |$)", task, re.IGNORECASE)
        search_query = search_query_match.group(1).strip() if search_query_match else task.replace("play ", "").replace("search ", "").strip()

        wants_play = any(w in task_lower for w in ["play", "video", "watch", "song", "listen", "start"])
        wants_scroll = "scroll" in task_lower
        wants_open = any(w in task_lower for w in ["open", "click", "find", "select", "result"])

        has_typed = "TYPE" in past_actions
        has_clicked = "CLICK" in past_actions
        has_played = "PLAY" in past_actions or media_state.get("isPlaying", False)

        # 1. Media is actively playing or was played on the content page -> Goal Achieved
        if wants_play and (has_played or ("PLAY" in past_actions and has_clicked)):
            return BrowserAction(
                action="STOP",
                reason="Requested video/media is actively playing and goal is complete",
                providerUsed="simulator",
            )

        # 2. Check for search input that hasn't been typed in yet
        search_input = None
        for el in elements:
            tag = (el.get("tag") or "").lower()
            label = (el.get("label") or "").lower()
            el_type = (el.get("type") or "").lower()
            if tag == "input" and (el_type in ["text", "search"] or "search" in label or "search" in (el.get("selector") or "")):
                search_input = el
                break

        if search_input and not has_typed:
            return BrowserAction(
                action="TYPE",
                target=ActionTarget(elementId=search_input.get("id"), selector=search_input.get("selector")),
                value=search_query,
                key="ENTER",
                reason=f"Typing query '{search_query}' into search field and submitting with ENTER",
                providerUsed="simulator",
            )

        # 3. If query was typed and user goal requires opening/clicking/playing a result item
        if (wants_open or wants_play) and has_typed and not has_clicked:
            # Find the most relevant search result link or video thumbnail
            for el in elements:
                tag = (el.get("tag") or "").lower()
                label = (el.get("label") or "").lower()
                el_id = el.get("id")
                if el_id != (search_input or {}).get("id") and (tag in ["a", "button", "video"] or el.get("role") in ["link", "button"]):
                    # Don't re-click the search input/button
                    if "search" not in label:
                        return BrowserAction(
                            action="CLICK",
                            target=ActionTarget(elementId=el.get("id"), selector=el.get("selector")),
                            reason=f"Clicking relevant search result: '{label or el.get('id')}'",
                            providerUsed="simulator",
                        )

        # 4. If result was clicked and media needs playback
        if wants_play and (has_clicked or not search_input):
            # Check for media element or play button
            for el in elements:
                tag = (el.get("tag") or "").lower()
                label = (el.get("label") or "").lower()
                if tag == "video" or "play" in label:
                    return BrowserAction(
                        action="PLAY",
                        target=ActionTarget(elementId=el.get("id"), selector=el.get("selector")),
                        reason="Starting media playback on video element",
                        providerUsed="simulator",
                    )

            # If on video watch page and video element is present
            if media_state.get("hasMedia") and not media_state.get("isPlaying"):
                return BrowserAction(
                    action="PLAY",
                    reason="Triggering media play on active player",
                    providerUsed="simulator",
                )

        # 5. Scroll handling
        if wants_scroll:
            scroll_count = sum(1 for a in past_actions if a == "SCROLL")
            if scroll_count < 2:
                return BrowserAction(
                    action="SCROLL",
                    value="down",
                    reason="Scrolling down to inspect additional content",
                    providerUsed="simulator",
                )
            return BrowserAction(
                action="STOP",
                reason="Finished scrolling and inspecting content",
                providerUsed="simulator",
            )

        # 6. Login / Credential filling handling
        if "login" in task_lower or "sign in" in task_lower or "credentials" in task_lower or "password" in task_lower:
            # Check if username/email and password fields are present and not filled
            email_el = None
            pass_el = None
            submit_el = None
            for el in elements:
                label = (el.get("label") or "").lower()
                el_type = (el.get("type") or "").lower()
                name = (el.get("name") or "").lower()
                tag = (el.get("tag") or "").lower()
                val = str(el.get("value") or "")
                
                if el_type == "password" or "password" in label or "pass" in name:
                    pass_el = el
                elif el_type in ["email", "text"] and any(k in f"{label} {name}" for k in ["email", "user", "login", "name", "account"]):
                    email_el = el
                elif "submit" in label or "sign in" in label or "login" in label or el_type == "submit" or tag == "button":
                    if not submit_el and ("login" in label or "sign in" in label or "submit" in label or el_type == "submit"):
                        submit_el = el

            has_filled_creds = any(a in ["FILL_CREDENTIALS", "FILL_EMAIL", "FILL_PASSWORD"] for a in past_actions)
            if (pass_el or email_el) and not has_filled_creds:
                if email_el and pass_el:
                    return BrowserAction(
                        action="FILL_CREDENTIALS",
                        emailTarget=email_el.get("id"),
                        passwordTarget=pass_el.get("id"),
                        reason="Filling login credentials locally",
                        providerUsed="simulator",
                    )
                elif pass_el:
                    return BrowserAction(
                        action="FILL_PASSWORD",
                        target=ActionTarget(elementId=pass_el.get("id"), selector=pass_el.get("selector")),
                        reason="Filling password input locally",
                        providerUsed="simulator",
                    )
                elif email_el:
                    return BrowserAction(
                        action="FILL_EMAIL",
                        target=ActionTarget(elementId=email_el.get("id"), selector=email_el.get("selector")),
                        reason="Filling email/username input locally",
                        providerUsed="simulator",
                    )

            if submit_el and "CLICK" not in past_actions:
                return BrowserAction(
                    action="CLICK",
                    target=ActionTarget(elementId=submit_el.get("id"), selector=submit_el.get("selector")),
                    reason=f"Clicking login submit button: '{submit_el.get('label') or 'Submit'}'",
                    providerUsed="simulator",
                )

        # 7. Generic form submission / Click handling
        if "submit" in task_lower or "sign in" in task_lower or "login" in task_lower:
            for el in elements:
                label = (el.get("label") or "").lower()
                type_attr = (el.get("type") or "").lower()
                if "submit" in label or "sign in" in label or "login" in label or type_attr == "submit":
                    if "CLICK" not in past_actions:
                        return BrowserAction(
                            action="CLICK",
                            target=ActionTarget(elementId=el.get("id"), selector=el.get("selector")),
                            reason=f"Target button matches task intent: '{label or 'submit'}'",
                            providerUsed="simulator",
                        )

        # 7. If past actions were executed and goal requirements are satisfied -> STOP
        if past_actions and (has_clicked or has_played):
            return BrowserAction(
                action="STOP",
                reason="Goal completed successfully based on multi-step verification",
                providerUsed="simulator",
            )

        if elements:
            first_el = elements[0]
            return BrowserAction(
                action="CLICK",
                target=ActionTarget(elementId=first_el.get("id"), selector=first_el.get("selector")),
                reason="Selecting first available interactive element",
                providerUsed="simulator",
            )

        return BrowserAction(
            action="STOP",
            reason="No actionable elements found on page",
            providerUsed="simulator",
        )


class ProviderManager:
    """
    Coordinates model provider selection with strict priority:
    1. Hugging Face open-weight VLM (PRIMARY)
         ↓ if it fails
    2. Gemini Fallback
    
    The simulator is NEVER automatically used in auto mode.
    """

    def __init__(self):
        self.hf = HuggingFaceProvider(settings.HF_TOKEN, settings.HF_MODEL)
        self.gemini = GeminiProvider(settings.GEMINI_API_KEY, settings.GEMINI_MODEL)
        self.simulator = DeterministicSimulatorProvider()

    async def decide_action(
        self,
        task: str,
        page_context: Dict[str, Any],
        sanitized_image: Optional[str] = None,
        step_history: Optional[list] = None,
        current_step: int = 1,
        max_steps: int = 10,
    ) -> BrowserAction:
        mode = (settings.PROVIDER_MODE or "auto").lower()

        # Mode: Explicit Simulator Only
        if mode == "simulator":
            logger.info("Using explicit simulator mode for reasoning.")
            return await self.simulator.generate_action(
                task=task,
                page_context=page_context,
                sanitized_image=sanitized_image,
                step_history=step_history,
                current_step=current_step,
                max_steps=max_steps,
            )

        # Mode: Hugging Face Only
        if mode == "huggingface":
            try:
                return await self.hf.generate_action(
                    task=task,
                    page_context=page_context,
                    sanitized_image=sanitized_image,
                    step_history=step_history,
                    current_step=current_step,
                    max_steps=max_steps,
                )
            except Exception as e:
                logger.error(f"Hugging Face provider error in explicit 'huggingface' mode: {e}")
                raise

        # Mode: Gemini Only
        if mode == "gemini":
            try:
                return await self.gemini.generate_action(
                    task=task,
                    page_context=page_context,
                    sanitized_image=sanitized_image,
                    step_history=step_history,
                    current_step=current_step,
                    max_steps=max_steps,
                )
            except Exception as e:
                logger.error(f"Gemini provider error in explicit 'gemini' mode: {e}")
                raise

        # Mode: Auto (Strict Priority: 1. Hugging Face open-weight VLM -> 2. Gemini Fallback)
        if mode == "auto":
            logger.info(f"[Provider Router] Attempting Primary Provider: Hugging Face (Model: {self.hf.model_name}) | Mode: auto")
            try:
                action = await self.hf.generate_action(
                    task=task,
                    page_context=page_context,
                    sanitized_image=sanitized_image,
                    step_history=step_history,
                    current_step=current_step,
                    max_steps=max_steps,
                )
                logger.info(f"[Provider Success] Hugging Face generated action: {action.action}")
                return action
            except Exception as hf_err:
                fallback_reason = str(hf_err)
                logger.warning(
                    f"Hugging Face failed. Switching to Gemini fallback. (Error: {fallback_reason})"
                )
                logger.info(
                    f"[Provider Fallback] Triggered Gemini fallback (Model: {self.gemini.model_name}) due to HF error: {fallback_reason}"
                )
                try:
                    action = await self.gemini.generate_action(
                        task=task,
                        page_context=page_context,
                        sanitized_image=sanitized_image,
                        step_history=step_history,
                        current_step=current_step,
                        max_steps=max_steps,
                    )
                    logger.info(
                        f"[Provider Fallback Success] Gemini generated action: {action.action} ({action.providerUsed}) | Reason: {action.reason}"
                    )
                    return action
                except Exception as gemini_err:
                    logger.error(
                        f"Both Hugging Face and Gemini AI providers failed: HF: {hf_err} | Gemini: {gemini_err}"
                    )
                    raise RuntimeError(
                        f"AI Reasoning failed: Both Hugging Face and Gemini providers were unavailable. (HF: {hf_err}; Gemini: {gemini_err})"
                    )

        # Unrecognized mode
        raise ValueError(f"Invalid PROVIDER_MODE: '{mode}'. Must be one of: 'auto', 'huggingface', 'gemini', 'simulator'")


provider_manager = ProviderManager()
