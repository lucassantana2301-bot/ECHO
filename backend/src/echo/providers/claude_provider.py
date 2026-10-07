"""Anthropic Claude provider adapter implementation using httpx."""

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


class ClaudeExtractor:
    def __init__(self, api_key: str, model: str = "claude-3-5-sonnet-20241022", base_url: str = "https://api.anthropic.com/v1", timeout: float = 60.0):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    @property
    def id(self) -> str:
        return f"claude-{self.model}"

    def extract(self, text: str, *, occurred_at: datetime) -> ExtractionOutput:
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        prompt = (
            f"Episode occurred at: {occurred_at.isoformat()}\n\n"
            f"Text:\n{text}\n\n"
            f"Respond with pure JSON only matching: {{\"candidates\": [...]}}"
        )
        payload = {
            "model": self.model,
            "max_tokens": 4096,
            "system": EXTRACTION_SYSTEM_PROMPT,
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.0,
        }

        try:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.post(f"{self.base_url}/messages", json=payload, headers=headers)
                res.raise_for_status()
                data = res.json()
                raw_text = data["content"][0]["text"]
                
                # Extract JSON if surrounded by markdown code blocks
                json_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw_text)
                if json_match:
                    raw_text = json_match.group(1)

                parsed = json.loads(raw_text.strip())
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
            logger.exception(f"Claude extraction failed: {e}")
            raise ProviderError(f"Claude extraction error: {e}") from e


class ClaudeAnswerer:
    def __init__(self, api_key: str, model: str = "claude-3-5-sonnet-20241022", base_url: str = "https://api.anthropic.com/v1", timeout: float = 60.0):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def answer(self, question: str, context: list[ContextItem]) -> AnswerDraft:
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
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

        prompt = (
            f"Context Claims:\n{context_str}\n\n"
            f"User Question:\n{question}\n\n"
            f"Respond with pure JSON only matching: {{\"answer\": \"...\", \"cited_claim_ids\": [...]}}"
        )

        payload = {
            "model": self.model,
            "max_tokens": 2048,
            "system": ANSWER_GROUNDING_SYSTEM_PROMPT,
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.0,
        }

        try:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.post(f"{self.base_url}/messages", json=payload, headers=headers)
                res.raise_for_status()
                data = res.json()
                raw_text = data["content"][0]["text"]
                
                json_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw_text)
                if json_match:
                    raw_text = json_match.group(1)

                raw_json = json.loads(raw_text.strip())
                valid_ids = {c.claim_id for c in context}
                raw_cids = raw_json.get("cited_claim_ids", [])
                grounded_cids = [str(cid) for cid in raw_cids if str(cid) in valid_ids]
                return AnswerDraft(
                    text=raw_json.get("answer", ""),
                    cited_claim_ids=grounded_cids,
                    mode="llm",
                )
        except Exception as e:
            logger.exception(f"Claude answer failed: {e}")
            raise ProviderError(f"Claude answer error: {e}") from e
