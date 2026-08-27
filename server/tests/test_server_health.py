import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_health_check_endpoint():
    """Verify that the /health endpoint responds with 200 and healthy status."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "rakshak-backend"
    assert "config" in data
    assert "provider_mode" in data["config"]
    assert "hf_model" in data["config"]



def test_ping_endpoint():
    """Verify extension connectivity ping endpoint."""
    payload = {
        "client_id": "test-extension-client",
        "timestamp": 1700000000.0,
        "metadata": {"version": "1.0.0"}
    }
    response = client.post("/api/v1/ping", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "Pong" in data["message"]
    assert data["client_id"] == "test-extension-client"
    assert "server_time" in data
    assert "configured_provider" in data
