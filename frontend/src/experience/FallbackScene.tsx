import { useMemo, type CSSProperties } from "react";
import { buildArbor } from "./arbor";
import { brainOutline } from "./brain";
import { computeDrift, MOSAIC_COLS, MOSAIC_ROWS, TILE_COUNT } from "./recall";

interface FallbackSceneProps {
  chapter: number;
  fireId: number;
  trace: number;
  recalls: number;
  anchored: boolean;
  photoUrl: string;
  hidden: boolean;
  onHidden?: () => void;
}

const SIGNAL_SPEED = 10; // time units per second, same as the 3D wave

export function FallbackScene({ chapter, fireId, trace, recalls, anchored, photoUrl, hidden, onHidden }: FallbackSceneProps) {
  const drawing = useMemo(() => {
    const arbor = buildArbor({ quality: "low" });
    const silhouette = brainOutline();
    const outline = "M" + silhouette.map(([x, y]) => `${x.toFixed(2)} ${(-y).toFixed(2)}`).join("L") + "Z";
    const xs = silhouette.map((p) => p[0]);
    const ys = silhouette.map((p) => p[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const pad = 0.6;
    const viewBox = `${minX - pad} ${-maxY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
    const paths = arbor.branches.map((b) => ({
      d: "M" + b.points.map((p) => `${p[0].toFixed(2)} ${(-p[1]).toFixed(2)}`).join("L"),
      width: Math.max(0.012, (b.radii[0] + b.radii[b.radii.length - 1]) * 0.9),
      delay: b.times[0] / SIGNAL_SPEED,
      engram: b.engram,
      layer: b.layer,
    }));
    const somas = arbor.somas.map((s) => ({ x: s.pos[0], y: -s.pos[1], r: s.radius, delay: s.time / SIGNAL_SPEED }));
    return { viewBox, outline, paths, somas };
  }, []);

  const drift = useMemo(() => computeDrift(recalls), [recalls]);

  return (
    <div
      className={`ex-fallback${hidden ? " is-hidden" : ""}`}
      data-chapter={chapter}
      style={{ "--trace": trace } as CSSProperties}
      onTransitionEnd={(e) => {
        if (hidden && e.target === e.currentTarget) onHidden?.();
      }}
    >
      <svg className="ex-fallback__arbor" viewBox={drawing.viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path className="ex-fallback__outline" d={drawing.outline} />
        <g className="ex-fallback__base">
          {drawing.paths.map((p, i) => (
            <path key={i} d={p.d} strokeWidth={p.width} className={`l${p.layer}${p.engram ? " is-engram" : ""}`} />
          ))}
          {drawing.somas.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} />
          ))}
        </g>
        {fireId > 0 && (
          <g key={fireId} className="ex-fallback__wave">
            {drawing.paths.map((p, i) => (
              <path key={i} d={p.d} strokeWidth={p.width * 1.6} style={{ animationDelay: `${p.delay.toFixed(2)}s` }} />
            ))}
            {drawing.somas.map((s, i) => (
              <circle key={i} cx={s.x} cy={s.y} r={s.r * 1.4} style={{ animationDelay: `${s.delay.toFixed(2)}s` }} />
            ))}
          </g>
        )}
      </svg>

      {chapter >= 3 && (
        <div className="ex-fallback__mosaic" aria-hidden="true">
          {Array.from({ length: TILE_COUNT }, (_, i) => {
            const col = i % MOSAIC_COLS;
            const row = Math.floor(i / MOSAIC_COLS);
            const keep = anchored ? 0 : 1;
            const srcCol = col + drift.swapX[i] * keep;
            const srcRow = row + drift.swapY[i] * keep;
            const t = drift.tint[i] * keep;
            return (
              <span
                key={i}
                style={{
                  left: `${(col / MOSAIC_COLS) * 100}%`,
                  bottom: `${(row / MOSAIC_ROWS) * 100}%`,
                  backgroundImage: `url(${photoUrl})`,
                  backgroundPosition: `${(srcCol / (MOSAIC_COLS - 1)) * 100}% ${((MOSAIC_ROWS - 1 - srcRow) / (MOSAIC_ROWS - 1)) * 100}%`,
                  transform: `translate(${(drift.dx[i] * keep * 100).toFixed(1)}%, ${(-drift.dy[i] * keep * 100).toFixed(1)}%) rotate(${(drift.rot[i] * keep).toFixed(3)}rad)`,
                  filter: t > 0 ? `grayscale(${t.toFixed(2)}) sepia(${(t * 0.45).toFixed(2)}) brightness(${(1 - t * 0.15).toFixed(2)})` : undefined,
                  outline: anchored ? "1px solid rgba(169, 193, 209, 0.35)" : undefined,
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
