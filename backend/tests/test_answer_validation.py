"""Unit tests for strict answer validation, rejection of invalid citations, and extractive fallbacks."""

import pytest

from echo.providers.base import AnswerDraft, ContextItem
from echo.retrieval.answer_validation import validate_and_ground_answer


@pytest.fixture
def sample_context():
    return [
        ContextItem(
            claim_id="11111111-1111-1111-1111-111111111111",
            kind="explicit_statement",
            statement="Trabalha como Tech Lead",
            valid_from=None,
            valid_to=None,
            quotes=["trabalho como Tech Lead"],
        ),
        ContextItem(
            claim_id="22222222-2222-2222-2222-222222222222",
            kind="explicit_statement",
            statement="Estuda Rust",
            valid_from=None,
            valid_to=None,
            quotes=["estou estudando Rust"],
        ),
    ]


def test_valid_answer_accepted(sample_context):
    draft = AnswerDraft(
        text="Você trabalha como Tech Lead e está estudando Rust.",
        cited_claim_ids=[
            "11111111-1111-1111-1111-111111111111",
            "22222222-2222-2222-2222-222222222222",
        ],
        mode="llm",
    )
    final_text, cited, status = validate_and_ground_answer(draft, sample_context)

    assert status == "verified_citations"
    assert final_text == draft.text
    assert cited == draft.cited_claim_ids


def test_invalid_citation_id_rejected_triggers_fallback(sample_context):
    draft = AnswerDraft(
        text="Você é diretor geral da empresa.",
        cited_claim_ids=["99999999-9999-9999-9999-999999999999"],  # Hallucinated ID
        mode="llm",
    )
    final_text, cited, status = validate_and_ground_answer(draft, sample_context)

    assert "fallback_extractive" in status
    # Hallucinated answer is rejected! Fallback is extracted from verified context
    assert "diretor geral" not in final_text
    assert "Tech Lead" in final_text
    assert "99999999-9999-9999-9999-999999999999" not in cited
    assert "11111111-1111-1111-1111-111111111111" in cited


def test_hallucinated_uuid_in_text_rejected(sample_context):
    draft = AnswerDraft(
        text="De acordo com 33333333-3333-3333-3333-333333333333, você é engenheiro.",
        cited_claim_ids=["11111111-1111-1111-1111-111111111111"],
        mode="llm",
    )
    final_text, cited, status = validate_and_ground_answer(draft, sample_context)

    assert "fallback_extractive" in status
    assert "33333333-3333-3333-3333-333333333333" not in final_text


def test_uncited_answer_when_context_present_rejected(sample_context):
    draft = AnswerDraft(
        text="Você trabalha com tecnologia.",
        cited_claim_ids=[],  # Uncited
        mode="llm",
    )
    final_text, cited, status = validate_and_ground_answer(draft, sample_context)

    assert "fallback_extractive" in status
    assert len(cited) > 0


def test_empty_context():
    draft = AnswerDraft(text="Qualquer resposta", cited_claim_ids=[], mode="llm")
    final_text, cited, status = validate_and_ground_answer(draft, [])

    assert status == "empty_context"
    assert cited == []
    assert "Não possuo memórias" in final_text
