import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, and_, or_
from sqlalchemy.orm import joinedload

from echo.api.auth import CurrentUser, DbSession
from echo.domain import ClaimStatus, Domain
from echo.models import Claim, ClaimVersion, Episode, EvidenceLink

router = APIRouter(prefix="/claims", tags=["claims"])


class EvidenceDetail(BaseModel):
    link_id: uuid.UUID
    episode_id: uuid.UUID
    quote: str | None
    span_start: int | None
    span_end: int | None
    source_type: str | None
    occurred_at: datetime | None
    confidence: float | None
    stance: str


class ClaimVersionDetail(BaseModel):
    version_id: uuid.UUID
    version_no: int
    kind: str
    statement: str
    attributes: dict
    status: str
    origin: str
    change_reason: str
    importance: float
    sensitivity: str
    valid_from: datetime | None
    valid_to: datetime | None
    recorded_at: datetime
    superseded_at: datetime | None
    pipeline_version: str
    provider_mode: str
    evidences: list[EvidenceDetail] = []


class ClaimDetail(BaseModel):
    id: uuid.UUID
    subject_key: str
    domain: str
    recorded_at: datetime
    current_version: ClaimVersionDetail | None = None
    versions: list[ClaimVersionDetail] = []


class ClaimListItem(BaseModel):
    id: uuid.UUID
    subject_key: str
    domain: str
    recorded_at: datetime
    statement: str | None = None
    kind: str | None = None
    valid_from: datetime | None = None
    valid_to: datetime | None = None
    status: str | None = None
    importance: float | None = None


@router.get("", response_model=list[ClaimListItem])
def list_claims(
    user: CurrentUser,
    db: DbSession,
    as_of: datetime | None = Query(None, description="Time of observation (bitemporal recorded_at cut)"),
    valid_at: datetime | None = Query(None, description="Time of occurrence (bitemporal real-world validity)"),
    domain: str | None = Query(None),
):
    """Lists claims for current user with optional bitemporal point-in-time filters."""
    query = select(Claim).where(Claim.user_id == user.id)
    if domain:
        query = query.where(Claim.domain == domain)

    claims = db.execute(query.order_by(Claim.recorded_at.desc())).scalars().all()
    results = []

    for c in claims:
        # Find matching version
        v_query = select(ClaimVersion).where(
            ClaimVersion.claim_id == c.id,
            ClaimVersion.user_id == user.id,
        )

        if as_of:
            v_query = v_query.where(
                ClaimVersion.recorded_at <= as_of,
                or_(ClaimVersion.superseded_at.is_(None), ClaimVersion.superseded_at > as_of),
            )
        else:
            v_query = v_query.where(ClaimVersion.superseded_at.is_(None))

        if valid_at:
            v_query = v_query.where(
                or_(ClaimVersion.valid_from.is_(None), ClaimVersion.valid_from <= valid_at),
                or_(ClaimVersion.valid_to.is_(None), ClaimVersion.valid_to >= valid_at),
            )

        active_v = db.execute(v_query.order_by(ClaimVersion.version_no.desc())).scalars().first()

        if active_v or (not as_of and not valid_at):
            results.append(
                ClaimListItem(
                    id=c.id,
                    subject_key=c.subject_key,
                    domain=c.domain,
                    recorded_at=c.recorded_at,
                    statement=active_v.statement if active_v else None,
                    kind=active_v.kind if active_v else None,
                    valid_from=active_v.valid_from if active_v else None,
                    valid_to=active_v.valid_to if active_v else None,
                    status=active_v.status if active_v else None,
                    importance=active_v.importance if active_v else None,
                )
            )

    return results





class GraphNode(BaseModel):
    id: str
    label: str
    group: str  # "domain" | "entity" | "claim"
    importance: float = 1.0
    domain: str = "GENERAL"


class GraphEdge(BaseModel):
    source: str
    target: str
    relation: str
    weight: float = 1.0


class GraphResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


@router.get("/graph/network", response_model=GraphResponse)
def get_knowledge_graph(
    user: CurrentUser,
    db: DbSession,
):
    """Generates an interconnected neural memory network graph for current user."""
    claims = db.execute(
        select(Claim).where(Claim.user_id == user.id)
    ).scalars().all()

    nodes: dict[str, GraphNode] = {}
    edges: list[GraphEdge] = []

    # Central user root node
    nodes["user_root"] = GraphNode(
        id="user_root",
        label="Digital Twin",
        group="user",
        importance=2.0,
        domain="CORE",
    )

    domain_nodes_created = set()

    for c in claims:
        # Get active version
        v = db.execute(
            select(ClaimVersion)
            .where(ClaimVersion.claim_id == c.id, ClaimVersion.user_id == user.id, ClaimVersion.superseded_at.is_(None))
            .order_by(ClaimVersion.version_no.desc())
        ).scalars().first()

        if not v:
            continue

        dom = c.domain
        if dom not in domain_nodes_created:
            domain_nodes_created.add(dom)
            nodes[f"dom_{dom}"] = GraphNode(
                id=f"dom_{dom}",
                label=dom,
                group="domain",
                importance=1.5,
                domain=dom,
            )
            edges.append(
                GraphEdge(source="user_root", target=f"dom_{dom}", relation="DOMÍNIO", weight=1.5)
            )

        cid = str(c.id)
        short_label = v.statement[:40] + "..." if len(v.statement) > 40 else v.statement
        nodes[cid] = GraphNode(
            id=cid,
            label=short_label,
            group="claim",
            importance=float(v.importance or 1.0),
            domain=dom,
        )
        edges.append(
            GraphEdge(source=f"dom_{dom}", target=cid, relation=v.kind or "FATO", weight=1.0)
        )

        # If claim has subject key, link to subject entity
        if c.subject_key and c.subject_key != "user":
            subj_id = f"ent_{c.subject_key}"
            if subj_id not in nodes:
                nodes[subj_id] = GraphNode(
                    id=subj_id,
                    label=c.subject_key,
                    group="entity",
                    importance=1.2,
                    domain=dom,
                )
            edges.append(
                GraphEdge(source=cid, target=subj_id, relation="SOBRE", weight=0.8)
            )

    return GraphResponse(nodes=list(nodes.values()), edges=edges)


@router.get("/{claim_id}", response_model=ClaimDetail)
def get_claim_details(
    claim_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
):
    """Returns complete version history and evidence links for a single claim."""
    claim = db.execute(
        select(Claim).where(Claim.id == claim_id, Claim.user_id == user.id)
    ).scalar_one_or_none()

    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")

    versions = db.execute(
        select(ClaimVersion)
        .where(ClaimVersion.claim_id == claim.id, ClaimVersion.user_id == user.id)
        .order_by(ClaimVersion.version_no.desc())
    ).scalars().all()

    version_details = []
    current_version_detail = None

    for v in versions:
        # Load evidences with user isolation
        links = db.execute(
            select(EvidenceLink, Episode)
            .join(Episode, EvidenceLink.episode_id == Episode.id)
            .where(
                EvidenceLink.claim_version_id == v.id,
                EvidenceLink.user_id == user.id,
                Episode.user_id == user.id,
            )
        ).all()

        ev_list = []
        for link, ep in links:
            ev_list.append(
                EvidenceDetail(
                    link_id=link.id,
                    episode_id=ep.id,
                    quote=link.quote,
                    span_start=link.span_start,
                    span_end=link.span_end,
                    source_type=ep.source_type,
                    occurred_at=ep.occurred_at,
                    confidence=v.extraction_confidence,
                    stance=link.stance,
                )
            )

        v_detail = ClaimVersionDetail(
            version_id=v.id,
            version_no=v.version_no,
            kind=v.kind,
            statement=v.statement,
            attributes=v.attributes or {},
            status=v.status,
            origin=v.origin,
            change_reason=v.change_reason,
            importance=v.importance,
            sensitivity=v.sensitivity,
            valid_from=v.valid_from,
            valid_to=v.valid_to,
            recorded_at=v.recorded_at,
            superseded_at=v.superseded_at,
            pipeline_version=v.pipeline_version,
            provider_mode=v.provider_mode,
            evidences=ev_list,
        )
        version_details.append(v_detail)
        if v.superseded_at is None and current_version_detail is None:
            current_version_detail = v_detail

    return ClaimDetail(
        id=claim.id,
        subject_key=claim.subject_key,
        domain=claim.domain,
        recorded_at=claim.recorded_at,
        current_version=current_version_detail,
        versions=version_details,
    )

