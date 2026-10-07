"""Episode ingestion and retrieval."""

import uuid
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from echo.core.config import get_settings
from echo.core.text import content_hash
from echo.core.temporal import recorded_visible, valid_at_filter
from echo.domain import EpisodeSource, JobKind, ProcessingStatus
from echo.jobs.queue import enqueue_job
from echo.models import Episode


def ingest_episode(
    session: Session,
    *,
    now: datetime,
    user_id: uuid.UUID,
    source_type: EpisodeSource,
    content: str,
    occurred_at: datetime | None = None,
    is_synthetic: bool = False,
) -> Episode:
    """Saves the episode and schedules its processing job in the same transaction."""
    if not content.strip():
        raise ValueError("Episode content cannot be empty")

    chash = content_hash(content)
    actual_occurred = occurred_at or now

    # Check for exact duplicate within the user's history
    duplicate = session.execute(
        select(Episode).where(Episode.user_id == user_id, Episode.content_hash == chash).limit(1)
    ).scalar_one_or_none()

    episode = Episode(
        user_id=user_id,
        source_type=source_type.value,
        content=content,
        content_hash=chash,
        occurred_at=actual_occurred,
        recorded_at=now,
        processing_status=ProcessingStatus.PENDING.value,
        duplicate_of_episode_id=duplicate.id if duplicate else None,
        is_synthetic=is_synthetic,
    )
    session.add(episode)
    session.flush()

    if duplicate:
        episode.processing_status = ProcessingStatus.NOT_APPLICABLE.value
        return episode

    enqueue_job(
        session,
        now=now,
        user_id=user_id,
        kind=JobKind.PROCESS_EPISODE.value,
        payload={"episode_id": str(episode.id)},
        idempotency_key=f"process_episode_{episode.id}",
        max_attempts=get_settings().job_max_attempts,
    )
    return episode
