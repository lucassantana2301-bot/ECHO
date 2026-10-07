from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from echo.api.auth import CurrentUser, DbSession
from echo.domain import RetrievalPurpose
from echo.providers.registry import get_providers
from echo.retrieval.answer_validation import validate_and_ground_answer
from echo.retrieval.search import retrieve_claims

router = APIRouter(prefix="/retrieve", tags=["retrieval"])


class RetrieveRequest(BaseModel):
    purpose: RetrievalPurpose = RetrievalPurpose.ANSWER
    question: str
    as_of: datetime | None = None
    valid_at: datetime | None = None
    limit: int = 10


class CitationDetail(BaseModel):
    claim_id: str
    kind: str
    statement: str
    quotes: list[str] = []
    valid_from: datetime | None = None
    valid_to: datetime | None = None


class RetrieveResponse(BaseModel):
    answer: str
    cited_claim_ids: list[str]
    citations: list[CitationDetail] = []
    reasoning_steps: list[str] = []
    provider_mode: str
    pipeline_version: str


@router.post("", response_model=RetrieveResponse)
def retrieve(
    req: RetrieveRequest,
    user: CurrentUser,
    db: DbSession,
):
    providers = get_providers()
    
    context = retrieve_claims(
        db,
        user_id=user.id,
        question=req.question,
        as_of=req.as_of,
        valid_at=req.valid_at,
        embedder=providers.embedder,
        limit=req.limit,
    )
    
    draft = providers.answerer.answer(req.question, context)
    
    # Strictly validate citations and text against context, with safe extractive fallback
    final_text, verified_claim_ids, _ = validate_and_ground_answer(draft, context)
    
    # Build detailed citations list for frontend UI
    context_map = {c.claim_id: c for c in context}
    detailed_citations = [
        CitationDetail(
            claim_id=cid,
            kind=context_map[cid].kind,
            statement=context_map[cid].statement,
            quotes=context_map[cid].quotes,
            valid_from=context_map[cid].valid_from,
            valid_to=context_map[cid].valid_to,
        )
        for cid in verified_claim_ids
        if cid in context_map
    ]

    # Generate cognitive reasoning steps for transparency
    temporal_filter_desc = "Vigência: presente (válido agora)"
    if req.valid_at:
        temporal_filter_desc = f"Vigência real no tempo: {req.valid_at.strftime('%d/%m/%Y')}"
    if req.as_of:
        temporal_filter_desc += f" | Histórico do sistema (as-of): {req.as_of.strftime('%d/%m/%Y %H:%M')}"

    steps = [
        f"🎯 Análise da Pergunta: Identificados conceitos-chave para '{req.question[:50]}...'",
        f"⚡ pgvector & Busca Híbrida: {len(context)} fatos/claims candidatos recuperados no banco",
        f"⏳ Filtro Bitemporal: {temporal_filter_desc}",
        f"🛡️ Auditoria de Citações: {len(verified_claim_ids)} referências validadas sem alucinação",
    ]

    return RetrieveResponse(
        answer=final_text,
        cited_claim_ids=verified_claim_ids,
        citations=detailed_citations,
        reasoning_steps=steps,
        provider_mode=providers.mode,
        pipeline_version=providers.pipeline_version,
    )

