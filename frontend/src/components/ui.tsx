import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { brainOutline } from "../experience/brain";
import { useFocusTrap } from "./useFocusTrap";

const outline = brainOutline(72);
const xs = outline.map((p) => p[0]);
const ys = outline.map((p) => p[1]);
const minX = Math.min(...xs);
const maxY = Math.max(...ys);
const BRAIN_VIEWBOX = `${(minX - 0.5).toFixed(2)} ${(-maxY - 0.5).toFixed(2)} ${(Math.max(...xs) - minX + 1).toFixed(2)} ${(maxY - Math.min(...ys) + 1).toFixed(2)}`;
const BRAIN_PATH = "M" + outline.map(([x, y]) => `${x.toFixed(2)} ${(-y).toFixed(2)}`).join("L") + "Z";

/** Side-view silhouette of the same procedural brain used in the 3D scenes. */
export function BrainGlyph({ className, fragments = false }: { className?: string; fragments?: boolean }) {
  return (
    <svg className={className} viewBox={BRAIN_VIEWBOX} aria-hidden="true" focusable="false">
      <path d={BRAIN_PATH} />
      {fragments && (
        <>
          <circle cx="-2.4" cy="-2.6" r="0.32" />
          <circle cx="1.8" cy="-1.2" r="0.26" />
          <circle cx="-0.2" cy="0.8" r="0.22" />
        </>
      )}
    </svg>
  );
}

export function EchoMark({ size = 26 }: { size?: number }) {
  return (
    <span className="brand__mark" style={{ fontSize: size }}>
      <span>ECHO</span>
      <span aria-hidden="true">ECHO</span>
      <span aria-hidden="true">ECHO</span>
    </span>
  );
}

export function SignalLoader({ label }: { label: string }) {
  return (
    <div className="signal" role="status">
      <span className="signal__axon" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="state">
      <BrainGlyph className="state__art" fragments />
      <h3 className="state__title">{title}</h3>
      <p className="state__text">{text}</p>
      {action}
    </div>
  );
}

interface DialogProps {
  titleId: string;
  onClose: () => void;
  size?: "sm" | "md";
  dismissOnBackdrop?: boolean;
  children: ReactNode;
}

export function Dialog({ titleId, onClose, size = "md", dismissOnBackdrop = true, children }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onClose);
  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={ref} className={`dialog${size === "sm" ? " dialog--sm" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <button type="button" className="btn btn--quiet btn--icon btn--sm dialog__close" onClick={onClose} aria-label="Fechar">
          <X size={18} aria-hidden="true" />
        </button>
        {children}
      </div>
    </div>
  );
}

