import React, { useRef } from "react";
import { X, ShieldCheck } from "lucide-react";
import type { CitationDetail } from "../services/api";
import { formatDate } from "./format";
import { useFocusTrap } from "./useFocusTrap";

interface EvidenceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  citation: CitationDetail | null;
}

export const EvidenceDrawer: React.FC<EvidenceDrawerProps> = ({ isOpen, onClose, citation }) => {
  if (!isOpen || !citation) return null;
  return <EvidencePanel citation={citation} onClose={onClose} />;
};

function EvidencePanel({ citation, onClose }: { citation: CitationDetail; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useFocusTrap(ref, onClose);
  const quotes = citation.quotes && citation.quotes.length > 0 ? citation.quotes : [citation.statement];

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside ref={ref} className="drawer" role="dialog" aria-modal="true" aria-labelledby="evidence-title" tabIndex={-1}>
        <div className="drawer__head">
          <p className="kicker">
            <ShieldCheck size={15} aria-hidden="true" /> Evidência
          </p>
          <button type="button" onClick={onClose} className="btn btn--quiet btn--icon btn--sm" aria-label="Fechar evidência">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* The person's own words lead; the extracted fact can read awkwardly, so it comes second. */}
        <section className="drawer__section">
          <h3 className="field__label">Trecho original da memória</h3>
          <h2 id="evidence-title" className="drawer__statement">
            “{quotes[0]}”
          </h2>
          {quotes.slice(1).map((quote, idx) => (
            <blockquote key={idx} className="excerpt">
              {quote}
            </blockquote>
          ))}
          {citation.quotes && citation.quotes.length > 0 && <p className="drawer__extracted">Fato extraído · {citation.statement}</p>}
          <div className="drawer__tags">
            <span className="badge badge--plain">{citation.kind}</span>
            <span className="drawer__id" title={citation.claim_id}>
              {citation.claim_id.slice(0, 13)}…
            </span>
          </div>
        </section>

        <section className="drawer__section">
          <h3 className="field__label">Validade no tempo</h3>
          <div className="span-rail" aria-hidden="true">
            <span className="span-rail__start" />
            <span className={`span-rail__line${citation.valid_to ? "" : " is-open"}`} />
            <span className={`span-rail__end${citation.valid_to ? "" : " is-open"}`} />
          </div>
          <dl className="drawer__times">
            <div>
              <dt>Vale a partir de</dt>
              <dd>{formatDate(citation.valid_from) ?? "Início dos registros"}</dd>
            </div>
            <div>
              <dt>Vale até</dt>
              <dd className={citation.valid_to ? "is-closed" : "is-open"}>{formatDate(citation.valid_to) ?? "Presente · ativo"}</dd>
            </div>
          </dl>
        </section>

        <p className="drawer__note">
          Esta resposta foi conferida em código contra as claims recuperadas no banco de dados. O trecho acima é a fonte que a sustenta.
        </p>
      </aside>
    </>
  );
}
