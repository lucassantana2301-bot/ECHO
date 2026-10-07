from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Every variable is prefixed with ``ECHO_``."""

    model_config = SettingsConfigDict(env_prefix="ECHO_", env_file=".env", extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"
    database_url: str = "postgresql+psycopg://echo:echo@localhost:5432/echo"

    jwt_secret: str = Field(default="dev-only-insecure-secret-change-me", min_length=16)
    jwt_ttl_minutes: int = 60 * 12

    # "demo" = deterministic rule-based extraction + hashing embeddings (no credentials).
    # "live" = real LLM/embedding provider via an OpenAI-compatible HTTP API.
    # There is NO silent fallback from live to demo.
    provider_mode: Literal["demo", "live", "openai", "gemini", "ollama", "claude"] = "demo"
    llm_provider: Literal["openai", "gemini", "ollama", "claude"] = "openai"
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    llm_model: str | None = None

    # Embedder selection: when using Claude or custom setups, embed_provider determines which implemented embedder to use
    embed_provider: Literal["openai", "gemini", "ollama", "demo"] | None = None
    embed_base_url: str | None = None
    embed_api_key: str | None = None
    embed_model: str | None = None
    embed_dim: int | None = None
    llm_timeout_seconds: float = 60.0
    demo_embed_dim: int = 256

    job_max_attempts: int = 5
    job_lease_seconds: int = 300
    worker_poll_seconds: float = 1.0

    # Memory policy
    reconfirm_after_days: int = 180
    decay_half_life_days: int = 365
    pattern_min_independent_episodes: int = 3

    @model_validator(mode="after")
    def _validate(self) -> "Settings":
        if self.provider_mode in ("live", "openai", "gemini", "claude"):
            provider = self.llm_provider if self.provider_mode == "live" else self.provider_mode
            if provider != "ollama" and not self.llm_api_key:
                raise ValueError(f"Provider {provider} requires ECHO_LLM_API_KEY to be set")
        if self.env == "prod" and self.jwt_secret.startswith("dev-only"):
            raise ValueError("ECHO_JWT_SECRET must be set in prod")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
