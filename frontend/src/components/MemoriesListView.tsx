import React, { useState, useEffect } from "react";
import { Brain, Plus, MessageSquare, FileText, Download, PenLine, AlertCircle } from "lucide-react";
import { api } from "../services/api";
import type { EpisodeListItem } from "../services/api";
import { StudyTrack } from "./StudyTrack";
import { EmptyState, SignalLoader } from "./ui";
import { formatDate, friendlyError } from "./format";

interface MemoriesListViewProps {
  onNewMemory: () => void;
  /** Shown as a study-track profile when the account is the demo profile. */
  profileName?: string;
}

const SOURCES: Record<string, { label: string; icon: typeof Brain }> = {
  chat: { label: "Conversa", icon: MessageSquare },
  note: { label: "Anotação", icon: FileText },
  import: { label: "Importação", icon: Download },
  correction: { label: "Correção", icon: PenLine },
};

const STATUS: Record<string, string> = {
  processed: "Processada",
  pending: "Na fila",
  processing: "Processando",
  failed: "Falhou",
};

export const MemoriesListView: React.FC<MemoriesListViewProps> = ({ onNewMemory, profileName }) => {
  const [episodes, setEpisodes] = useState<EpisodeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEpisodes = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listEpisodes();
      setEpisodes(data);
    } catch (err: any) {
      setError(friendlyError(err, "Não foi possível carregar suas memórias."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEpisodes();
  }, []);

  return (
    <div className="page page--narrow">
      <header className="page-head">
        <div>
          <p className="kicker">
            <span className="kicker__num">04</span> Base de memórias
          </p>
          <h1 className="page-title">
            Seus registros, <em>na origem.</em>
          </h1>
          <p className="lead">Todas as fontes originais — conversas, notas e importações — de onde os fatos foram extraídos.</p>
        </div>
        <button type="button" onClick={onNewMemory} className="btn btn--primary">
          <Plus size={16} aria-hidden="true" /> Nova memória
        </button>
      </header>

      {profileName && !loading && !error && <StudyTrack name={profileName} episodes={episodes} />}

      {loading ? (
        <div className="state">
          <SignalLoader label="Abrindo o arquivo de episódios…" />
        </div>
      ) : error ? (
        <div className="state">
          <div className="alert alert--error" role="alert">
            <AlertCircle size={16} aria-hidden="true" /> {error}
          </div>
          <button type="button" className="btn btn--ghost" onClick={fetchEpisodes}>
            Tentar de novo
          </button>
        </div>
      ) : episodes.length === 0 ? (
        <div className="panel">
          <EmptyState
            title="Nenhum episódio ainda"
            text="Crie sua primeira anotação ou conversa para que o ECHO extraia as conexões."
            action={
              <button type="button" onClick={onNewMemory} className="btn btn--primary">
                <Plus size={16} aria-hidden="true" /> Gravar primeira memória
              </button>
            }
          />
        </div>
      ) : (
        <ul className="archive cascade" aria-label="Episódios registrados">
          {episodes.map((ep) => {
            const source = SOURCES[ep.source_type] ?? { label: ep.source_type, icon: Brain };
            const Icon = source.icon;
            const processed = ep.processing_status === "processed";
            return (
              <li key={ep.id} className="entry">
                <span className="entry__icon" aria-hidden="true">
                  <Icon size={17} />
                </span>
                <div className="entry__body">
                  <div className="entry__meta">
                    <span className="badge badge--plain">{source.label}</span>
                    <time dateTime={ep.occurred_at}>{formatDate(ep.occurred_at, true)}</time>
                    <span className={`badge ${processed ? "badge--moon" : "badge--ember badge--pulse"} entry__status`}>
                      {STATUS[ep.processing_status] ?? ep.processing_status}
                    </span>
                  </div>
                  <blockquote className="entry__quote">{ep.content_preview ?? "Sem prévia disponível."}</blockquote>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
