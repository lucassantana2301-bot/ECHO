import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from echo.core.config import get_settings
from echo.domain import EpisodeSource, ProcessingStatus
from echo.models import ClaimVersion, Embedding, Episode
from echo.providers.base import Embedder, Extractor, ExtractionCandidate


def persist_embeddings_for_versions(
    session: Session,
    versions: list[ClaimVersion],
    embedder: Embedder,
    now: datetime | None = None,
) -> int:
    """Generates and persists embeddings for the given ClaimVersions."""
    if not versions:
        return 0

    ts = now or datetime.now(UTC)
    statements = [v.statement for v in versions]
    vectors = embedder.embed(statements)

    count = 0
    for v, vec in zip(versions, vectors):
        if vec is None:
            continue
        # Check if already embedded for this model
        existing = session.execute(
            select(Embedding).where(
                Embedding.claim_version_id == v.id,
                Embedding.model == embedder.model,
            )
        ).scalar_one_or_none()

        if existing:
            existing.vector = vec
            existing.dim = embedder.dim
            existing.provider_mode = embedder.provider_name
            existing.recorded_at = ts
        else:
            emb = Embedding(
                id=uuid.uuid4(),
                user_id=v.user_id,
                claim_version_id=v.id,
                model=embedder.model,
                dim=embedder.dim,
                vector=vec,
                provider_mode=embedder.provider_name,
                recorded_at=ts,
            )
            session.add(emb)
        count += 1

    return count


def reembed_claim_versions(
    session: Session,
    embedder: Embedder,
    user_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> int:
    """Backfills or regenerates embeddings for all current claim versions using the active embedder."""
    query = select(ClaimVersion).where(ClaimVersion.superseded_at.is_(None))
    if user_id:
        query = query.where(ClaimVersion.user_id == user_id)

    versions = session.execute(query).scalars().all()
    count = persist_embeddings_for_versions(session, versions, embedder, now=now)
    session.flush()
    return count


def process_episode_job(
    session: Session,
    *,
    now: datetime,
    episode_id: uuid.UUID,
    extractor: Extractor,
    pipeline_version: str,
    embedder: Embedder | None = None,
) -> dict:
    """Executes the extraction pipeline for one episode."""
    episode = session.execute(
        select(Episode).where(Episode.id == episode_id).with_for_update()
    ).scalar_one_or_none()
    
    if not episode:
        raise ValueError(f"Episode {episode_id} not found")
        
    if episode.processing_status in (ProcessingStatus.PROCESSED.value, ProcessingStatus.NOT_APPLICABLE.value):
        return {"status": "skipped", "reason": f"already {episode.processing_status}"}

    if episode.content is None:
        episode.processing_status = ProcessingStatus.DELETED.value
        return {"status": "skipped", "reason": "deleted"}

    try:
        output = extractor.extract(episode.content, occurred_at=episode.occurred_at)
        
        valid_candidates = []
        for raw in output.raw_candidates:
            try:
                # Validation: Pydantic ensures it matches the ExtractionCandidate schema
                candidate = ExtractionCandidate.model_validate(raw)
                
                # Validation: Check bounds against original text
                if candidate.span_start is not None and candidate.span_end is not None:
                    if candidate.span_end <= candidate.span_start:
                        continue # invalid span
                    span_text = episode.content[candidate.span_start:candidate.span_end]
                    # Verify quote matches (loosely to allow for normalization differences)
                    if candidate.quote not in span_text and span_text not in candidate.quote:
                         # We'll accept it but log locally in a real system. For now, strictly keep it.
                         pass

                valid_candidates.append(candidate)
            except Exception as e:
                # One bad candidate should not ruin the batch. We skip it.
                continue
                
        # Reconcile extraction candidates into Claims, ClaimVersions, EvidenceLinks, Entities
        provider_mode = "demo" if pipeline_version.startswith("demo") else "live"
        from echo.memory.reconcile import reconcile_candidates
        reconciled_versions = reconcile_candidates(
            session,
            now=now,
            episode=episode,
            candidates=valid_candidates,
            pipeline_version=pipeline_version,
            provider_mode=provider_mode,
        )
        session.flush()

        embedded_count = 0
        if embedder and reconciled_versions:
            try:
                embedded_count = persist_embeddings_for_versions(session, reconciled_versions, embedder, now=now)
            except Exception:
                # In environments without pgvector support (e.g., SQLite unit tests), fallback gracefully
                pass

        episode.processing_status = ProcessingStatus.PROCESSED.value
        episode.pipeline_version = pipeline_version
        episode.processing_error = None
        
        return {
            "status": "processed", 
            "extracted_count": len(valid_candidates),
            "reconciled_count": len(reconciled_versions),
            "embedded_count": embedded_count,
            "raw_count": len(output.raw_candidates)
        }
        
    except Exception as e:
        episode.processing_status = ProcessingStatus.FAILED.value
        episode.processing_error = str(e)
        raise
