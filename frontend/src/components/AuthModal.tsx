import React, { useState } from "react";
import { Lock, Mail, User as UserIcon, AlertCircle, ArrowRight } from "lucide-react";
import { api } from "../services/api";
import type { UserProfile } from "../services/api";
import { BrainGlyph, Dialog, EchoMark } from "./ui";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (user: UserProfile) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onAuthSuccess }) => {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || loading) return;

    setLoading(true);
    setError(null);

    try {
      if (isRegister) {
        const res = await api.register(email, password, displayName || undefined);
        onAuthSuccess(res.user);
      } else {
        const res = await api.login(email, password);
        onAuthSuccess(res.user);
      }
      onClose();
    } catch (err: any) {
      setError(err.message || "Erro durante autenticação.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog titleId="auth-title" onClose={onClose} size="sm">
      <div className="auth__art" aria-hidden="true">
        <BrainGlyph className="auth__glyph" fragments />
        <EchoMark size={22} />
      </div>

      <h2 id="auth-title" className="dialog__title">
        {isRegister ? (
          <>
            Crie sua <em>memória.</em>
          </>
        ) : (
          <>
            Bem-vindo <em>de volta.</em>
          </>
        )}
      </h2>
      <p className="dialog__lead">
        {isRegister ? "Conecte suas memórias em um espaço seguro e isolado." : "Entre para conversar com seu Digital Twin e explorar sua linha do tempo."}
      </p>

      {error && (
        <div className="alert alert--error" role="alert" id="auth-error">
          <AlertCircle size={16} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="form">
        {isRegister && (
          <label className="field">
            <span className="field__label">Seu nome ou apelido</span>
            <span className="input-icon">
              <UserIcon size={16} aria-hidden="true" />
              <input className="input" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Seu nome" autoComplete="name" />
            </span>
          </label>
        )}

        <label className="field">
          <span className="field__label">Email</span>
          <span className="input-icon">
            <Mail size={16} aria-hidden="true" />
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu.email@exemplo.com"
              required
              autoComplete="email"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "auth-error" : undefined}
              data-autofocus
            />
          </span>
        </label>

        <label className="field">
          <span className="field__label">Senha</span>
          <span className="input-icon">
            <Lock size={16} aria-hidden="true" />
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete={isRegister ? "new-password" : "current-password"}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "auth-error" : undefined}
            />
          </span>
        </label>

        <button type="submit" disabled={loading} className="btn btn--primary auth__submit">
          {loading ? "Processando…" : isRegister ? "Criar conta" : "Entrar"}
          {!loading && <ArrowRight size={16} aria-hidden="true" />}
        </button>
      </form>

      <p className="auth__switch">
        {isRegister ? "Já possui conta?" : "Não tem uma conta?"}{" "}
        <button
          type="button"
          onClick={() => {
            setIsRegister(!isRegister);
            setError(null);
          }}
        >
          {isRegister ? "Entrar" : "Criar cadastro"}
        </button>
      </p>
    </Dialog>
  );
};
