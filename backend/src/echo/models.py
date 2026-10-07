"""Persistence model.

Temporal conventions (see docs/temporal-model.md):
- ``recorded_at``   : system time when ECHO learned / wrote the row (from Clock).
- ``superseded_at`` : system time when a version row stopped being current.
- ``valid_from`` / ``valid_to`` : when the information applies to the user's life.
- ``occurred_at``   : valid time of an interaction (episode).

Rows are never updated in place to change meaning: a change creates a new
version and closes the previous one via ``superseded_at``. The only in-place
mutations are (a) setting ``superseded_at``, (b) job bookkeeping and
(c) erasure of personal data on deletion requests.
"""

import uuid
from datetime import datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from echo.core.db import Base

TS = DateTime(timezone=True)


def _pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def _user_fk() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )


def _false() -> Any:
    return text("false")


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _pk()
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str | None] = mapped_column(String(120))
    is_synthetic: Mapped[bool] = mapped_column(Boolean, server_default=_false(), default=False)
    created_at: Mapped[datetime] = mapped_column(TS)


class Episode(Base):
    __tablename__ = "episodes"
    __table_args__ = (Index("ix_episodes_user_recorded", "user_id", "recorded_at"),)

    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _user_fk()
    source_type: Mapped[str] = mapped_column(String(32))
    content: Mapped[str | None] = mapped_column(Text)  # NULL after erasure
    content_hash: Mapped[str | None] = mapped_column(String(64))
    occurred_at: Mapped[datetime] = mapped_column(TS)
    recorded_at: Mapped[datetime] = mapped_column(TS)
    processing_status: Mapped[str] = mapped_column(String(24))
    processing_error: Mapped[str | None] = mapped_column(Text)
    pipeline_version: Mapped[str | None] = mapped_column(String(100))
    duplicate_of_episode_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("episodes.id", ondelete="SET NULL")
    )
    is_synthetic: Mapped[bool] = mapped_column(Boolean, server_default=_false(), default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(TS)


class Claim(Base):
    """Identity of one assertion about the user. Content lives in ClaimVersion."""

    __tablename__ = "claims"
    __table_args__ = (Index("ix_claims_user_subject", "user_id", "subject_key"),)

    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _user_fk()
    subject_key: Mapped[str] = mapped_column(String(200))
    domain: Mapped[str] = mapped_column(String(24))
    is_synthetic: Mapped[bool] = mapped_column(Boolean, server_default=_false(), default=False)
    recorded_at: Mapped[datetime] = mapped_column(TS)


class ClaimVersion(Base):
    __tablename__ = "claim_versions"
    __table_args__ = (
        UniqueConstraint("claim_id", "version_no", name="uq_claim_versions_claim_version"),
        Index(
            "ux_claim_versions_current",
            "claim_id",
            unique=True,
            postgresql_where=text("superseded_at IS NULL"),
            sqlite_where=text("superseded_at IS NULL"),
        ),
        Index("ix_claim_versions_user_recorded", "user_id", "recorded_at"),
        CheckConstraint(
            "extraction_confidence IS NULL OR "
            "(extraction_confidence >= 0 AND extraction_confidence <= 1)",
            name="ck_claim_versions_confidence_range",
        ),
        CheckConstraint(
            "importance >= 0 AND importance <= 1", name="ck_claim_versions_importance_range"
        ),
        CheckConstraint(
            "valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from",
            name="ck_claim_versions_valid_interval",
        ),
    )

    id: Mapped[uuid.UUID] = _pk()
    claim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("claims.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = _user_fk()
    version_no: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(24))
    statement: Mapped[str] = mapped_column(Text)
    attributes: Mapped[dict[str, Any]] = mapped_column(
        JSONB, server_default=text("'{}'"), default=dict
    )
    status: Mapped[str] = mapped_column(String(16))
    origin: Mapped[str] = mapped_column(String(24))
    change_reason: Mapped[str] = mapped_column(String(24))
    change_note: Mapped[str | None] = mapped_column(Text)
    # Confidence of the *extraction step* only. Not a probability that the claim is true.
    extraction_confidence: Mapped[float | None] = mapped_column(Float)
    importance: Mapped[float] = mapped_column(Float)
    sensitivity: Mapped[str] = mapped_column(String(8))
    last_confirmed_at: Mapped[datetime | None] = mapped_column(TS)
    valid_from: Mapped[datetime | None] = mapped_column(TS)
    valid_to: Mapped[datetime | None] = mapped_column(TS)
    recorded_at: Mapped[datetime] = mapped_column(TS)
    superseded_at: Mapped[datetime | None] = mapped_column(TS)
    pipeline_version: Mapped[str] = mapped_column(String(100))
    provider_mode: Mapped[str] = mapped_column(String(8))
    source_episode_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("episodes.id", ondelete="SET NULL")
    )


class EvidenceLink(Base):
    __tablename__ = "evidence_links"
    __table_args__ = (
        UniqueConstraint(
            "claim_id", "episode_id", "span_start", "span_end", name="uq_evidence_links_span"
        ),
        CheckConstraint(
            "span_start >= 0 AND span_end > span_start", name="ck_evidence_links_span"
        ),
    )

    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _user_fk()
    claim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("claims.id", ondelete="CASCADE"), index=True
    )
    claim_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("claim_versions.id", ondelete="CASCADE")
    )
    episode_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("episodes.id", ondelete="CASCADE"), index=True
    )
    span_start: Mapped[int] = mapped_column(Integer)
    span_end: Mapped[int] = mapped_column(Integer)
    quote: Mapped[str] = mapped_column(Text)
    stance: Mapped[str] = mapped_column(String(12))
    # False for duplicates of an earlier episode and for derived sources (summaries).
    is_independent: Mapped[bool] = mapped_column(Boolean)
    recorded_at: Mapped[datetime] = mapped_column(TS)
    invalidated_at: Mapped[datetime | None] = mapped_column(TS)


class Entity(Base):
    __tablename__ = "entities"
    __table_args__ = (
        UniqueConstraint("user_id", "kind", "normalized_name", name="uq_entities_user_kind_name"),
    )

    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _user_fk()
    kind: Mapped[str] = mapped_column(String(24))
    name: Mapped[str] = mapped_column(String(200))
    normalized_name: Mapped[str] = mapped_column(String(200))
    is_synthetic: Mapped[bool] = mapped_column(Boolean, server_default=_false(), default=False)
    recorded_at: Mapped[datetime] = mapped_column(TS)


class RelationVersion(Base):
    """User → entity relation derived from a claim version (e.g. learning → Rust)."""

    __tablename__ = "relation_versions"
    __table_args__ = (
        Index(
            "ux_relation_versions_current",
            "claim_id",
            unique=True,
            postgresql_where=text("superseded_at IS NULL"),
            sqlite_where=text("superseded_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _user_fk()
    claim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("claims.id", ondelete="CASCADE"), index=True
    )
    claim_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("claim_versions.id", ondelete="CASCADE")
    )
    entity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("entities.id", ondelete="CASCADE"), index=True
    )
    predicate: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16))
    valid_from: Mapped[datetime | None] = mapped_column(TS)
    valid_to: Mapped[datetime | None] = mapped_column(TS)
    recorded_at: Mapped[datetime] = mapped_column(TS)
    superseded_at: Mapped[datetime | None] = mapped_column(TS)


class ConflictLink(Base):
    __tablename__ = "conflict_links"
    __table_args__ = (
        UniqueConstraint("claim_a_id", "claim_b_id", name="uq_conflict_links_pair"),
        CheckConstraint("claim_a_id <> claim_b_id", name="ck_conflict_links_distinct"),
    )

    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _user_fk()
    claim_a_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("claims.id", ondelete="CASCADE"), index=True
    )
    claim_b_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("claims.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(24))
    status: Mapped[str] = mapped_column(String(16))
    resolution: Mapped[str | None] = mapped_column(String(24))
    rationale: Mapped[str] = mapped_column(Text)
    detected_episode_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("episodes.id", ondelete="SET NULL")
    )
    pipeline_version: Mapped[str] = mapped_column(String(100))
    recorded_at: Mapped[datetime] = mapped_column(TS)
    resolved_at: Mapped[datetime | None] = mapped_column(TS)


class Embedding(Base):
    __tablename__ = "embeddings"
    __table_args__ = (
        CheckConstraint(
            "(episode_id IS NULL) <> (claim_version_id IS NULL)",
            name="ck_embeddings_single_owner",
        ),
        UniqueConstraint("episode_id", "model", name="uq_embeddings_episode_model"),
        UniqueConstraint("claim_version_id", "model", name="uq_embeddings_claim_version_model"),
    )

    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _user_fk()
    episode_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("episodes.id", ondelete="CASCADE")
    )
    claim_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("claim_versions.id", ondelete="CASCADE")
    )
    model: Mapped[str] = mapped_column(String(100))
    dim: Mapped[int] = mapped_column(Integer)
    # Dimension-less column so the model can change; queries always filter by model+dim.
    vector: Mapped[Any] = mapped_column(Vector())
    provider_mode: Mapped[str] = mapped_column(String(8))
    recorded_at: Mapped[datetime] = mapped_column(TS)


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (Index("ix_jobs_status_run_after", "status", "run_after"),)

    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    idempotency_key: Mapped[str] = mapped_column(String(200), unique=True)
    status: Mapped[str] = mapped_column(String(16))
    attempts: Mapped[int] = mapped_column(Integer, server_default=text("0"), default=0)
    max_attempts: Mapped[int] = mapped_column(Integer)
    run_after: Mapped[datetime] = mapped_column(TS)
    locked_at: Mapped[datetime | None] = mapped_column(TS)
    locked_by: Mapped[str | None] = mapped_column(String(100))
    last_error: Mapped[str | None] = mapped_column(Text)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(TS)
    updated_at: Mapped[datetime] = mapped_column(TS)
    finished_at: Mapped[datetime | None] = mapped_column(TS)


class AuditEvent(Base):
    """Operational history. Must never contain personal content (texts, quotes)."""

    __tablename__ = "audit_events"
    __table_args__ = (Index("ix_audit_events_user_recorded", "user_id", "recorded_at"),)

    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    actor: Mapped[str] = mapped_column(String(16))
    action: Mapped[str] = mapped_column(String(48))
    target_type: Mapped[str] = mapped_column(String(32))
    target_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    details: Mapped[dict[str, Any]] = mapped_column(
        JSONB, server_default=text("'{}'"), default=dict
    )
    recorded_at: Mapped[datetime] = mapped_column(TS)
