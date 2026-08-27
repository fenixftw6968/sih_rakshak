import urllib.request
import json
import sys

def test_connectivity():
    base_url = "http://127.0.0.1:8000"
    
    # 1. Health check
    try:
        req = urllib.request.Request(f"{base_url}/health")
        with urllib.request.urlopen(req, timeout=3) as resp:
            assert resp.status == 200
            data = json.loads(resp.read().decode())
            print(f"[OK] Health check passed: {data}")
    except Exception as e:
        print(f"[FAIL] Health check failed: {e}")
        return False

    # 2. Ping check
    try:
        ping_payload = json.dumps({"client_id": "test_script"}).encode()
        req = urllib.request.Request(
            f"{base_url}/api/v1/ping",
            data=ping_payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            assert resp.status == 200
            data = json.loads(resp.read().decode())
            print(f"[OK] Ping check passed: {data}")
    except Exception as e:
        print(f"[FAIL] Ping check failed: {e}")
        return False

    return True

if __name__ == "__main__":
    if not test_connectivity():
        sys.exit(1)
    print("\nAll live HTTP connectivity tests passed.")
