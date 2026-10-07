"""Ollama local provider adapter implementation using httpx."""

from datetime import datetime
import json
import logging
from typing import Any

import httpx

from echo.providers.base import (
    AnswerDraft,
    ContextItem,
    ExtractionOutput,
    ProviderError,
)
from echo.providers.prompts import ANSWER_GROUNDING_SYSTEM_PROMPT, EXTRACTION_SYSTEM_PROMPT

logger = logging.getLogger(__name__)


class OllamaExtractor:
    def __init__(self, model: str = "llama3.2", base_url: str = "http://localhost:11434", timeout: float = 120.0):
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    @property
    def id(self) -> str:
        return f"ollama-{self.model}"

    def extract(self, text: str, *, occurred_at: datetime) -> ExtractionOutput:
        payload = {
            "model": self.model,
            "format": "json",
            "messages": [
                {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
                {"role": "user", "content": f"Episode occurred at: {occurred_at.isoformat()}\n\nText:\n{text}"},
            ],
            "options": {"temperature": 0.0},
            "stream": False,
        }

        try:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.post(f"{self.base_url}/api/chat", json=payload)
                res.raise_for_status()
                data = res.json()
                raw_json_str = data["message"]["content"]
                parsed = json.loads(raw_json_str)
                candidates_raw = parsed.get("candidates", [])

                for cand in candidates_raw:
                    quote = cand.get("quote", "")
                    if quote and (cand.get("span_start") is None or cand.get("span_end") is None):
                        idx = text.find(quote)
                        if idx != -1:
                            cand["span_start"] = idx
                            cand["span_end"] = idx + len(quote)

                return ExtractionOutput(raw_candidates=candidates_raw, extractor_id=self.id)
        except Exception as e:
            logger.exception(f"Ollama extraction failed: {e}")
            raise ProviderError(f"Ollama extraction error: {e}") from e


class OllamaEmbedder:
    def __init__(self, model: str = "nomic-embed-text", dim: int = 768, base_url: str = "http://localhost:11434", timeout: float = 60.0):
        self.provider_name = "ollama"
        self.model = model
        self.dim = dim
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def embed(self, texts: list[str]) -> list[list[float] | None]:
        if not texts:
            return []
        try:
            results: list[list[float] | None] = []
            with httpx.Client(timeout=self.timeout) as client:
                # Try batch embed endpoint /api/embed if available
                res = client.post(f"{self.base_url}/api/embed", json={"model": self.model, "input": texts})
                if res.status_code == 200:
                    data = res.json()
                    return data.get("embeddings", [])
                
                # Fallback to single /api/embeddings endpoint
                for t in texts:
                    r = client.post(f"{self.base_url}/api/embeddings", json={"model": self.model, "prompt": t})
                    r.raise_for_status()
                    results.append(r.json().get("embedding"))
            return results
        except Exception as e:
            logger.exception(f"Ollama embedding failed: {e}")
            raise ProviderError(f"Ollama embedding error: {e}") from e


class OllamaAnswerer:
    def __init__(self, model: str = "llama3.2", base_url: str = "http://localhost:11434", timeout: float = 120.0):
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def answer(self, question: str, context: list[ContextItem]) -> AnswerDraft:
        context_str = json.dumps([
            {
                "claim_id": c.claim_id,
                "kind": c.kind,
                "statement": c.statement,
                "valid_from": c.valid_from.isoformat() if c.valid_from else None,
                "valid_to": c.valid_to.isoformat() if c.valid_to else None,
                "quotes": c.quotes,
            }
            for c in context
        ], ensure_ascii=False, indent=2)

        prompt = f"Context Claims:\n{context_str}\n\nUser Question:\n{question}"

        payload = {
            "model": self.model,
            "format": "json",
            "messages": [
                {"role": "system", "content": ANSWER_GROUNDING_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            "options": {"temperature": 0.0},
            "stream": False,
        }

        try:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.post(f"{self.base_url}/api/chat", json=payload)
                res.raise_for_status()
                data = res.json()
                raw_json = json.loads(data["message"]["content"])
                valid_ids = {c.claim_id for c in context}
                raw_cids = raw_json.get("cited_claim_ids", [])
                grounded_cids = [str(cid) for cid in raw_cids if str(cid) in valid_ids]
                return AnswerDraft(
                    text=raw_json.get("answer", ""),
                    cited_claim_ids=grounded_cids,
                    mode="llm",
                )
        except Exception as e:
            logger.exception(f"Ollama answer failed: {e}")
            raise ProviderError(f"Ollama answer error: {e}") from e
