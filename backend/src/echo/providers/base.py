"""Provider adapter contracts (LLM extraction, embeddings, answer composition).

Two implementations exist and are never mixed implicitly:
- ``demo``: deterministic rules + feature hashing. Real computation, but NOT AI.
- ``live``: a real model behind an OpenAI-compatible HTTP API.

Every derived artifact stores ``provider_mode`` and ``pipeline_version``.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal, Protocol

from pydantic import AwareDatetime, BaseModel, Field

from echo.domain import ClaimKind, Domain, Sensitivity

ProviderMode = Literal["demo", "live"]


class ProviderError(RuntimeError):
    """Transient or permanent provider failure. Never converted into fake success."""


class EntitySpec(BaseModel):
    kind: str = Field(min_length=1, max_length=24)
    name: str = Field(min_length=1, max_length=200)


class ExtractionCandidate(BaseModel):
    """Strict schema every raw candidate must satisfy before it can touch memory."""

    kind: ClaimKind
    subject_key: str = Field(min_length=3, max_length=200)
    statement: str = Field(min_length=1, max_length=1000)
    value: str = Field(min_length=1, max_length=300)
    polarity: Literal["positive", "negative"] = "positive"
    domain: Domain = Domain.OTHER
    quote: str = Field(min_length=1, max_length=4000)
    span_start: int | None = Field(default=None, ge=0)
    span_end: int | None = Field(default=None, ge=1)
    valid_from: AwareDatetime | None = None
    signals_change: bool = False
    extraction_confidence: float = Field(ge=0.0, le=1.0)
    importance: float = Field(default=0.5, ge=0.0, le=1.0)
    sensitivity: Sensitivity = Sensitivity.LOW
    entity: EntitySpec | None = None
    lang: str = Field(default="und", max_length=8)


@dataclass
class ExtractionOutput:
    raw_candidates: list[Any]
    extractor_id: str
    notes: list[str] = field(default_factory=list)


@dataclass
class ContextItem:
    claim_id: str
    kind: str
    statement: str
    valid_from: datetime | None
    valid_to: datetime | None
    quotes: list[str]


@dataclass
class AnswerDraft:
    text: str
    cited_claim_ids: list[str]
    mode: Literal["extractive_demo", "llm"]


class Extractor(Protocol):
    id: str

    def extract(self, text: str, *, occurred_at: datetime) -> ExtractionOutput: ...


class Embedder(Protocol):
    provider_name: str
    model: str
    dim: int

    def embed(self, texts: list[str]) -> list[list[float] | None]: ...


class Answerer(Protocol):
    def answer(self, question: str, context: list[ContextItem]) -> AnswerDraft: ...


@dataclass(frozen=True)
class Providers:
    mode: ProviderMode
    extractor: Extractor
    embedder: Embedder
    answerer: Answerer

    @property
    def pipeline_version(self) -> str:
        return f"{self.mode}:{self.extractor.id}"
