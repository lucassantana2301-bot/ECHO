import React, { useState, useEffect, useCallback, useRef } from "react";
import { Plus, X, AlertCircle, RotateCcw } from "lucide-react";
import { api } from "../services/api";
import type { ClaimListItem, ClaimDetail, CitationDetail } from "../services/api";
import { EmptyState, SignalLoader } from "./ui";
import { detailError, formatDate, friendlyError } from "./format";
import { useClaimSources } from "../services/claimSources";

interface TimelineViewProps {
  onSelectCitation: (citation: CitationDetail) => void;
  onNewMemory: () => void;
}

const DOMAINS: Record<string, string> = {
  career: "Carreira",
  learning: "Aprendizado",
  projects: "Projetos",
  other: "Outros",
};

export const TimelineView: React.FC<TimelineViewProps> = ({ onSelectCitation, onNewMemory }) => {
  const [claims, setClaims] = useState<ClaimListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [asOf, setAsOf] = useState<string>("");
  const [validAt, setValidAt] = useState<string>("");
  const [domainFilter, setDomainFilter] = useState<string>("");

  // Selected Claim for deep inspection
  const [selectedClaim, setSelectedClaim] = useState<ClaimDetail | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);

  const fetchClaims = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listClaims({
        as_of: asOf ? new Date(asOf).toISOString() : null,
        valid_at: validAt ? new Date(validAt).toISOString() : null,
        domain: domainFilter || null,
      });
      setClaims(data);
    } catch (err) {
      setError(friendlyError(err, "Não foi possível carregar a linha do tempo."));
    } finally {
      setLoading(false);
    }
  }, [asOf, validAt, domainFilter]);

  useEffect(() => {
    fetchClaims();
  }, [fetchClaims]);

  const handleInspectClaim = async (claimId: string) => {
    setInspectError(null);
    try {
      const detail = await api.getClaimDetail(claimId);
      setSelectedClaim(detail);
      // On one-column layouts the detail sits below the list; bring it into view.
      if (window.matchMedia("(max-width: 999px)").matches) {
        requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      }
    } catch (err) {
      setInspectError(detailError(err));
    }
  };

  // Return focus to the fact that was opened, so keyboard and screen-reader users keep their place.
  const closeInspection = () => {
    const id = selectedClaim?.id;
    setSelectedClaim(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.tl__card[data-claim="${id}"]`)?.focus());
  };

  const sources = useClaimSources(claims.map((c) => c.id));
  const filtersActive = Boolean(asOf || validAt || domainFilter);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="kicker">
            <span className="kicker__num">02</span> Linha do tempo bitemporal
          </p>
          <h1 className="page-title">
            Como suas memórias <em>mudaram.</em>
          </h1>
          <p className="lead">Navegue no tempo e veja como suas metas, habilidades e preferências evoluíram — e quando cada mudança foi registrada.</p>
        </div>
        <button type="button" onClick={onNewMemory} className="btn btn--primary">
          <Plus size={16} aria-hidden="true" /> Registrar memória
        </button>
      </header>

      <section className="filters panel" aria-label="Recorte temporal">
        <label className="field">
          <span className="field__label">Como eu pensava em · as_of</span>
          <input className="input" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">O que era fato em · valid_at</span>
          <input className="input" type="date" value={validAt} onChange={(e) => setValidAt(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Domínio</span>
          <select className="input" value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)}>
            <option value="">Todos os domínios</option>
            <option value="career">Carreira</option>
            <option value="learning">Aprendizado</option>
            <option value="projects">Projetos</option>
            <option value="other">Outros</option>
          </select>
        </label>
        {filtersActive && (
          <button
            type="button"
            onClick={() => {
              setAsOf("");
              setValidAt("");
              setDomainFilter("");
            }}
            className="btn btn--quiet btn--danger filters__reset"
          >
            <RotateCcw size={14} aria-hidden="true" /> Limpar filtros
          </button>
        )}
      </section>

      {inspectError && (
        <div className="alert alert--error" role="alert">
          <AlertCircle size={16} aria-hidden="true" /> {inspectError}
        </div>
      )}

      <div className={`tl-layout${selectedClaim ? " has-detail" : ""}`}>
        <div>
          {loading ? (
            <div className="state">
              <SignalLoader label="Reconstruindo a linha do tempo…" />
            </div>
          ) : error ? (
            <div className="state">
              <div className="alert alert--error" role="alert">
                <AlertCircle size={16} aria-hidden="true" /> {error}
              </div>
              <button type="button" className="btn btn--ghost" onClick={fetchClaims}>
                Tentar de novo
              </button>
            </div>
          ) : claims.length === 0 ? (
            <div className="panel">
              <EmptyState
                title={filtersActive ? "Nada neste recorte" : "Nenhuma memória ainda"}
                text={
                  filtersActive
                    ? "Nenhum fato valia ou estava registrado nas datas escolhidas. Ajuste ou limpe os filtros."
                    : "Grave seu primeiro pensamento ou nota para alimentar seu Digital Twin."
                }
                action={
                  !filtersActive && (
                    <button type="button" onClick={onNewMemory} className="btn btn--primary">
                      <Plus size={16} aria-hidden="true" /> Criar primeira memória
                    </button>
                  )
                }
              />
            </div>
          ) : (
            <ol className="tl cascade" aria-label="Fatos registrados">
              {claims.map((c) => (
                <li key={c.id} className="tl__item">
                  <time className="tl__date" dateTime={c.recorded_at}>
                    {formatDate(c.recorded_at)}
                  </time>
                  <span className="tl__node" aria-hidden="true" />
                  <button
                    type="button"
                    className="tl__card"
                    data-claim={c.id}
                    onClick={() => handleInspectClaim(c.id)}
                    aria-pressed={selectedClaim?.id === c.id}
                  >
                    <span className="tl__tags">
                      <span className="badge badge--moon">{DOMAINS[c.domain] ?? c.domain}</span>
                      <span className="tl__subject">{c.subject_key}</span>
                    </span>
                    <span className="tl__statement">{sources.get(c.id) ?? (c.statement || "Sem versão correspondente no recorte temporal")}</span>
                    {sources.has(c.id) && c.statement && <span className="tl__extracted">Fato extraído · {c.statement}</span>}
                    {c.valid_from && <span className="tl__meta">Vale desde {formatDate(c.valid_from)}</span>}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>

        {selectedClaim && (
          <aside ref={detailRef} className="detail panel" aria-labelledby="claim-detail-title">
            <div className="detail__head">
              <div>
                <p className="kicker">Inspeção do fato</p>
                <h2 id="claim-detail-title" className="detail__title">
                  {selectedClaim.subject_key}
                </h2>
              </div>
              <button type="button" onClick={closeInspection} className="btn btn--quiet btn--icon btn--sm" aria-label="Fechar inspeção">
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <p className="field__label">Histórico de versões · {selectedClaim.versions.length}</p>
            <ol className="strata">
              {selectedClaim.versions.map((v) => (
                <li key={v.version_id} className={`version${v.superseded_at ? " version--superseded" : ""}`}>
                  <div className="version__head">
                    <span className="version__no">Versão {v.version_no}</span>
                    <span className={`badge ${v.superseded_at ? "badge--ember" : "badge--moon"}`}>{v.superseded_at ? "Substituída" : "Ativa"}</span>
                  </div>
                  <p className="version__statement">“{v.evidences.find((e) => e.quote)?.quote ?? v.statement}”</p>
                  {v.evidences.some((e) => e.quote) && <p className="version__extracted">Fato extraído · {v.statement}</p>}
                  {v.change_reason && <p className="version__reason">{v.change_reason}</p>}
                  <dl className="version__times">
                    <div>
                      <dt>Valia</dt>
                      <dd>
                        {formatDate(v.valid_from) ?? "Início"} → {formatDate(v.valid_to) ?? "Presente"}
                      </dd>
                    </div>
                    <div>
                      <dt>Registrada</dt>
                      <dd>{formatDate(v.recorded_at, true)}</dd>
                    </div>
                  </dl>
                  {v.evidences && v.evidences.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        onSelectCitation({
                          claim_id: selectedClaim.id,
                          kind: v.kind,
                          statement: v.statement,
                          quotes: v.evidences.map((e) => e.quote || "").filter(Boolean),
                          valid_from: v.valid_from,
                          valid_to: v.valid_to,
                        })
                      }
                      className="cite"
                    >
                      <span className="cite__index">{v.evidences.length}</span>
                      <span className="cite__text">Ver trecho original {v.evidences.length === 1 ? "citado" : "citados"}</span>
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </aside>
        )}
      </div>
    </div>
  );
};
