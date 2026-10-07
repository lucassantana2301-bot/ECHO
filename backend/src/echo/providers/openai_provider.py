"""OpenAI provider adapter implementation using httpx."""

from datetime import datetime
import json
import logging
from typing import Any

import httpx

from echo.providers.base import (
    AnswerDraft,
    ContextItem,
    ExtractionCandidate,
    ExtractionOutput,
    ProviderError,
)
from echo.providers.prompts import ANSWER_GROUNDING_SYSTEM_PROMPT, EXTRACTION_SYSTEM_PROMPT

logger = logging.getLogger(__name__)


class OpenAIExtractor:
    def __init__(self, api_key: str, model: str = "gpt-4o-mini", base_url: str = "https://api.openai.com/v1", timeout: float = 60.0):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    @property
    def id(self) -> str:
        return f"openai-{self.model}"

    def extract(self, text: str, *, occurred_at: datetime) -> ExtractionOutput:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
                {"role": "user", "content": f"Episode occurred at: {occurred_at.isoformat()}\n\nText:\n{text}"},
            ],
            "temperature": 0.0,
        }

        try:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.post(f"{self.base_url}/chat/completions", json=payload, headers=headers)
                res.raise_for_status()
                data = res.json()
                raw_json_str = data["choices"][0]["message"]["content"]
                parsed = json.loads(raw_json_str)
                candidates_raw = parsed.get("candidates", [])
                
                # Fill span offsets if missing
                for cand in candidates_raw:
                    quote = cand.get("quote", "")
                    if quote and (cand.get("span_start") is None or cand.get("span_end") is None):
                        idx = text.find(quote)
                        if idx != -1:
                            cand["span_start"] = idx
                            cand["span_end"] = idx + len(quote)

                return ExtractionOutput(raw_candidates=candidates_raw, extractor_id=self.id)
        except Exception as e:
            logger.exception(f"OpenAI extraction failed: {e}")
            raise ProviderError(f"OpenAI extraction error: {e}") from e


class OpenAIEmbedder:
    def __init__(self, api_key: str, model: str = "text-embedding-3-small", dim: int = 1536, base_url: str = "https://api.openai.com/v1", timeout: float = 30.0):
        self.provider_name = "openai"
        self.api_key = api_key
        self.model = model
        self.dim = dim
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def embed(self, texts: list[str]) -> list[list[float] | None]:
        if not texts:
            return []
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "input": texts,
        }
        try:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.post(f"{self.base_url}/embeddings", json=payload, headers=headers)
                res.raise_for_status()
                data = res.json()
                results = []
                for item in sorted(data["data"], key=lambda x: x["index"]):
                    results.append(item["embedding"])
                return results
        except Exception as e:
            logger.exception(f"OpenAI embedding failed: {e}")
            raise ProviderError(f"OpenAI embedding error: {e}") from e


class OpenAIAnswerer:
    def __init__(self, api_key: str, model: str = "gpt-4o-mini", base_url: str = "https://api.openai.com/v1", timeout: float = 60.0):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def answer(self, question: str, context: list[ContextItem]) -> AnswerDraft:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
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
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": ANSWER_GROUNDING_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.0,
        }

        try:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.post(f"{self.base_url}/chat/completions", json=payload, headers=headers)
                res.raise_for_status()
                data = res.json()
                raw_json = json.loads(data["choices"][0]["message"]["content"])
                valid_ids = {c.claim_id for c in context}
                raw_cids = raw_json.get("cited_claim_ids", [])
                grounded_cids = [str(cid) for cid in raw_cids if str(cid) in valid_ids]
                return AnswerDraft(
                    text=raw_json.get("answer", ""),
                    cited_claim_ids=grounded_cids,
                    mode="llm",
                )
        except Exception as e:
            logger.exception(f"OpenAI answer failed: {e}")
            raise ProviderError(f"OpenAI answer error: {e}") from e
