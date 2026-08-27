import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

ENV_PATH = Path(__file__).resolve().parent / ".env"


class Settings(BaseSettings):
    SERVER_HOST: str = "0.0.0.0"
    SERVER_PORT: int = 8000

    # Primary Model Provider: Hugging Face Qwen VLM (Open-weight Vision-Language Model)
    HF_TOKEN: Optional[str] = None
    HF_MODEL: str = "Qwen/Qwen2.5-VL-72B-Instruct"

    # Fallback Model Provider: Gemini API
    GEMINI_API_KEY: Optional[str] = None
    GEMINI_MODEL: str = "gemini-3.1-flash-lite"

    # Active provider mode: 'auto' (HF -> Gemini fallback), 'huggingface', 'gemini', 'simulator'
    PROVIDER_MODE: str = "auto"


    model_config = SettingsConfigDict(env_file=str(ENV_PATH), env_file_encoding="utf-8", extra="ignore")


settings = Settings()


