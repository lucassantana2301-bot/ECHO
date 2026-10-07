"""Validation, verification, and fallback policy for answers.

Strictly verifies that:
1. All cited claim IDs belong to the retrieved context.
2. Any UUIDs or claim references mentioned in the text body belong to the retrieved context.
3. If the answer cites invalid claims or lacks verified evidence, it is rejected and a safe extractive fallback or insufficient evidence notice is returned.
"""

import re
from typing import Sequence

from echo.providers.base import AnswerDraft, ContextItem


def validate_and_ground_answer(
    draft: AnswerDraft,
    context: Sequence[ContextItem],
) -> tuple[str, list[str], str]:
    """Validates the draft against context.

    Returns:
        (final_text, verified_cited_claim_ids, status_note)
    """
    if not context:
        return (
            "Não possuo memórias ou evidências registradas para responder a esta pergunta.",
            [],
            "empty_context",
        )

    valid_context_map = {c.claim_id: c for c in context}
    valid_ids = set(valid_context_map.keys())

    # 1. Check if cited_claim_ids contain any unverified/hallucinated ID
    for cid in draft.cited_claim_ids:
        if str(cid) not in valid_ids:
            return _safe_extractive_fallback(
                context,
                reason=f"Rejected answer: cited claim ID '{cid}' does not exist in retrieved context."
            )

    # 2. Check if text mentions hallucinated UUIDs formatted as claim IDs
    uuid_pattern = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.IGNORECASE)
    mentioned_uuids = set(uuid_pattern.findall(draft.text))
    hallucinated_mentions = mentioned_uuids - valid_ids
    if hallucinated_mentions:
        return _safe_extractive_fallback(
            context,
            reason=f"Rejected answer: text body references unverified IDs {hallucinated_mentions}."
        )

    # 3. Check if response is uncited when context is present
    if not draft.cited_claim_ids:
        return _safe_extractive_fallback(
            context,
            reason="Rejected answer: response failed to substantiate claims with citations."
        )

    # Validated and accepted
    verified_cids = [str(cid) for cid in draft.cited_claim_ids if str(cid) in valid_ids]
    return draft.text, verified_cids, "verified_citations"


def _safe_extractive_fallback(
    context: Sequence[ContextItem],
    reason: str,
) -> tuple[str, list[str], str]:
    """Builds a deterministic, 100% verified extractive summary from the highest-ranked context items."""
    usable_items = [c for c in context if c.quotes or c.statement][:3]
    if not usable_items:
        return (
            "Evidência insuficiente ou não verificada no contexto recuperado.",
            [],
            f"fallback_insufficient_evidence: {reason}",
        )

    summary_lines = []
    cited_ids = []
    for item in usable_items:
        quoted = f' "{item.quotes[0]}"' if item.quotes else ""
        summary_lines.append(f"- {item.statement}{quoted}")
        cited_ids.append(item.claim_id)

    fallback_text = (
        "Informação verificada com base nas memórias registradas:\n"
        + "\n".join(summary_lines)
    )
    return fallback_text, cited_ids, f"fallback_extractive: {reason}"
