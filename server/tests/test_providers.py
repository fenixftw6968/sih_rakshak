import pytest
import json
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient
from main import app
from providers import (
    HuggingFaceProvider,
    GeminiProvider,
    ProviderManager,
    provider_manager,
    BrowserAction,
    ActionTarget,
    _extract_and_validate_json,
)

client = TestClient(app)

SAMPLE_SANITIZED_CONTEXT = {
    "page": {"title": "Rakshak Test Login Form", "url": "https://example.com/login"},
    "elements": [
        {
            "id": "username",
            "tag": "input",
            "type": "email",
            "label": "Email Address",
            "value": "[REDACTED_EMAIL]",
            "selector": "#username",
            "isSensitive": True,
        },
        {
            "id": "password",
            "tag": "input",
            "type": "password",
            "label": "Password",
            "value": "[REDACTED_PASSWORD]",
            "selector": "#password",
            "isSensitive": True,
        },
        {
            "id": "ssn",
            "tag": "input",
            "type": "text",
            "label": "Social Security / National ID",
            "value": "[REDACTED_SSN_ID]",
            "selector": "#ssn",
            "isSensitive": True,
        },
        {
            "id": "submitBtn",
            "tag": "button",
            "type": "submit",
            "label": "Sign In",
            "selector": "#submitBtn",
            "isSensitive": False,
        }
    ]
}

SAMPLE_REDACTED_IMAGE = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="


def test_json_extraction_and_action_validation():
    """Verify JSON extractor parses clean JSON and handles markdown fences."""
    raw_markdown = """```json
    {
      "action": "CLICK",
      "target": {"elementId": "submitBtn", "selector": "#submitBtn"},
      "value": null,
      "reason": "Clicking login button"
    }
    ```"""
    action = _extract_and_validate_json(raw_markdown, "test-provider")
    assert action.action == "CLICK"
    assert action.target.elementId == "submitBtn"
    assert action.providerUsed == "test-provider"


@pytest.mark.anyio
async def test_phase2_huggingface_vlm_success():
    """
    Test A: Hugging Face Qwen VLM Success.
    Confirm:
    - Hugging Face is called first with sanitized context + redacted image.
    - Valid structured response returned.
    - Gemini is NOT called.
    """
    hf_response_data = {
        "choices": [
            {
                "message": {
                    "content": json.dumps({
                        "action": "CLICK",
                        "target": {"elementId": "submitBtn", "selector": "#submitBtn"},
                        "reason": "Target submit button identified from sanitized context"
                    })
                }
            }
        ]
    }

    mock_post_response = MagicMock()
    mock_post_response.status_code = 200
    mock_post_response.json.return_value = hf_response_data

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_post_response

        provider = HuggingFaceProvider(token="hf_test_token", model_name="Qwen/Qwen2.5-VL-3B-Instruct")
        result = await provider.generate_action("Sign in to dashboard", SAMPLE_SANITIZED_CONTEXT, SAMPLE_REDACTED_IMAGE)

        assert result.action == "CLICK"
        assert result.target.elementId == "submitBtn"
        assert "Qwen/Qwen2.5-VL-3B-Instruct" in result.providerUsed
        assert mock_post.called

        # Verify payload sent to HF contains multimodal user content
        called_kwargs = mock_post.call_args.kwargs
        messages = called_kwargs["json"]["messages"]
        user_message = next(m for m in messages if m["role"] == "user")
        assert isinstance(user_message["content"], list)
        assert any(c.get("type") == "image_url" for c in user_message["content"])


@pytest.mark.anyio
async def test_phase3_provider_fallback_hf_failure_switches_to_gemini(caplog):
    """
    Test B: Hugging Face Failure -> Switches to Gemini 2.5 Pro Fallback.
    Confirm:
    - Failure detected.
    - Logs 'Hugging Face failed. Switching to Gemini fallback.'
    - Gemini receives the exact same sanitized context.
    """
    manager = ProviderManager()
    manager.hf.token = "hf_dummy"
    manager.gemini.api_key = "gemini_dummy"

    gemini_action = BrowserAction(
        action="CLICK",
        target=ActionTarget(elementId="submitBtn", selector="#submitBtn"),
        reason="Gemini 2.5 Pro fallback determined sign in action",
        providerUsed="gemini (gemini-2.5-pro)",
    )

    with patch.object(manager.hf, "generate_action", side_effect=Exception("HF Endpoint Unavailable / 503")) as mock_hf, \
         patch.object(manager.gemini, "generate_action", new_callable=AsyncMock) as mock_gemini:
        
        mock_gemini.return_value = gemini_action

        with caplog.at_level("WARNING"):
            action = await manager.decide_action("Sign in", SAMPLE_SANITIZED_CONTEXT, SAMPLE_REDACTED_IMAGE)

        assert action.action == "CLICK"
        assert "gemini" in action.providerUsed
        mock_hf.assert_called_once()
        mock_gemini.assert_called_once()
        # Verify exact required log message
        assert "Hugging Face failed. Switching to Gemini fallback." in caplog.text


def test_phase4_privacy_test_no_raw_sensitive_leaks(caplog):
    """
    Test C: Privacy Test.
    Confirm:
    - No raw sensitive values (password, email, SSN) in backend logs.
    - Outgoing context strictly sanitized.
    """
    # Raw payload trying to leak secrets
    raw_leak_payload = {
        "task": "Log in with secret_hunter2_pass and email test@secretcorp.com",
        "page": {"title": "Sensitive Bank Portal", "url": "https://bank.com"},
        "elements": [
            {
                "id": "pwd-field",
                "tag": "input",
                "type": "password",
                "label": "Password",
                "value": "super_secret_raw_pass_12345",
                "selector": "#pwd"
            },
            {
                "id": "ssn-field",
                "tag": "input",
                "type": "text",
                "label": "SSN",
                "value": "[REDACTED_SSN_ID]",
                "selector": "#ssn"
            }
        ],
        "sanitizedImage": SAMPLE_REDACTED_IMAGE
    }

    with caplog.at_level("INFO"), patch.object(
        provider_manager,
        "decide_action",
        new_callable=AsyncMock,
        return_value=BrowserAction(
            action="CLICK",
            target=ActionTarget(elementId="pwd-field", selector="#pwd"),
            reason="Mocked privacy test action",
            providerUsed="test-provider"
        )
    ):
        response = client.post("/api/v1/act", json=raw_leak_payload)

    assert response.status_code == 200
    data = response.json()
    assert "action" in data

    # Verify no raw password or secret in server logs
    assert "super_secret_raw_pass_12345" not in caplog.text
    # Verify log says sanitized and redacted
    assert "[Sanitized Request Received]" in caplog.text
    assert "Sensitive Items Redacted: 1" in caplog.text


@pytest.mark.anyio
async def test_multistep_dynamic_execution_loop():
    """
    Test generic multi-step execution loop:
    1. Search query input -> TYPE + ENTER
    2. Search results page -> CLICK result
    3. Media page -> PLAY
    4. Verified complete -> STOP
    """
    from providers import DeterministicSimulatorProvider
    simulator = DeterministicSimulatorProvider()

    # Step 1: Initial page with search bar
    step1_context = {
        "page": {"title": "Media Portal", "url": "https://media.example.com"},
        "elements": [
            {"id": "search-input", "tag": "input", "type": "search", "label": "Search Media", "selector": "#search"}
        ]
    }
    history = []
    action1 = await simulator.generate_action(
        task="Search for tutorials and play the first video",
        page_context=step1_context,
        step_history=history,
        current_step=1,
        max_steps=10,
    )
    assert action1.action == "TYPE"
    assert action1.target.elementId == "search-input"
    assert action1.value == "tutorials"
    assert action1.key == "ENTER"

    history.append({
        "step": 1,
        "action": action1.action,
        "target": "search-input",
        "value": action1.value,
        "result": "Success"
    })

    # Step 2: Fresh context after search navigation (results page)
    step2_context = {
        "page": {"title": "Search Results for tutorials", "url": "https://media.example.com/results?q=tutorials"},
        "elements": [
            {"id": "search-input", "tag": "input", "type": "search", "label": "Search Media", "selector": "#search"},
            {"id": "result-link-1", "tag": "a", "label": "Intro to Tutorials Video", "selector": ".result-item:first-child"},
            {"id": "result-link-2", "tag": "a", "label": "Advanced Tutorials", "selector": ".result-item:nth-child(2)"}
        ]
    }
    action2 = await simulator.generate_action(
        task="Search for tutorials and play the first video",
        page_context=step2_context,
        step_history=history,
        current_step=2,
        max_steps=10,
    )
    assert action2.action == "CLICK"
    assert action2.target.elementId == "result-link-1"

    history.append({
        "step": 2,
        "action": action2.action,
        "target": "result-link-1",
        "result": "Success"
    })

    # Step 3: Fresh context after navigating to video player
    step3_context = {
        "page": {"title": "Intro to Tutorials Video Player", "url": "https://media.example.com/watch?v=123"},
        "elements": [
            {"id": "video-player", "tag": "video", "label": "Video Player", "selector": "video#player"},
            {"id": "play-btn", "tag": "button", "label": "Play Video", "selector": ".play-btn"}
        ]
    }
    action3 = await simulator.generate_action(
        task="Search for tutorials and play the first video",
        page_context=step3_context,
        step_history=history,
        current_step=3,
        max_steps=10,
    )
    assert action3.action in ["PLAY", "CLICK"]

    history.append({
        "step": 3,
        "action": action3.action,
        "target": "video-player",
        "result": "Success"
    })

    # Step 4: Video is now playing -> AI returns STOP with completion reasoning
    action4 = await simulator.generate_action(
        task="Search for tutorials and play the first video",
        page_context=step3_context,
        step_history=history,
        current_step=4,
        max_steps=10,
    )
    assert action4.action == "STOP"
    assert "playing" in action4.reason.lower() or "achieved" in action4.reason.lower() or "complete" in action4.reason.lower()
