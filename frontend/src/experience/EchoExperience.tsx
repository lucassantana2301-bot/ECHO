import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, Pause, Play, Volume2, VolumeX } from "lucide-react";
import photoUrl from "../assets/memory-echo.jpg";
import { soundEngine } from "../services/soundEngine";
import { CHAPTERS, EVIDENCE_LABEL, MAX_RECALLS, MAX_TRACE, SOURCES } from "./content";
import { FallbackScene } from "./FallbackScene";
import type { MindScene } from "./MindScene";
import "./experience.css";

type Mode = "loading" | "webgl" | "fallback";

interface EchoExperienceProps {
  isSignedIn: boolean;
  onEnter: () => void;
  onOpenTimeline: () => void;
}

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function EchoExperience({ isSignedIn, onEnter, onOpenTimeline }: EchoExperienceProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const railARef = useRef<HTMLSpanElement>(null);
  const railBRef = useRef<HTMLSpanElement>(null);
  const sceneRef = useRef<MindScene | null>(null);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);

  const [reduced] = useState(prefersReducedMotion);
  const [mode, setMode] = useState<Mode>("loading");
  const [posterGone, setPosterGone] = useState(false);
  const [chapter, setChapter] = useState(0);
  const [fireId, setFireId] = useState(0);
  const [trace, setTrace] = useState(0);
  const [recalls, setRecalls] = useState(0);
  const [anchored, setAnchored] = useState(false);
  const [paused, setPaused] = useState(reduced);
  const [muted, setMuted] = useState(soundEngine.getMuted());
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !railARef.current || !railBRef.current) return;
    const railLabels: [HTMLElement, HTMLElement] = [railARef.current, railBRef.current];
    let scene: MindScene | null = null;
    let cancelled = false;
    import("./MindScene")
      .then(({ MindScene }) => {
        if (cancelled) return;
        scene = new MindScene({
          container: stage,
          photoUrl,
          reducedMotion: reduced,
          railLabels,
          onReady: () => setMode("webgl"),
          onContextLost: () => {
            scene?.dispose();
            sceneRef.current = null;
            setMode("fallback");
            setPosterGone(false);
          },
        });
        sceneRef.current = scene;
      })
      .catch(() => {
        if (!cancelled) setMode("fallback");
      });
    return () => {
      cancelled = true;
      scene?.dispose();
      sceneRef.current = null;
    };
  }, [reduced]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = sectionRefs.current.indexOf(entry.target as HTMLElement);
          if (index < 0) continue;
          setChapter(index);
          // Arriving at the last chapter without having recalled leaves nothing to compare.
          if (index === 4) setRecalls((r) => r || 3);
        }
      },
      { rootMargin: "-50% 0px -50% 0px" },
    );
    sectionRefs.current.forEach((s) => s && observer.observe(s));
    return () => observer.disconnect();
  }, []);

  useEffect(() => sceneRef.current?.setChapter(chapter), [chapter, mode]);

  useEffect(() => sceneRef.current?.setTrace(trace / MAX_TRACE), [trace, mode]);
  useEffect(() => sceneRef.current?.setRecalls(recalls), [recalls, mode]);
  useEffect(() => sceneRef.current?.setAnchored(anchored), [anchored, mode]);
  useEffect(() => sceneRef.current?.setPaused(paused), [paused, mode]);

  useEffect(() => {
    if (reduced) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      sceneRef.current?.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [reduced]);

  const fire = useCallback(() => {
    sceneRef.current?.fire();
    setFireId((n) => n + 1);
    soundEngine.playSynapsePulse();
    if (chapter === 2) {
      const next = Math.min(MAX_TRACE, trace + 1);
      setTrace(next);
      setAnnouncement(
        next === MAX_TRACE
          ? "Traço consolidado: o caminho repetido agora se destaca do resto da rede."
          : `Sinal repetido. Força do traço: ${next} de ${MAX_TRACE}.`,
      );
    } else {
      setAnnouncement("Sinal disparado: a luz converge para o corpo da célula e segue pelo axônio até outras células.");
    }
  }, [chapter, trace]);

  const recall = () => {
    const next = Math.min(MAX_RECALLS, recalls + 1);
    setRecalls(next);
    setAnchored(false);
    soundEngine.playCitationClick();
    setAnnouncement(`Recordação ${next} de ${MAX_RECALLS}: alguns fragmentos se deslocaram, trocaram de lugar ou perderam a cor.`);
  };

  const scrollToChapter = (index: number) => {
    sectionRefs.current[index]?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };

  const toggleSound = () => {
    const next = soundEngine.toggleMute();
    setMuted(next);
    if (!next) soundEngine.playSynapsePulse();
  };

  const stageArmed = chapter <= 2;
  const enterLabel = isSignedIn ? "Abrir o ECHO" : "Entrar no ECHO";

  const renderInteraction = (index: number) => {
    switch (index) {
      case 0:
        return (
          <div className="ex-actions">
            <button type="button" className="ex-btn ex-btn--primary" onClick={() => scrollToChapter(1)}>
              Atravessar <ArrowDown size={16} aria-hidden="true" />
            </button>
            <button type="button" className="ex-btn ex-btn--ghost" onClick={onEnter}>
              {enterLabel}
            </button>
          </div>
        );
      case 1:
        return (
          <div className="ex-actions">
            <button type="button" className="ex-btn ex-btn--primary" onClick={fire}>
              <span className="ex-spark" aria-hidden="true" /> Disparar um sinal
            </button>
            <span className="ex-hint">ou toque na paisagem</span>
          </div>
        );
      case 2:
        return (
          <div className="ex-actions ex-actions--stack">
            <div className="ex-actions">
              <button type="button" className="ex-btn ex-btn--primary" onClick={fire}>
                <span className="ex-spark" aria-hidden="true" /> {trace >= MAX_TRACE ? "Disparar de novo" : "Repetir o sinal"}
              </button>
              {trace > 0 && (
                <button type="button" className="ex-btn ex-btn--ghost" onClick={() => setTrace(0)}>
                  Apagar o traço
                </button>
              )}
            </div>
            <div className="ex-meter" role="meter" aria-label="Força do traço" aria-valuemin={0} aria-valuemax={MAX_TRACE} aria-valuenow={trace}>
              {Array.from({ length: MAX_TRACE }, (_, i) => (
                <span key={i} className={i < trace ? "is-on" : undefined} />
              ))}
              <span className="ex-meter__label">
                Força do traço · {trace}/{MAX_TRACE}
              </span>
            </div>
          </div>
        );
      case 3:
        return (
          <div className="ex-actions">
            <button type="button" className="ex-btn ex-btn--primary" onClick={recall} disabled={recalls >= MAX_RECALLS}>
              {recalls === 0 ? "Recordar" : recalls >= MAX_RECALLS ? "Lembrança desgastada" : "Recordar de novo"}
              <span className="ex-count">
                {recalls}/{MAX_RECALLS}
              </span>
            </button>
            {recalls > 0 && (
              <button
                type="button"
                className="ex-btn ex-btn--ghost"
                onClick={() => {
                  setRecalls(0);
                  setAnnouncement("De volta à primeira lembrança.");
                }}
              >
                Voltar à primeira vez
              </button>
            )}
          </div>
        );
      default:
        return (
          <>
            <div className="ex-toggle" role="group" aria-label="Comparar lembrança e registro">
              <button type="button" aria-pressed={!anchored} onClick={() => setAnchored(false)}>
                Lembrança humana
              </button>
              <button
                type="button"
                aria-pressed={anchored}
                onClick={() => {
                  setAnchored(true);
                  soundEngine.playMemoryFormed();
                  setAnnouncement("Registro ECHO: cada fragmento volta ao lugar original, preso à fonte e a duas linhas do tempo.");
                }}
              >
                Registro ECHO
              </button>
            </div>
            <dl className="ex-legend">
              <div>
                <dt>
                  <span className="ex-swatch ex-swatch--thread" aria-hidden="true" /> Fio
                </dt>
                <dd>liga cada fragmento ao trecho de onde veio</dd>
              </div>
              <div>
                <dt>
                  <span className="ex-swatch ex-swatch--rail" aria-hidden="true" /> Duas linhas
                </dt>
                <dd>quando o fato valia e quando foi registrado</dd>
              </div>
            </dl>
            <div className="ex-actions">
              <button type="button" className="ex-btn ex-btn--primary" onClick={onEnter}>
                {enterLabel}
              </button>
              {isSignedIn && (
                <button type="button" className="ex-btn ex-btn--ghost" onClick={onOpenTimeline}>
                  Ver minha linha do tempo
                </button>
              )}
            </div>
          </>
        );
    }
  };

  return (
    <div className="ex" data-chapter={chapter} data-mode={mode}>
      <div
        className={`ex-stage${stageArmed ? " is-armed" : ""}`}
        ref={stageRef}
        onClick={stageArmed ? fire : undefined}
        aria-hidden="true"
      >
        {(mode !== "webgl" || !posterGone) && (
          <FallbackScene
            chapter={chapter}
            fireId={fireId}
            trace={trace / MAX_TRACE}
            recalls={recalls}
            anchored={anchored}
            photoUrl={photoUrl}
            hidden={mode === "webgl"}
            onHidden={() => setPosterGone(true)}
          />
        )}
        <span className="ex-rail-label" ref={railARef}>
          <span>quando valia</span>
        </span>
        <span className="ex-rail-label" ref={railBRef}>
          <span>quando foi registrado</span>
        </span>
      </div>
      <div className="ex-veil" aria-hidden="true" />

      <header className="ex-top">
        <button type="button" className="ex-mark" onClick={() => scrollToChapter(0)} aria-label="ECHO — voltar ao início">
          <span>ECHO</span>
          <span aria-hidden="true">ECHO</span>
          <span aria-hidden="true">ECHO</span>
        </button>
        <div className="ex-top__controls">
          <button
            type="button"
            className="ex-icon-btn"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            title={paused ? "Retomar movimento" : "Pausar movimento"}
          >
            {paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
            <span className="ex-icon-btn__label">{paused ? "Retomar movimento" : "Pausar movimento"}</span>
          </button>
          <button
            type="button"
            className="ex-icon-btn"
            onClick={toggleSound}
            aria-pressed={!muted}
            title={muted ? "Ativar som" : "Desativar som"}
          >
            {muted ? <VolumeX size={15} aria-hidden="true" /> : <Volume2 size={15} aria-hidden="true" />}
            <span className="ex-icon-btn__label">{muted ? "Som desligado" : "Som ligado"}</span>
          </button>
          <button type="button" className="ex-btn ex-btn--small" onClick={onEnter}>
            {enterLabel}
          </button>
        </div>
      </header>

      <nav className="ex-index" aria-label="Capítulos">
        <ol>
          {CHAPTERS.map((c, i) => (
            <li key={c.id}>
              <button type="button" aria-current={chapter === i ? "step" : undefined} onClick={() => scrollToChapter(i)}>
                <span className="ex-index__num">{c.number}</span>
                <span className="ex-index__label">{c.navLabel}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {CHAPTERS.map((c, i) => {
        const Heading = i === 0 ? "h1" : "h2";
        return (
          <section
            key={c.id}
            id={`capitulo-${c.id}`}
            className={`ex-chapter${chapter === i ? " is-active" : ""}`}
            ref={(el) => {
              sectionRefs.current[i] = el;
            }}
            aria-labelledby={`titulo-${c.id}`}
          >
            <div className="ex-panel">
              <p className="ex-kicker">
                <span className="ex-kicker__num">{c.number}</span>
                {c.kicker}
              </p>
              <Heading id={`titulo-${c.id}`} className={`ex-title${i === 0 ? " ex-title--hero" : ""}`}>
                {c.title} <em>{c.titleAccent}</em>
              </Heading>
              <p className="ex-lead">{c.lead}</p>
              {renderInteraction(i)}
              {c.claims.length > 0 && (
                <ul className="ex-claims">
                  {c.claims.map((claim, k) => (
                    <li key={k}>
                      <span className={`ex-badge ex-badge--${claim.level}`}>
                        {EVIDENCE_LABEL[claim.level]}
                      </span>
                      <span>
                        {claim.text}
                        {claim.sources.map((s) => (
                          <a key={s} className="ex-ref" href={`#fonte-${s + 1}`} aria-label={`Fonte ${s + 1}`}>
                            {s + 1}
                          </a>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="ex-note">{c.sceneNote}</p>
            </div>
            {i === 0 && (
              <p className="ex-scroll-cue" aria-hidden="true">
                <span>role para atravessar</span>
              </p>
            )}
          </section>
        );
      })}

      <footer className="ex-footer" id="fontes">
        <div className="ex-footer__inner">
          <h2>Fontes e notas</h2>
          <p>
            As formas da cena são metáforas visuais inspiradas no cérebro e em neurônios, e não representações anatômicas. Os textos simplificam
            a ciência; cada afirmação indica se é consenso, mecanismo candidato ou pesquisa em andamento.
          </p>
          <ol>
            {SOURCES.map((s, i) => (
              <li key={i} id={`fonte-${i + 1}`}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.label}
                  </a>
                ) : (
                  s.label
                )}
              </li>
            ))}
          </ol>
          <p className="ex-footer__credit">Imagem da memória: renderização 3D original, feita para esta experiência a partir do mesmo modelo procedural do cérebro.</p>
        </div>
      </footer>

      <p className="ex-sr" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
