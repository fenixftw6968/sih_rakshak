import time
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any, Optional

from config import settings

app = FastAPI(
    title="Rakshak - Privacy-Preserving Vision Agent Server",
    description="Backend reasoning server for privacy-preserving browser agent",
    version="1.0.0",
)

# CORS configuration for browser extension integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Permits Chrome Extension requests (chrome-extension://*)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PingRequest(BaseModel):
    client_id: Optional[str] = "browser-extension"
    timestamp: Optional[float] = None
    metadata: Optional[Dict[str, Any]] = None


class PingResponse(BaseModel):
    status: str
    message: str
    server_time: float
    client_id: str
    configured_provider: str
    hf_model: Optional[str]
    hf_configured: bool
    gemini_configured: bool


class ActionRequest(BaseModel):
    task: str
    page: Optional[Dict[str, Any]] = None
    elements: list[Dict[str, Any]] = []
    sanitizedImage: Optional[str] = None
    clientId: Optional[str] = "browser-extension"
    stepHistory: Optional[list[Dict[str, Any]]] = []
    currentStep: Optional[int] = 1
    maxSteps: Optional[int] = 10


@app.get("/health")
def health_check():
    """Health check endpoint to verify server readiness and configuration."""
    return {
        "status": "healthy",
        "service": "rakshak-backend",
        "timestamp": time.time(),
        "config": {
            "host": settings.SERVER_HOST,
            "port": settings.SERVER_PORT,
            "provider_mode": settings.PROVIDER_MODE,
            "hf_model": settings.HF_MODEL,
            "hf_configured": bool(settings.HF_TOKEN),
            "gemini_model": settings.GEMINI_MODEL,
            "gemini_configured": bool(settings.GEMINI_API_KEY),
        },
    }


@app.post("/api/v1/ping", response_model=PingResponse)
def ping(request: PingRequest):
    """Connectivity test endpoint called by the extension."""
    return PingResponse(
        status="success",
        message="Pong from Rakshak Privacy Server",
        server_time=time.time(),
        client_id=request.client_id or "browser-extension",
        configured_provider=settings.PROVIDER_MODE,
        hf_model=settings.HF_MODEL,
        hf_configured=bool(settings.HF_TOKEN),
        gemini_configured=bool(settings.GEMINI_API_KEY),
    )


from providers import provider_manager, BrowserAction


import logging

server_logger = logging.getLogger("rakshak-server")


@app.post("/api/v1/act", response_model=BrowserAction)
async def decide_browser_action(request: ActionRequest):
    """
    Receives sanitized browser context and determines the next declarative browser action.
    Server performs a final privacy check on incoming payload to ensure no raw passwords exist.
    """
    # Server-Side Privacy Audit
    sensitive_count = 0
    for el in request.elements:
        val = str(el.get("value") or "")
        el_type = str(el.get("type") or "").lower()
        if el.get("isSensitive") or el_type == "password":
            sensitive_count += 1
        if el_type == "password" and val and val != "[REDACTED_PASSWORD]":
            # Sanitize on the fly if raw password reached server
            el["value"] = "[REDACTED_PASSWORD]"

    context = {
        "page": request.page or {},
        "elements": request.elements,
    }

    # Minimal Development Request Logging (Never logs sensitive values)
    has_image = bool(request.sanitizedImage)
    elements_count = len(request.elements)
    img_size_kb = round(len(request.sanitizedImage) / 1024, 1) if request.sanitizedImage else 0
    step_num = request.currentStep or 1
    max_steps = request.maxSteps or 10
    server_logger.info(
        f"[Sanitized Request Received] Step: {step_num}/{max_steps} | Task: '{request.task}' | Elements: {elements_count} | "
        f"Sensitive Items Redacted: {sensitive_count} | Redacted Screenshot: {has_image} ({img_size_kb} KB)"
    )

    from fastapi import HTTPException

    try:
        action = await provider_manager.decide_action(
            task=request.task,
            page_context=context,
            sanitized_image=request.sanitizedImage,
            step_history=request.stepHistory,
            current_step=step_num,
            max_steps=max_steps,
        )
        return action
    except Exception as e:
        server_logger.error(f"Reasoning decision error: {e}")
        raise HTTPException(status_code=502, detail=str(e))



if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=settings.SERVER_HOST, port=settings.SERVER_PORT, reload=True)
