import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from echo.api.auth import CurrentUser, DbSession
from echo.core.clock import SYSTEM_CLOCK
from echo.domain import EpisodeSource
from echo.episodes.ingest import ingest_episode
from echo.models import Episode

router = APIRouter(prefix="/episodes", tags=["episodes"])


class EpisodeCreate(BaseModel):
    content: str
    source_type: EpisodeSource = EpisodeSource.CHAT
    occurred_at: datetime | None = None
    is_synthetic: bool = False


class EpisodeResponse(BaseModel):
    id: uuid.UUID
    source_type: EpisodeSource
    occurred_at: datetime
    processing_status: str


class EpisodeListItem(BaseModel):
    id: uuid.UUID
    source_type: EpisodeSource
    content_preview: str | None
    occurred_at: datetime
    recorded_at: datetime
    processing_status: str


@router.get("", response_model=list[EpisodeListItem])
def list_episodes(
    user: CurrentUser,
    db: DbSession,
    limit: int = 50,
):
    from sqlalchemy import select
    from echo.models import Episode

    episodes = db.execute(
        select(Episode)
        .where(Episode.user_id == user.id)
        .order_by(Episode.occurred_at.desc())
        .limit(limit)
    ).scalars().all()

    return [
        EpisodeListItem(
            id=ep.id,
            source_type=EpisodeSource(ep.source_type) if ep.source_type in [e.value for e in EpisodeSource] else EpisodeSource.CHAT,
            content_preview=(ep.content[:160] + "...") if ep.content and len(ep.content) > 160 else ep.content,
            occurred_at=ep.occurred_at,
            recorded_at=ep.recorded_at,
            processing_status=ep.processing_status,
        )
        for ep in episodes
    ]


@router.post("", response_model=EpisodeResponse)
def create_episode(
    req: EpisodeCreate,
    user: CurrentUser,
    db: DbSession,
):
    try:
        episode = ingest_episode(
            db,
            now=SYSTEM_CLOCK.now(),
            user_id=user.id,
            source_type=req.source_type,
            content=req.content,
            occurred_at=req.occurred_at,
            is_synthetic=req.is_synthetic,
        )
        db.commit()

        # In dev / demo mode: automatically execute extraction and embedding immediately so UI reflects results without waiting for async worker process
        try:
            from echo.pipeline.process import process_episode_job
            from echo.providers.registry import get_providers
            providers = get_providers()
            process_episode_job(
                session=db,
                now=SYSTEM_CLOCK.now(),
                episode_id=episode.id,
                extractor=providers.extractor,
                embedder=providers.embedder,
                pipeline_version=providers.pipeline_version,
            )
            db.commit()
        except Exception:
            db.rollback()

        return episode
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
