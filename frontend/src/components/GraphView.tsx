import React, { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Pause, Play, X, AlertCircle, Sparkles } from "lucide-react";
import { api } from "../services/api";
import type { GraphNode, GraphEdge } from "../services/api";
import { soundEngine } from "../services/soundEngine";
import type { GraphScene } from "../experience/GraphScene";
import { BrainGlyph, EmptyState, SignalLoader } from "./ui";
import { friendlyError, parseApiDate } from "./format";
import { useClaimSources } from "../services/claimSources";

interface GraphViewProps {
  onSelectClaim?: (claimId: string) => void;
  /** A memory was just recorded: reveal the newest fact once the scene is ready. */
  revealLatest?: boolean;
  onRevealed?: () => void;
}

const GROUP_LABEL: Record<GraphNode["group"], string> = {
  user: "Twin core",
  domain: "Domínio",
  claim: "Memória atômica",
  entity: "Entidade",
};

const DOMAIN_LABEL: Record<string, string> = {
  career: "Carreira",
  learning: "Aprendizado",
  projects: "Projetos",
  other: "Outros",
};

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const GraphView: React.FC<GraphViewProps> = ({ onSelectClaim, revealLatest, onRevealed }) => {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [sceneMode, setSceneMode] = useState<"loading" | "webgl" | "fallback">("loading");
  const [rotating, setRotating] = useState(() => !reducedMotion());
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealNote, setRevealNote] = useState<string | null>(null);
  const [statements, setStatements] = useState<Map<string, string>>(new Map());
  const sources = useClaimSources(nodes.filter((n) => n.group === "claim").map((n) => n.id));

  const stageRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GraphScene | null>(null);
  const pickRef = useRef<(id: string) => void>(() => {});

  const loadGraph = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getKnowledgeGraph();
      setNodes(data.nodes);
      setEdges(data.edges);
      // Graph labels are truncated by the API; the full statement comes from /claims.
      api.listClaims().then(
        (claims) => setStatements(new Map(claims.filter((c) => c.statement).map((c) => [c.id, c.statement as string]))),
        () => {},
      );
    } catch (err) {
      setError(friendlyError(err, "Não foi possível carregar o grafo."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGraph();
  }, []);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const pick = (id: string) => {
    const node = byId.get(id);
    if (!node) return;
    setSelectedNode(node);
    soundEngine.playSynapsePulse();
    if (node.group === "claim" && onSelectClaim) onSelectClaim(node.id);
  };

  useEffect(() => {
    pickRef.current = pick;
  });

  useEffect(() => {
    const stage = stageRef.current;
    const labels = labelsRef.current;
    if (!stage || !labels || nodes.length === 0) return;
    let scene: GraphScene | null = null;
    let cancelled = false;
    import("../experience/GraphScene")
      .then(({ GraphScene }) => {
        if (cancelled) return;
        scene = new GraphScene({
          container: stage,
          labels,
          nodes,
          edges,
          reducedMotion: reducedMotion(),
          onHover: setHoveredId,
          onPick: (id) => pickRef.current(id),
          onContextLost: () => {
            scene?.dispose();
            sceneRef.current = null;
            setSceneMode("fallback");
          },
        });
        sceneRef.current = scene;
        setSceneMode("webgl");
      })
      .catch(() => {
        if (!cancelled) setSceneMode("fallback");
      });
    return () => {
      cancelled = true;
      scene?.dispose();
      sceneRef.current = null;
    };
  }, [nodes, edges]);

  useEffect(() => sceneRef.current?.setSelected(selectedNode?.id ?? null), [selectedNode, sceneMode]);
  useEffect(() => sceneRef.current?.setAutoRotate(rotating), [rotating, sceneMode]);

  /**
   * Reveals the fact extracted from the most recent memory. Facts are recorded after the
   * episode they come from, so only facts newer than that episode qualify; if the memory
   * produced no fact, say so instead of highlighting an older one.
   */
  const revealNewest = async () => {
    try {
      const [episodes, claims] = await Promise.all([api.listEpisodes(), api.listClaims()]);
      const time = (iso: string) => parseApiDate(iso).getTime();
      const latestEpisode = episodes.reduce<number>((max, ep) => Math.max(max, time(ep.recorded_at)), 0);
      const fresh = claims
        .filter((c) => byId.has(c.id) && time(c.recorded_at) >= latestEpisode)
        .sort((a, b) => time(b.recorded_at) - time(a.recorded_at))[0];
      if (!fresh) {
        setRevealed(null);
        setRevealNote("A memória mais recente foi guardada, mas ainda não gerou um fato no grafo. Ela continua em Memórias.");
        return;
      }
      const node = byId.get(fresh.id)!;
      setRevealNote(null);
      sceneRef.current?.reveal(fresh.id);
      setSelectedNode(node);
      setRevealed(node.label);
      soundEngine.playMemoryFormed();
    } catch (err) {
      setRevealNote(friendlyError(err, "Não foi possível revelar a memória."));
    }
  };

  const revealRef = useRef(revealNewest);
  useEffect(() => {
    revealRef.current = revealNewest;
  });

  useEffect(() => {
    if (!revealLatest || sceneMode !== "webgl") return;
    // Let the brain settle on screen before the memory arrives.
    const t = window.setTimeout(() => {
      revealRef.current();
      onRevealed?.();
    }, 900);
    return () => window.clearTimeout(t);
  }, [revealLatest, sceneMode, onRevealed]);

  const groups = useMemo(() => {
    const map = new Map<string, GraphNode[]>();
    for (const n of nodes) {
      const key = n.group === "user" ? "" : n.domain || "other";
      map.set(key, [...(map.get(key) ?? []), n]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [nodes]);

  const labelled = nodes.filter((n) => n.group === "user" || n.group === "domain" || n.id === hoveredId || n.id === selectedNode?.id);

  return (
    <div className="page graph-page">
      <header className="page-head">
        <div>
          <p className="kicker">
            <span className="kicker__num">03</span> Grafo neural
          </p>
          <h1 className="page-title">
            A topologia da <em>sua memória.</em>
          </h1>
          <p className="lead">
            Fatos, domínios e entidades dispostos dentro de um cérebro. Cada domínio ocupa uma região; selecione um nó para ver o sinal correr pelas
            conexões.
          </p>
        </div>
        <div className="page-actions">
          {nodes.length > 0 && !loading && (
            <button type="button" className="btn btn--primary btn--sm" onClick={revealNewest}>
              <Sparkles size={15} aria-hidden="true" /> Revelar memória mais recente
            </button>
          )}
          {sceneMode === "webgl" && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRotating(!rotating)} aria-pressed={!rotating}>
              {rotating ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
              {rotating ? "Pausar rotação" : "Girar"}
            </button>
          )}
          <button type="button" onClick={loadGraph} className="btn btn--ghost btn--sm" disabled={loading}>
            <RefreshCw size={15} aria-hidden="true" /> Atualizar grafo
          </button>
        </div>
      </header>

      <p className="sr-only" aria-live="polite">
        {revealed ? `Memória mais recente revelada no grafo: ${revealed}` : ""}
      </p>
      {revealNote && (
        <p className="graph__note" role="status">
          {revealNote}
        </p>
      )}

      {loading ? (
        <div className="state">
          <SignalLoader label="Projetando a rede de memórias…" />
        </div>
      ) : error ? (
        <div className="state">
          <div className="alert alert--error" role="alert">
            <AlertCircle size={16} aria-hidden="true" /> {error}
          </div>
          <button type="button" className="btn btn--ghost" onClick={loadGraph}>
            Tentar de novo
          </button>
        </div>
      ) : nodes.length === 0 ? (
        <div className="panel">
          <EmptyState title="O grafo ainda está vazio" text="Cadastre sua primeira memória para ver as sinapses ganharem vida." />
        </div>
      ) : (
        <div className="graph">
          <div className="graph__stage panel">
            <div ref={stageRef} className="graph__canvas" />
            {sceneMode !== "webgl" && (
              <div className="graph__poster">
                <BrainGlyph className="graph__glyph" fragments />
                {sceneMode === "fallback" ? (
                  <p>A visualização 3D não está disponível neste dispositivo. Todos os nós estão na lista ao lado.</p>
                ) : (
                  <SignalLoader label="Montando o cérebro…" />
                )}
              </div>
            )}
            <div ref={labelsRef} className="graph__labels" aria-hidden="true">
              {sceneMode === "webgl" &&
                labelled.map((n) => (
                  <span key={n.id} data-node={n.id} className={`graph__label graph__label--${n.group}`}>
                    <span>{n.group === "domain" ? (DOMAIN_LABEL[n.label] ?? n.label) : n.label}</span>
                  </span>
                ))}
            </div>

            <ul className="graph__legend" aria-label="Legenda">
              {(Object.keys(GROUP_LABEL) as GraphNode["group"][]).map((g) => (
                <li key={g}>
                  <span className={`dot dot--${g}`} aria-hidden="true" /> {GROUP_LABEL[g]}
                </li>
              ))}
            </ul>

            {selectedNode && (
              <section className="graph__detail" aria-labelledby="node-title" aria-live="polite">
                <div className="graph__detail-head">
                  <span className="graph__detail-tags">
                    <span className="badge badge--plain">{GROUP_LABEL[selectedNode.group]}</span>
                    {revealed === selectedNode.label && <span className="badge badge--ember">Memória mais recente</span>}
                  </span>
                  <button type="button" onClick={() => setSelectedNode(null)} className="btn btn--quiet btn--icon btn--sm" aria-label="Limpar seleção">
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
                <h2 id="node-title" className="graph__detail-title">
                  {sources.get(selectedNode.id) ?? statements.get(selectedNode.id) ?? (selectedNode.group === "domain" ? (DOMAIN_LABEL[selectedNode.label] ?? selectedNode.label) : selectedNode.label)}
                </h2>
                {sources.has(selectedNode.id) && statements.get(selectedNode.id) && <p className="graph__extracted">Fato extraído · {statements.get(selectedNode.id)}</p>}
                <p className="field__hint">
                  Domínio: <strong>{DOMAIN_LABEL[selectedNode.domain] ?? selectedNode.domain}</strong>
                </p>
                {selectedNode.group === "claim" && onSelectClaim && (
                  <button type="button" onClick={() => onSelectClaim(selectedNode.id)} className="btn btn--primary btn--sm graph__detail-cta">
                    Ver evidências e versões
                  </button>
                )}
              </section>
            )}
          </div>

          <nav className="graph__index panel" aria-label="Nós do grafo">
            <p className="field__label">Todos os nós · {nodes.length}</p>
            {groups.map(([domain, items]) => (
              <div key={domain || "core"} className="graph__group">
                {domain && <h3 className="graph__group-title">{DOMAIN_LABEL[domain] ?? domain}</h3>}
                <ul>
                  {items.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        className="graph__node"
                        aria-pressed={selectedNode?.id === n.id}
                        onClick={() => pick(n.id)}
                        onMouseEnter={() => sceneRef.current && setHoveredId(n.id)}
                        onMouseLeave={() => setHoveredId(null)}
                      >
                        <span className={`dot dot--${n.group}`} aria-hidden="true" />
                        <span className="graph__node-label">{n.group === "domain" ? (DOMAIN_LABEL[n.label] ?? n.label) : (sources.get(n.id) ?? n.label)}</span>
                        <span className="sr-only">, {GROUP_LABEL[n.group]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      )}
    </div>
  );
};
