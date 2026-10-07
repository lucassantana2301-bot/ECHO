"""Memory reconciliation: maps extraction candidates to claims, versions, and evidence.

Implements bitemporal claim versioning, supersession, evidence tracking,
and entity relation management.
"""

from datetime import datetime
import uuid

from sqlalchemy import select, func, and_
from sqlalchemy.orm import Session

from echo.core.text import slugify
from echo.domain import (
    ChangeReason,
    ClaimKind,
    ClaimStatus,
    Domain,
    EpisodeSource,
    Sensitivity,
    SINGLE_VALUED_FAMILIES,
    Stance,
    VersionOrigin,
)
from echo.models import (
    AuditEvent,
    Claim,
    ClaimVersion,
    Entity,
    Episode,
    EvidenceLink,
    RelationVersion,
)
from echo.providers.base import ExtractionCandidate


def reconcile_candidates(
    session: Session,
    *,
    now: datetime,
    episode: Episode,
    candidates: list[ExtractionCandidate],
    pipeline_version: str,
    provider_mode: str,
) -> list[ClaimVersion]:
    """Reconciles extraction candidates for a given episode into the memory model."""
    created_or_updated_versions: list[ClaimVersion] = []

    for candidate in candidates:
        version = _reconcile_single_candidate(
            session,
            now=now,
            episode=episode,
            candidate=candidate,
            pipeline_version=pipeline_version,
            provider_mode=provider_mode,
        )
        if version:
            created_or_updated_versions.append(version)

    return created_or_updated_versions


def _reconcile_single_candidate(
    session: Session,
    *,
    now: datetime,
    episode: Episode,
    candidate: ExtractionCandidate,
    pipeline_version: str,
    provider_mode: str,
) -> ClaimVersion:
    """Processes a single extraction candidate with full bitemporal versioning."""
    user_id = episode.user_id

    # 1. Find or create the Claim root
    claim = session.execute(
        select(Claim).where(
            Claim.user_id == user_id,
            Claim.subject_key == candidate.subject_key,
        )
    ).scalar_one_or_none()

    if not claim:
        claim = Claim(
            id=uuid.uuid4(),
            user_id=user_id,
            subject_key=candidate.subject_key,
            domain=candidate.domain.value if isinstance(candidate.domain, Domain) else str(candidate.domain),
            is_synthetic=episode.is_synthetic,
            recorded_at=now,
        )
        session.add(claim)
        session.flush()

    # 2. Find currently active (non-superseded) version for this claim
    current_version = session.execute(
        select(ClaimVersion).where(
            ClaimVersion.claim_id == claim.id,
            ClaimVersion.superseded_at.is_(None),
        )
    ).scalar_one_or_none()

    # Determine validity interval
    valid_from = candidate.valid_from or episode.occurred_at

    claim_version: ClaimVersion

    if current_version is None:
        # Determine highest version_no historically
        max_v = session.execute(
            select(func.coalesce(func.max(ClaimVersion.version_no), 0)).where(
                ClaimVersion.claim_id == claim.id
            )
        ).scalar() or 0

        # Create brand new ClaimVersion
        claim_version = ClaimVersion(
            id=uuid.uuid4(),
            claim_id=claim.id,
            user_id=user_id,
            version_no=max_v + 1,
            kind=candidate.kind.value if isinstance(candidate.kind, ClaimKind) else str(candidate.kind),
            statement=candidate.statement,
            attributes={"value": candidate.value, "polarity": candidate.polarity, "lang": candidate.lang},
            status=ClaimStatus.ACTIVE.value,
            origin=VersionOrigin.EXTRACTION.value,
            change_reason=ChangeReason.CREATED.value,
            change_note=None,
            extraction_confidence=candidate.extraction_confidence,
            importance=candidate.importance,
            sensitivity=candidate.sensitivity.value if isinstance(candidate.sensitivity, Sensitivity) else str(candidate.sensitivity),
            last_confirmed_at=now,
            valid_from=valid_from,
            valid_to=None,
            recorded_at=now,
            superseded_at=None,
            pipeline_version=pipeline_version,
            provider_mode=provider_mode,
            source_episode_id=episode.id,
        )
        session.add(claim_version)
        session.flush()

    else:
        # Check if the content is identical
        current_value = current_version.attributes.get("value") if current_version.attributes else None
        is_same_statement = current_version.statement == candidate.statement
        is_same_value = current_value == candidate.value

        if is_same_statement and is_same_value and not candidate.signals_change:
            # Reconfirming existing fact without changing statement
            current_version.last_confirmed_at = now
            claim_version = current_version
        else:
            # Supersede previous version
            current_version.superseded_at = now
            if candidate.signals_change and current_version.valid_to is None:
                current_version.valid_to = valid_from

            # Create new superseded version
            claim_version = ClaimVersion(
                id=uuid.uuid4(),
                claim_id=claim.id,
                user_id=user_id,
                version_no=current_version.version_no + 1,
                kind=candidate.kind.value if isinstance(candidate.kind, ClaimKind) else str(candidate.kind),
                statement=candidate.statement,
                attributes={"value": candidate.value, "polarity": candidate.polarity, "lang": candidate.lang},
                status=ClaimStatus.ACTIVE.value,
                origin=VersionOrigin.EXTRACTION.value,
                change_reason=ChangeReason.CORRECTED.value if not candidate.signals_change else ChangeReason.ENDED.value,
                change_note=f"Superseded by episode {episode.id}",
                extraction_confidence=candidate.extraction_confidence,
                importance=candidate.importance,
                sensitivity=candidate.sensitivity.value if isinstance(candidate.sensitivity, Sensitivity) else str(candidate.sensitivity),
                last_confirmed_at=now,
                valid_from=valid_from,
                valid_to=None,
                recorded_at=now,
                superseded_at=None,
                pipeline_version=pipeline_version,
                provider_mode=provider_mode,
                source_episode_id=episode.id,
            )
            session.add(claim_version)
            session.flush()

    # 3. Create EvidenceLink if span is present
    if candidate.span_start is not None and candidate.span_end is not None and candidate.quote:
        # Check for existing evidence link
        existing_link = session.execute(
            select(EvidenceLink).where(
                EvidenceLink.claim_id == claim.id,
                EvidenceLink.episode_id == episode.id,
                EvidenceLink.span_start == candidate.span_start,
                EvidenceLink.span_end == candidate.span_end,
            )
        ).scalar_one_or_none()

        if not existing_link:
            is_indep = (
                episode.source_type not in (EpisodeSource.SUMMARY.value, EpisodeSource.SYNTHETIC_SEED.value)
                and episode.duplicate_of_episode_id is None
            )
            evidence = EvidenceLink(
                id=uuid.uuid4(),
                user_id=user_id,
                claim_id=claim.id,
                claim_version_id=claim_version.id,
                episode_id=episode.id,
                span_start=candidate.span_start,
                span_end=candidate.span_end,
                quote=candidate.quote,
                stance=Stance.SUPPORTS.value if candidate.polarity == "positive" else Stance.CONTRADICTS.value,
                is_independent=is_indep,
                recorded_at=now,
                invalidated_at=None,
            )
            session.add(evidence)
            session.flush()

    # 4. Process Entity and RelationVersion if specified
    if candidate.entity:
        _reconcile_entity_relation(
            session,
            now=now,
            user_id=user_id,
            claim=claim,
            claim_version=claim_version,
            entity_spec=candidate.entity,
            is_synthetic=episode.is_synthetic,
        )

    # 5. Record operational audit event
    audit = AuditEvent(
        id=uuid.uuid4(),
        user_id=user_id,
        actor="system",
        action="reconcile_claim",
        target_type="claim_version",
        target_id=claim_version.id,
        details={
            "claim_id": str(claim.id),
            "version_no": claim_version.version_no,
            "change_reason": claim_version.change_reason,
            "episode_id": str(episode.id),
        },
        recorded_at=now,
    )
    session.add(audit)

    return claim_version


def _reconcile_entity_relation(
    session: Session,
    *,
    now: datetime,
    user_id: uuid.UUID,
    claim: Claim,
    claim_version: ClaimVersion,
    entity_spec,
    is_synthetic: bool,
) -> None:
    norm_name = slugify(entity_spec.name)
    entity = session.execute(
        select(Entity).where(
            Entity.user_id == user_id,
            Entity.kind == entity_spec.kind,
            Entity.normalized_name == norm_name,
        )
    ).scalar_one_or_none()

    if not entity:
        entity = Entity(
            id=uuid.uuid4(),
            user_id=user_id,
            kind=entity_spec.kind,
            name=entity_spec.name,
            normalized_name=norm_name,
            is_synthetic=is_synthetic,
            recorded_at=now,
        )
        session.add(entity)
        session.flush()

    predicate = claim.subject_key.split(".")[0] if "." in claim.subject_key else "related"

    # Find currently active relation version for this claim
    active_rel = session.execute(
        select(RelationVersion).where(
            RelationVersion.claim_id == claim.id,
            RelationVersion.superseded_at.is_(None),
        )
    ).scalar_one_or_none()

    if (
        active_rel is not None
        and active_rel.entity_id == entity.id
        and active_rel.claim_version_id == claim_version.id
        and active_rel.predicate == predicate
    ):
        return  # Existing relation is already active and matches this claim version

    if active_rel is not None:
        active_rel.superseded_at = now

    rel_version = RelationVersion(
        id=uuid.uuid4(),
        user_id=user_id,
        claim_id=claim.id,
        claim_version_id=claim_version.id,
        entity_id=entity.id,
        predicate=predicate,
        status=ClaimStatus.ACTIVE.value,
        valid_from=claim_version.valid_from,
        valid_to=claim_version.valid_to,
        recorded_at=now,
        superseded_at=None,
    )
    session.add(rel_version)
    session.flush()
