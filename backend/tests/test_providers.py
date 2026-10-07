"""Unit tests for providers (demo extractor, embedder, answerer, and candidate models)."""

from datetime import UTC, datetime
import pytest

from echo.domain import ClaimKind, Domain, Sensitivity
from echo.providers.base import (
    ContextItem,
    EntitySpec,
    ExtractionCandidate,
)
from echo.providers.demo import DemoExtractiveAnswerer, DemoHashingEmbedder, DemoRuleExtractor


def test_extraction_candidate_validation():
    candidate = ExtractionCandidate(
        kind=ClaimKind.GOAL,
        subject_key="career.goal",
        statement="Meu objetivo é me tornar Staff Engineer",
        value="Staff Engineer",
        polarity="positive",
        domain=Domain.CAREER,
        quote="meu objetivo é me tornar Staff Engineer",
        span_start=0,
        span_end=40,
        extraction_confidence=0.9,
        importance=0.8,
        sensitivity=Sensitivity.LOW,
        entity=EntitySpec(kind="role", name="Staff Engineer"),
    )
    assert candidate.kind == ClaimKind.GOAL
    assert candidate.subject_key == "career.goal"


def test_demo_rule_extractor_portuguese():
    extractor = DemoRuleExtractor()
    now = datetime(2026, 10, 5, 12, 0, 0, tzinfo=UTC)
    text = "Meu objetivo é me tornar Engenheiro de Software. Estou aprendendo Rust desde janeiro de 2026."
    
    out = extractor.extract(text, occurred_at=now)
    assert len(out.raw_candidates) >= 2
    
    # Check that candidates contain goal and learning
    kinds = [c["kind"] for c in out.raw_candidates]
    assert ClaimKind.GOAL.value in kinds or ClaimKind.EXPLICIT_STATEMENT.value in kinds


def test_demo_hashing_embedder():
    embedder = DemoHashingEmbedder(dim=128)
    assert embedder.dim == 128
    
    vecs = embedder.embed(["Hello world", "Learning Rust"])
    assert len(vecs) == 2
    assert len(vecs[0]) == 128
    assert len(vecs[1]) == 128


def test_demo_extractive_answerer():
    answerer = DemoExtractiveAnswerer()
    context = [
        ContextItem(
            claim_id="claim-123",
            kind="goal",
            statement="Objetivo de carreira: Staff Engineer",
            valid_from=None,
            valid_to=None,
            quotes=["meu objetivo é me tornar Staff Engineer"],
        )
    ]
    
    draft = answerer.answer("Qual é meu objetivo?", context)
    assert "Staff Engineer" in draft.text
    assert "claim-123" in draft.cited_claim_ids
