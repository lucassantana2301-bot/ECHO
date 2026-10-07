"""Google Gemini provider adapter implementation using httpx."""

from datetime import datetime
import json
import logging
import re
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


class GeminiExtractor:
    def __init__(self, api_key: str, model: str = "gemini-2.5-flash", base_url: str = "https://generativelanguage.googleapis.com/v1beta", timeout: float = 60.0):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    @property
    def id(self) -> str:
        return f"gemini-{self.model}"

    def extract(self, text: str, *, occurred_at: datetime) -> ExtractionOutput:
        url = f"{self.base_url}/models/{self.model}:generateContent?key={self.api_key}"
        payload = {
            "system_instruction": {
                "parts": [{"text": EXTRACTION_SYSTEM_PROMPT}]
            },
            "contents": [{
                "parts": [{"text": f"Episode occurred at: {occurred_at.isoformat()}\n\nText:\n{text}"}]
            }],
            "generationConfig": {
                "response_mime_type": "application/json",
                "temperature": 0.0,
            }
        }

        try:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.post(url, json=payload)
                res.raise_for_status()
                data = res.json()
                raw_text = data["candidates"][0]["content"]["parts"][0]["text"]
                parsed = json.loads(raw_text)
                candidates_raw = parsed.get("candidates", [])

                # Span resolution fallback
                for cand in candidates_raw:
                    quote = cand.get("quote", "")
                    if quote and (cand.get("span_start") is None or cand.get("span_end") is None):
                        idx = text.find(quote)
                        if idx != -1:
                            cand["span_start"] = idx
                            cand["span_end"] = idx + len(quote)

                return ExtractionOutput(raw_candidates=candidates_raw, extractor_id=self.id)
        except Exception as e:
            logger.exception(f"Gemini extraction failed: {e}")
            raise ProviderError(f"Gemini extraction error: {e}") from e


class GeminiEmbedder:
    def __init__(self, api_key: str, model: str = "text-embedding-004", dim: int = 768, base_url: str = "https://generativelanguage.googleapis.com/v1beta", timeout: float = 30.0):
        self.provider_name = "gemini"
        self.api_key = api_key
        self.model = model
        self.dim = dim
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def embed(self, texts: list[str]) -> list[list[float] | None]:
        if not texts:
            return []
        url = f"{self.base_url}/models/{self.model}:batchEmbedContents?key={self.api_key}"
        requests = [
            {"model": f"models/{self.model}", "content": {"parts": [{"text": t}]}}
            for t in texts
        ]
        try:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.post(url, json={"requests": requests})
                res.raise_for_status()
                data = res.json()
                return [emb["values"] for emb in data.get("embeddings", [])]
        except Exception as e:
            logger.exception(f"Gemini embedding failed: {e}")
            raise ProviderError(f"Gemini embedding error: {e}") from e


class GeminiAnswerer:
    def __init__(self, api_key: str, model: str = "gemini-2.5-flash", base_url: str = "https://generativelanguage.googleapis.com/v1beta", timeout: float = 60.0):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def answer(self, question: str, context: list[ContextItem]) -> AnswerDraft:
        url = f"{self.base_url}/models/{self.model}:generateContent?key={self.api_key}"
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
            "system_instruction": {
                "parts": [{"text": ANSWER_GROUNDING_SYSTEM_PROMPT}]
            },
            "contents": [{
                "parts": [{"text": prompt}]
            }],
            "generationConfig": {
                "response_mime_type": "application/json",
                "temperature": 0.0,
            }
        }

        try:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.post(url, json=payload)
                res.raise_for_status()
                data = res.json()
                raw_text = data["candidates"][0]["content"]["parts"][0]["text"]
                raw_json = json.loads(raw_text)
                valid_ids = {c.claim_id for c in context}
                raw_cids = raw_json.get("cited_claim_ids", [])
                grounded_cids = [str(cid) for cid in raw_cids if str(cid) in valid_ids]
                return AnswerDraft(
                    text=raw_json.get("answer", ""),
                    cited_claim_ids=grounded_cids,
                    mode="llm",
                )
        except Exception as e:
            logger.exception(f"Gemini answer failed: {e}")
            raise ProviderError(f"Gemini answer error: {e}") from e
