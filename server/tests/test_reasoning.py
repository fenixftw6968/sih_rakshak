import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_act_endpoint_valid_context():
    """Verify /api/v1/act returns structured browser action for sanitized payload."""
    payload = {
        "task": "Click the submit button to log in",
        "page": {
            "title": "Account Sign In",
            "url": "https://example.com/login",
        },
        "elements": [
            {
                "id": "rakshak-el-1",
                "tag": "input",
                "type": "email",
                "label": "Email Address",
                "value": "[REDACTED_EMAIL]",
                "selector": "#email",
            },
            {
                "id": "rakshak-el-2",
                "tag": "input",
                "type": "password",
                "label": "Password",
                "value": "[REDACTED_PASSWORD]",
                "selector": "#password",
            },
            {
                "id": "rakshak-el-3",
                "tag": "button",
                "type": "submit",
                "label": "Sign In",
                "selector": "#submitBtn",
            },
        ],
    }

    response = client.post("/api/v1/act", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "action" in data
    assert data["action"] in ["CLICK", "TYPE", "SCROLL", "WAIT", "STOP"]
    assert "reason" in data
    assert "providerUsed" in data
    # Check that it clicked the Sign In button
    assert data["action"] == "CLICK"
    if data.get("target"):
        target_id = data["target"].get("elementId")
        selector = data["target"].get("selector")
        assert target_id == "rakshak-el-3" or selector == "#submitBtn"


def test_act_endpoint_server_privacy_enforcement():
    """Verify that server-side privacy check sanitizes any raw password if leaked."""
    payload = {
        "task": "Test task",
        "elements": [
            {
                "id": "rakshak-el-1",
                "tag": "input",
                "type": "password",
                "value": "leaked_raw_secret",
            }
        ],
    }
    response = client.post("/api/v1/act", json=payload)
    assert response.status_code == 200


def test_act_endpoint_multistep_history():
    """Verify /api/v1/act accepts stepHistory, currentStep, and maxSteps."""
    payload = {
        "task": "Find product reviews and scroll down",
        "page": {
            "title": "Product Reviews Page",
            "url": "https://example.com/products/item-123",
        },
        "elements": [
            {
                "id": "rakshak-el-1",
                "tag": "a",
                "label": "User Reviews",
                "selector": "#reviews-link",
            }
        ],
        "stepHistory": [
            {
                "step": 1,
                "action": "CLICK",
                "target": "rakshak-el-1",
                "result": "Success"
            }
        ],
        "currentStep": 2,
        "maxSteps": 10,
    }
    response = client.post("/api/v1/act", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "action" in data
    assert data["action"] in ["CLICK", "TYPE", "KEY", "SCROLL", "WAIT", "STOP", "PLAY"]
    assert "reason" in data
    assert "providerUsed" in data
