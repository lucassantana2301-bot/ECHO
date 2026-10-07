"""Bitemporal and hybrid (vector + lexical) claim retrieval.

Applies strict recorded-time (`as_of`) and valid-time (`valid_at`) cuts directly
in SQL before assembling LLM context.
"""

from datetime import datetime
import uuid

from sqlalchemy import select, or_, and_, desc
from sqlalchemy.orm import Session

from echo.core.temporal import version_visible, evidence_visible, valid_at_filter
from echo.core.text import tokens_for_embedding
from echo.domain import ClaimStatus
from echo.models import Claim, ClaimVersion, EvidenceLink, Embedding
from echo.providers.base import ContextItem, Embedder


def retrieve_claims(
    session: Session,
    *,
    user_id: uuid.UUID,
    question: str | None = None,
    as_of: datetime | None = None,
    valid_at: datetime | None = None,
    embedder: Embedder | None = None,
    limit: int = 20,
) -> list[ContextItem]:
    """Retrieves active claims matching question with strict bitemporal eligibility."""
    
    # Base bitemporal filter
    base_conditions = [
        ClaimVersion.user_id == user_id,
        ClaimVersion.status == ClaimStatus.ACTIVE.value,
        version_visible(ClaimVersion, as_of=as_of),
        valid_at_filter(ClaimVersion, valid_at=valid_at),
    ]

    ranked_version_ids: list[uuid.UUID] = []

    # 1. Vector Search (if question and embedder are provided)
    if question and embedder:
        try:
            query_vectors = embedder.embed([question])
            if query_vectors and query_vectors[0] is not None:
                q_vec = query_vectors[0]
                # Query nearest claim embeddings
                p_mode = getattr(embedder, "provider_name", "live")
                vec_stmt = (
                    select(ClaimVersion.id)
                    .join(Embedding, Embedding.claim_version_id == ClaimVersion.id)
                    .where(
                        *base_conditions,
                        Embedding.provider_mode == p_mode,
                        Embedding.model == embedder.model,
                        Embedding.dim == embedder.dim,
                    )
                    .order_by(Embedding.vector.cosine_distance(q_vec))
                    .limit(limit)
                )
                vec_results = session.execute(vec_stmt).scalars().all()
                ranked_version_ids.extend(vec_results)
        except Exception:
            # Fallback smoothly to lexical ranking if vector search fails
            pass

    # 2. Lexical Search (token-based ILIKE or text matching)
    lexical_conditions = list(base_conditions)
    if question:
        q_tokens = [t for t in tokens_for_embedding(question) if len(t) >= 3]
        if q_tokens:
            token_filters = [ClaimVersion.statement.ilike(f"%{tok}%") for tok in q_tokens]
            lexical_conditions.append(or_(*token_filters))

    lex_stmt = (
        select(ClaimVersion.id)
        .where(*lexical_conditions)
        .order_by(ClaimVersion.importance.desc(), ClaimVersion.recorded_at.desc())
        .limit(limit)
    )
    lex_results = session.execute(lex_stmt).scalars().all()
    
    # Combine results preserving order without duplicates
    seen_ids = set()
    combined_ids: list[uuid.UUID] = []
    
    for vid in ranked_version_ids:
        if vid not in seen_ids:
            seen_ids.add(vid)
            combined_ids.append(vid)
            
    for vid in lex_results:
        if vid not in seen_ids:
            seen_ids.add(vid)
            combined_ids.append(vid)

    # 3. If no lexical/vector matches or no question provided, pull recent visible claims
    if len(combined_ids) < limit:
        fallback_stmt = (
            select(ClaimVersion.id)
            .where(*base_conditions)
            .order_by(ClaimVersion.importance.desc(), ClaimVersion.recorded_at.desc())
            .limit(limit)
        )
        fallback_results = session.execute(fallback_stmt).scalars().all()
        for vid in fallback_results:
            if vid not in seen_ids:
                seen_ids.add(vid)
                combined_ids.append(vid)
                if len(combined_ids) >= limit:
                    break

    if not combined_ids:
        return []

    # 4. Fetch full version rows and independent evidence quotes
    versions_stmt = (
        select(ClaimVersion)
        .where(ClaimVersion.id.in_(combined_ids))
    )
    version_map = {v.id: v for v in session.execute(versions_stmt).scalars().all()}

    results = []
    for vid in combined_ids:
        v = version_map.get(vid)
        if not v:
            continue

        ev_stmt = select(EvidenceLink.quote).where(
            EvidenceLink.claim_version_id == v.id,
            evidence_visible(EvidenceLink, as_of=as_of),
            EvidenceLink.is_independent == True,
        )
        quotes = session.execute(ev_stmt).scalars().all()

        results.append(
            ContextItem(
                claim_id=str(v.claim_id),
                kind=v.kind,
                statement=v.statement,
                valid_from=v.valid_from,
                valid_to=v.valid_to,
                quotes=list(quotes),
            )
        )

    return results
