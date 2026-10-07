from functools import lru_cache

from echo.core.config import get_settings
from echo.providers.base import Providers
from echo.providers.demo import DemoExtractiveAnswerer, DemoHashingEmbedder, DemoRuleExtractor


def _build_embedder(settings, default_provider: str):
    """Builds the embedder using only actually implemented provider adapters."""
    target_embedder = settings.embed_provider or (default_provider if default_provider in ("openai", "gemini", "ollama") else "demo")

    if target_embedder == "openai":
        from echo.providers.openai_provider import OpenAIEmbedder
        api_key = settings.embed_api_key or settings.llm_api_key or ""
        base_url = settings.embed_base_url or settings.llm_base_url or "https://api.openai.com/v1"
        model = settings.embed_model or "text-embedding-3-small"
        dim = settings.embed_dim or 1536
        return OpenAIEmbedder(api_key=api_key, model=model, dim=dim, base_url=base_url, timeout=settings.llm_timeout_seconds)

    if target_embedder == "gemini":
        from echo.providers.gemini_provider import GeminiEmbedder
        api_key = settings.embed_api_key or settings.llm_api_key or ""
        base_url = settings.embed_base_url or settings.llm_base_url or "https://generativelanguage.googleapis.com/v1beta"
        model = settings.embed_model or "text-embedding-004"
        dim = settings.embed_dim or 768
        return GeminiEmbedder(api_key=api_key, model=model, dim=dim, base_url=base_url, timeout=settings.llm_timeout_seconds)

    if target_embedder == "ollama":
        from echo.providers.ollama_provider import OllamaEmbedder
        base_url = settings.embed_base_url or settings.llm_base_url or "http://localhost:11434"
        model = settings.embed_model or "nomic-embed-text"
        dim = settings.embed_dim or 768
        return OllamaEmbedder(model=model, dim=dim, base_url=base_url, timeout=settings.llm_timeout_seconds)

    dim = settings.embed_dim or settings.demo_embed_dim
    return DemoHashingEmbedder(dim=dim)


@lru_cache
def get_providers() -> Providers:
    settings = get_settings()
    mode = settings.provider_mode

    if mode == "demo":
        return Providers(
            mode="demo",
            extractor=DemoRuleExtractor(),
            embedder=_build_embedder(settings, "demo"),
            answerer=DemoExtractiveAnswerer(),
        )

    provider_name = settings.llm_provider if mode == "live" else mode
    embedder = _build_embedder(settings, provider_name)

    if provider_name == "openai":
        from echo.providers.openai_provider import OpenAIAnswerer, OpenAIExtractor
        base_url = settings.llm_base_url or "https://api.openai.com/v1"
        model = settings.llm_model or "gpt-4o-mini"
        return Providers(
            mode="live",
            extractor=OpenAIExtractor(api_key=settings.llm_api_key or "", model=model, base_url=base_url, timeout=settings.llm_timeout_seconds),
            embedder=embedder,
            answerer=OpenAIAnswerer(api_key=settings.llm_api_key or "", model=model, base_url=base_url, timeout=settings.llm_timeout_seconds),
        )

    if provider_name == "gemini":
        from echo.providers.gemini_provider import GeminiAnswerer, GeminiExtractor
        base_url = settings.llm_base_url or "https://generativelanguage.googleapis.com/v1beta"
        model = settings.llm_model or "gemini-2.5-flash"
        return Providers(
            mode="live",
            extractor=GeminiExtractor(api_key=settings.llm_api_key or "", model=model, base_url=base_url, timeout=settings.llm_timeout_seconds),
            embedder=embedder,
            answerer=GeminiAnswerer(api_key=settings.llm_api_key or "", model=model, base_url=base_url, timeout=settings.llm_timeout_seconds),
        )

    if provider_name == "ollama":
        from echo.providers.ollama_provider import OllamaAnswerer, OllamaExtractor
        base_url = settings.llm_base_url or "http://localhost:11434"
        model = settings.llm_model or "llama3.2"
        return Providers(
            mode="live",
            extractor=OllamaExtractor(model=model, base_url=base_url, timeout=settings.llm_timeout_seconds),
            embedder=embedder,
            answerer=OllamaAnswerer(model=model, base_url=base_url, timeout=settings.llm_timeout_seconds),
        )

    if provider_name == "claude":
        from echo.providers.claude_provider import ClaudeAnswerer, ClaudeExtractor
        base_url = settings.llm_base_url or "https://api.anthropic.com/v1"
        model = settings.llm_model or "claude-3-5-sonnet-20241022"
        return Providers(
            mode="live",
            extractor=ClaudeExtractor(api_key=settings.llm_api_key or "", model=model, base_url=base_url, timeout=settings.llm_timeout_seconds),
            embedder=embedder,
            answerer=ClaudeAnswerer(api_key=settings.llm_api_key or "", model=model, base_url=base_url, timeout=settings.llm_timeout_seconds),
        )

    raise ValueError(f"Unsupported provider: {provider_name}")
