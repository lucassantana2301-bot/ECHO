import React, { useState, useRef, useEffect } from "react";
import { ArrowUp, Clock, ChevronDown, Copy, Check, AlertCircle } from "lucide-react";
import { api } from "../services/api";
import type { CitationDetail, RetrieveResponse } from "../services/api";
import { soundEngine } from "../services/soundEngine";
import { SignalLoader } from "./ui";
import { friendlyError, numberCitations } from "./format";

interface Message {
  id: string;
  sender: "user" | "twin";
  text: string;
  citations?: CitationDetail[];
  reasoningSteps?: string[];
  providerMode?: string;
  timestamp: Date;
}

interface ChatViewProps {
  onSelectCitation: (citation: CitationDetail) => void;
  onNewMemory?: () => void;
  userName?: string;
}

export const ChatView: React.FC<ChatViewProps> = ({ onSelectCitation, userName }) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      sender: "twin",
      text: "Olá! Sou o núcleo cognitivo do seu Digital Twin. Toda resposta é fundamentada no seu histórico, com citações das evidências que você pode abrir e conferir. O que você gostaria de explorar ou recordar hoje?",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedReasoning, setExpandedReasoning] = useState<Record<string, boolean>>({});

  // Bitemporal query filters
  const [showTemporalFilters, setShowTemporalFilters] = useState(false);
  const [asOfDate, setAsOfDate] = useState<string>("");
  const [validAtDate, setValidAtDate] = useState<string>("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const filtersActive = Boolean(asOfDate || validAtDate);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  const toggleReasoning = (id: string) => {
    setExpandedReasoning((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    soundEngine.playCitationClick();
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSend = async (questionText?: string) => {
    const q = questionText || input;
    if (!q.trim() || loading) return;

    soundEngine.playSynapsePulse();

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      sender: "user",
      text: q.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!questionText) setInput("");
    setLoading(true);

    try {
      const res: RetrieveResponse = await api.retrieve({
        question: q.trim(),
        as_of: asOfDate ? new Date(asOfDate).toISOString() : null,
        valid_at: validAtDate ? new Date(validAtDate).toISOString() : null,
      });

      const twinMsgId = `twin-${Date.now()}`;
      const twinMsg: Message = {
        id: twinMsgId,
        sender: "twin",
        text: res.answer,
        citations: res.citations || [],
        reasoningSteps: res.reasoning_steps || [],
        providerMode: res.provider_mode,
        timestamp: new Date(),
      };

      // Automatically expand reasoning for transparency
      setExpandedReasoning((prev) => ({ ...prev, [twinMsgId]: true }));
      setMessages((prev) => [...prev, twinMsg]);
      soundEngine.playMemoryFormed();
    } catch (err) {
      const errorMsg: Message = {
        id: `error-${Date.now()}`,
        sender: "twin",
        text: friendlyError(err, "Ocorreu um erro ao recuperar memórias."),
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const starterPrompts = [
    "Qual linguagem de programação estou estudando?",
    "Quais são meus objetivos e metas atuais?",
    "Como estão meus estudos de AWS?",
    "Quais projetos estou desenvolvendo?",
  ];

  return (
    <div className="chat">
      <div className="chat__head">
        <div>
          <p className="kicker">
            <span className="kicker__num">01</span> Diálogo{userName ? ` · ${userName}` : ""}
          </p>
          <h1 className="chat__title">
            Pergunte à sua <em>memória.</em>
          </h1>
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setShowTemporalFilters(!showTemporalFilters)}
          aria-expanded={showTemporalFilters}
          aria-controls="chat-temporal"
        >
          <Clock size={15} aria-hidden="true" />
          Recorte no tempo
          {filtersActive && <span className="badge badge--ember">ativo</span>}
        </button>
      </div>

      {showTemporalFilters && (
        <div id="chat-temporal" className="chat__time panel">
          <p className="field__hint chat__time-intro">
            O ECHO guarda dois tempos para cada fato. Responda como se fosse uma data passada:
          </p>
          <label className="field">
            <span className="field__label">Como eu pensava em · as_of</span>
            <input className="input" type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
            <span className="field__hint">Usa só o que estava registrado até essa data.</span>
          </label>
          <label className="field">
            <span className="field__label">O que era fato em · valid_at</span>
            <input className="input" type="date" value={validAtDate} onChange={(e) => setValidAtDate(e.target.value)} />
            <span className="field__hint">Usa só o que valia no mundo nessa data.</span>
          </label>
          {filtersActive && (
            <button
              type="button"
              className="btn btn--quiet btn--danger btn--sm chat__time-clear"
              onClick={() => {
                setAsOfDate("");
                setValidAtDate("");
              }}
            >
              Limpar recorte
            </button>
          )}
        </div>
      )}

      <div className="chat__log" role="log" aria-label="Conversa com o Digital Twin" aria-live="polite">
        {messages.map((msg) => {
          const isError = msg.id.startsWith("error-");
          return (
            <article key={msg.id} className={`msg msg--${msg.sender}${isError ? " msg--error" : ""}`}>
              {msg.sender === "twin" && (
                <span className="msg__avatar" aria-hidden="true">
                  {isError ? <AlertCircle size={16} /> : <span className="msg__neuron" />}
                </span>
              )}

              <div className="msg__body">
                <h2 className="sr-only">{msg.sender === "user" ? "Você" : "Digital Twin"}</h2>

                {msg.reasoningSteps && msg.reasoningSteps.length > 0 && (
                  <div className="reasoning">
                    <button
                      type="button"
                      className="reasoning__toggle"
                      onClick={() => toggleReasoning(msg.id)}
                      aria-expanded={!!expandedReasoning[msg.id]}
                    >
                      <span>
                        Trajeto do raciocínio <span className="reasoning__count">{msg.reasoningSteps.length} etapas</span>
                      </span>
                      <ChevronDown size={15} aria-hidden="true" />
                    </button>
                    {expandedReasoning[msg.id] && (
                      <ol className="reasoning__steps">
                        {msg.reasoningSteps.map((step, idx) => (
                          <li key={idx}>{step}</li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}

                <div className="msg__text">{numberCitations(msg.text, msg.citations)}</div>

                {msg.citations && msg.citations.length > 0 && (
                  <div className="msg__cites">
                    <span className="field__label">Evidências</span>
                    <ul>
                      {msg.citations.map((c, i) => (
                        <li key={i}>
                          <button
                            type="button"
                            className="cite"
                            onClick={() => {
                              soundEngine.playCitationClick();
                              onSelectCitation(c);
                            }}
                            title="Abrir a evidência e o trecho original"
                          >
                            <span className="cite__index">{i + 1}</span>
                            <span className="cite__text">{c.quotes?.find(Boolean) ?? c.statement}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="msg__meta">
                  <time dateTime={msg.timestamp.toISOString()}>
                    {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </time>
                  {msg.sender === "twin" && !isError && (
                    <button type="button" className="btn btn--quiet btn--sm msg__copy" onClick={() => copyToClipboard(msg.text, msg.id)}>
                      {copiedId === msg.id ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                      {copiedId === msg.id ? "Copiado" : "Copiar"}
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}

        {loading && (
          <article className="msg msg--twin">
            <span className="msg__avatar is-thinking" aria-hidden="true">
              <span className="msg__neuron" />
            </span>
            <div className="msg__body">
              <SignalLoader label="Percorrendo suas memórias no tempo…" />
            </div>
          </article>
        )}

        <div ref={messagesEndRef} />
      </div>

      {messages.length <= 2 && (
        <ul className="chat__prompts" aria-label="Sugestões de perguntas">
          {starterPrompts.map((prompt, i) => (
            <li key={i}>
              <button type="button" className="chip" onClick={() => handleSend(prompt)} disabled={loading}>
                {prompt}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <label htmlFor="chat-input" className="sr-only">
          Pergunta para o Digital Twin
        </label>
        <input
          id="chat-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pergunte algo sobre você — ex.: o que estou estudando?"
          disabled={loading}
          autoComplete="off"
        />
        <button type="submit" className="btn btn--primary btn--icon" disabled={!input.trim() || loading} aria-label="Enviar pergunta">
          <ArrowUp size={18} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
};
