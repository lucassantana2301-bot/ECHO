import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { api } from "../services/api";
import type { ClaimListItem, EpisodeListItem } from "../services/api";
import { friendlyError } from "./format";
import { SignalLoader } from "./ui";
import { useClaimSources } from "../services/claimSources";

// Themes of the study track. Each one only shows memories that actually mention it.
const THEMES = [
  { key: "rust", title: "Rust", match: /\brust\b/i },
  { key: "backend", title: "Backend e arquitetura de sistemas", match: /backend|arquitetura|microsservi|serviços/i },
  { key: "performance", title: "Sistemas de alto desempenho", match: /alta performance|alto desempenho|baixa latência|concorrência/i },
  { key: "cloud", title: "Cloud e AWS", match: /\baws\b|cloud|nuvem/i },
  { key: "leadership", title: "Liderança técnica", match: /tech lead|lideran|principal architect/i },
];

// The demo account marks preparation milestones in the episode text itself.
const SIMULATED = /simula|em prepara|não obtid/i;
const CERT = /(AWS Certified [^().]+?)\s*(?:\(|\.|$)/i;

interface Milestone {
  id: string;
  name: string;
  simulated: boolean;
}

/**
 * Gives each station up to two facts without repeating a fact across stations.
 * Stations with fewer candidates choose first; a fact is only repeated when a
 * station would otherwise look empty even though it has memories.
 */
function assignFacts(claims: ClaimListItem[]) {
  const candidates = new Map(THEMES.map((t) => [t.key, claims.filter((c) => c.statement && t.match.test(c.statement))]));
  const used = new Set<string>();
  const assigned = new Map<string, ClaimListItem[]>();
  for (const theme of [...THEMES].sort((a, b) => candidates.get(a.key)!.length - candidates.get(b.key)!.length)) {
    const all = candidates.get(theme.key)!;
    const fresh = all.filter((c) => !used.has(c.id)).slice(0, 2);
    const picked = fresh.length ? fresh : all.slice(0, 1);
    picked.forEach((c) => used.add(c.id));
    assigned.set(theme.key, picked);
  }
  return assigned;
}

function milestonesFrom(episodes: EpisodeListItem[]): Milestone[] {
  const seen = new Set<string>();
  const out: Milestone[] = [];
  for (const ep of episodes) {
    const text = ep.content_preview ?? "";
    const name = text.match(CERT)?.[1]?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ id: ep.id, name, simulated: SIMULATED.test(text) });
  }
  return out;
}

interface StudyTrackProps {
  name: string;
  episodes: EpisodeListItem[];
}

/** Lucas's study track, rebuilt only from facts and episodes stored in the account. */
export function StudyTrack({ name, episodes }: StudyTrackProps) {
  const [claims, setClaims] = useState<ClaimListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.listClaims().then(
      (data) => active && setClaims(data),
      (err) => active && setError(friendlyError(err, "Não foi possível montar a trilha.")),
    );
    return () => {
      active = false;
    };
  }, []);

  const milestones = milestonesFrom(episodes);
  const byTheme = claims ? assignFacts(claims) : null;
  const sources = useClaimSources(claims?.map((c) => c.id) ?? []);

  return (
    <section className="track panel" aria-labelledby="track-title">
      <header className="track__head">
        <p className="kicker">Perfil de demonstração</p>
        <h2 id="track-title" className="track__name">
          {name}
        </h2>
        <p className="track__lead">Trilha de estudos reconstruída a partir das memórias registradas nesta conta.</p>
      </header>

      {error ? (
        <div className="alert alert--error" role="alert">
          <AlertCircle size={16} aria-hidden="true" /> {error}
        </div>
      ) : !claims ? (
        <SignalLoader label="Reconstruindo a trilha…" />
      ) : (
        <ol className="track__stations">
          {THEMES.map((theme) => {
            const facts = byTheme?.get(theme.key) ?? [];
            return (
              <li key={theme.key} className={`station${facts.length ? "" : " station--empty"}`}>
                <span className="station__node" aria-hidden="true" />
                <h3 className="station__title">{theme.title}</h3>
                {facts.length ? (
                  <ul className="station__facts">
                    {facts.map((f) => (
                      <li key={f.id}>{sources.get(f.id) ?? f.statement}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="station__none">Ainda sem memórias sobre isso nesta conta.</p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {milestones.length > 0 && (
        <div className="milestones">
          <h3 className="field__label">Marcos de AWS</h3>
          <ul>
            {milestones.map((m) => (
              <li key={m.id} className="milestone">
                <span className="milestone__name">{m.name}</span>
                <span className="milestone__status">{m.simulated ? "Simulado · em preparação — não obtido" : "Em estudo · status não registrado"}</span>
              </li>
            ))}
          </ul>
          <p className="field__hint">Marcos de demonstração sobre estudos em andamento. Não representam certificações obtidas.</p>
        </div>
      )}
    </section>
  );
}
