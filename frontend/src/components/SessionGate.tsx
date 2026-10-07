import { AlertCircle, RotateCcw } from "lucide-react";
import { friendlyError } from "./format";
import { BrainGlyph, EchoMark, SignalLoader } from "./ui";

export type GateState = { status: "checking" } | { status: "offline" } | { status: "demo-failed"; error: unknown };

interface SessionGateProps {
  state: GateState;
  onRetry: () => void;
  onLogin: () => void;
  onSkip: () => void;
}

/** Shown while the session is resolved, or when it could not be opened. */
export function SessionGate({ state, onRetry, onLogin, onSkip }: SessionGateProps) {
  if (state.status === "checking") {
    return (
      <main className="gate" aria-busy="true">
        <BrainGlyph className="gate__glyph" fragments />
        <EchoMark />
        <SignalLoader label="Abrindo sua sessão…" />
      </main>
    );
  }

  const offline = state.status === "offline";
  return (
    <main className="gate">
      <BrainGlyph className="gate__glyph" fragments />
      <EchoMark />
      <h1 className="gate__title">
        {offline ? (
          <>
            O servidor do ECHO <em>não respondeu.</em>
          </>
        ) : (
          <>
            Não foi possível abrir <em>a demonstração.</em>
          </>
        )}
      </h1>
      <div className="alert alert--error" role="alert">
        <AlertCircle size={16} aria-hidden="true" />
        <span>
          {offline
            ? "Não foi possível falar com o servidor do ECHO. Verifique a conexão ou se o servidor está no ar."
            : friendlyError(state.error, "A sessão de demonstração não pôde ser criada.")}
        </span>
      </div>
      <p className="gate__text">
        {offline
          ? "Se você já tinha uma sessão, ela continua guardada neste navegador e volta assim que o servidor responder."
          : "Você ainda não está conectado. Tente de novo ou entre com uma conta."}
      </p>
      <div className="gate__actions">
        <button type="button" className="btn btn--primary" onClick={onRetry}>
          <RotateCcw size={16} aria-hidden="true" /> Tentar novamente
        </button>
        {!offline && (
          <button type="button" className="btn btn--ghost" onClick={onLogin}>
            Entrar com uma conta
          </button>
        )}
        <button type="button" className="btn btn--quiet" onClick={onSkip}>
          Ver a experiência
        </button>
      </div>
    </main>
  );
}
