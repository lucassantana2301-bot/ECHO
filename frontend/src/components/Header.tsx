import React, { useState } from "react";
import { LogOut, Brain, MessageSquare, Clock, Plus, Share2, Volume2, VolumeX, Home } from "lucide-react";
import type { UserProfile } from "../services/api";
import { soundEngine } from "../services/soundEngine";
import { EchoMark } from "./ui";

type Tab = "landing" | "chat" | "timeline" | "graph" | "memories";

interface HeaderProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  user: UserProfile | null;
  onOpenAuth: () => void;
  onLogout: () => void;
  providerMode: string;
  onNewMemory: () => void;
}

const NAV: { tab: Tab; label: string; short?: string; icon: typeof Home; needsAuth: boolean }[] = [
  { tab: "landing", label: "Início", icon: Home, needsAuth: false },
  { tab: "chat", label: "Diálogo", icon: MessageSquare, needsAuth: true },
  { tab: "timeline", label: "Linha do tempo", short: "Tempo", icon: Clock, needsAuth: true },
  { tab: "graph", label: "Grafo neural", short: "Grafo", icon: Share2, needsAuth: true },
  { tab: "memories", label: "Memórias", icon: Brain, needsAuth: true },
];

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab, user, onOpenAuth, onLogout, providerMode, onNewMemory }) => {
  const [isMuted, setIsMuted] = useState(soundEngine.getMuted());
  const live = providerMode.toLowerCase().includes("live");

  const handleToggleSound = () => {
    const muted = soundEngine.toggleMute();
    setIsMuted(muted);
    if (!muted) soundEngine.playSynapsePulse();
  };

  return (
    <header className="topbar">
      <div className="brand">
        <button
          type="button"
          onClick={() => {
            soundEngine.playSynapsePulse();
            setActiveTab("landing");
          }}
          aria-label="ECHO — voltar ao início"
        >
          <EchoMark />
        </button>
        <span className={`mode${live ? " mode--live" : ""}`} title={`Provedor de inteligência: ${providerMode.toUpperCase()}`}>
          {live ? "Live" : providerMode}
        </span>
      </div>

      <nav className="tabs-nav" aria-label="Seções do ECHO">
        <ul className="tabs">
          {NAV.map(({ tab, label, short, icon: Icon, needsAuth }) => (
            <li key={tab}>
              <button
                type="button"
                className="tab"
                aria-current={activeTab === tab ? "page" : undefined}
                onClick={() => {
                  soundEngine.playCitationClick();
                  if (needsAuth && !user) onOpenAuth();
                  else setActiveTab(tab);
                }}
              >
                <Icon size={16} aria-hidden="true" />
                {short ? (
                  <>
                    <span className="tab__label--long">{label}</span>
                    <span className="tab__label--short">{short}</span>
                  </>
                ) : (
                  <span>{label}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="topbar__actions">
        <button
          type="button"
          className="btn btn--quiet btn--icon"
          onClick={handleToggleSound}
          aria-pressed={!isMuted}
          aria-label={isMuted ? "Ativar som" : "Desativar som"}
          title={isMuted ? "Ativar som" : "Desativar som"}
        >
          {isMuted ? <VolumeX size={17} aria-hidden="true" /> : <Volume2 size={17} aria-hidden="true" />}
        </button>

        {user ? (
          <>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => {
                soundEngine.playCitationClick();
                onNewMemory();
              }}
              aria-label="Nova memória"
            >
              <Plus size={16} aria-hidden="true" />
              <span className="btn__label--wide">Nova memória</span>
            </button>

            <div className="user-chip">
              <span className="user-chip__avatar" aria-hidden="true">
                {(user.display_name || user.email).charAt(0).toUpperCase()}
              </span>
              <span className="user-chip__name">{user.display_name || user.email.split("@")[0]}</span>
              <button type="button" className="btn btn--quiet btn--icon btn--sm" onClick={onLogout} aria-label="Encerrar sessão" title="Encerrar sessão">
                <LogOut size={15} aria-hidden="true" />
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                soundEngine.playCitationClick();
                onOpenAuth();
              }}
            >
              Entrar
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm btn__label--wide"
              onClick={() => {
                soundEngine.playSynapsePulse();
                onOpenAuth();
              }}
            >
              Começar
            </button>
          </>
        )}
      </div>
    </header>
  );
};
