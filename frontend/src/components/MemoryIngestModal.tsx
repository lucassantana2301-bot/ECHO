import React, { useState } from "react";
import { CheckCircle2, AlertCircle, Plus } from "lucide-react";
import { api } from "../services/api";
import { BrainGlyph, Dialog, SignalLoader } from "./ui";

interface MemoryIngestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const MemoryIngestModal: React.FC<MemoryIngestModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [content, setContent] = useState("");
  const [sourceType, setSourceType] = useState("chat");
  const [occurredAt, setOccurredAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || loading) return;

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      await api.createEpisode(content.trim(), sourceType, occurredAt ? new Date(occurredAt).toISOString() : undefined);

      setSuccessMsg("Memória registrada. O ECHO vai extrair os fatos e ligá-los à fonte.");
      setTimeout(() => {
        setContent("");
        setSuccessMsg(null);
        onSuccess();
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err.message || "Erro ao registrar memória.");
    } finally {
      setLoading(false);
    }
  };

  const sampleSuggestions = [
    "Comecei a estudar Rust semana passada para criar sistemas concorrentes e seguros.",
    "Decidi lançar o projeto HyperSync no segundo semestre de 2026.",
    "Mudei para Tóquio no mês passado e estou adorando a rotina.",
  ];

  return (
    <Dialog titleId="ingest-title" onClose={onClose} dismissOnBackdrop={!loading}>
      <div className="dialog__intro">
        <BrainGlyph className={`dialog__glyph${successMsg ? " is-formed" : ""}`} fragments />
        <div>
          <p className="kicker">
            <span className="kicker__num">+</span> Nova memória
          </p>
          <h2 id="ingest-title" className="dialog__title">
            O que vale <em>lembrar?</em>
          </h2>
          <p className="dialog__lead">Fatos, metas ou pensamentos. O texto original fica guardado como evidência.</p>
        </div>
      </div>

      {error && (
        <div className="alert alert--error" role="alert">
          <AlertCircle size={16} aria-hidden="true" /> {error}
        </div>
      )}
      {successMsg && (
        <div className="alert alert--success" role="status">
          <CheckCircle2 size={16} aria-hidden="true" /> {successMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="form">
        <label className="field">
          <span className="field__label">Conteúdo da memória</span>
          <textarea
            className="input"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Ex.: estou estudando Rust para desenvolver sistemas distribuídos…"
            rows={4}
            required
            disabled={loading}
            data-autofocus
          />
        </label>

        <div className="form__row">
          <label className="field">
            <span className="field__label">Tipo de fonte</span>
            <select className="input" value={sourceType} onChange={(e) => setSourceType(e.target.value)} disabled={loading}>
              <option value="chat">Conversa</option>
              <option value="note">Anotação</option>
              <option value="import">Importação</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Quando aconteceu · opcional</span>
            <input className="input" type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} disabled={loading} />
          </label>
        </div>

        <div className="field">
          <span className="field__label" id="ingest-suggestions">
            Exemplos para testar
          </span>
          <ul className="suggestions" aria-labelledby="ingest-suggestions">
            {sampleSuggestions.map((s, i) => (
              <li key={i}>
                <button type="button" className="chip" onClick={() => setContent(s)} disabled={loading}>
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="form__actions">
          {loading && <SignalLoader label="Registrando…" />}
          <button type="button" onClick={onClose} className="btn btn--ghost">
            Cancelar
          </button>
          <button type="submit" disabled={!content.trim() || loading} className="btn btn--primary">
            <Plus size={16} aria-hidden="true" /> Gravar memória
          </button>
        </div>
      </form>
    </Dialog>
  );
};
