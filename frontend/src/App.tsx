import { useState, useEffect, useCallback } from "react";
import { AlertCircle } from "lucide-react";
import { Header } from "./components/Header";
import { ChatView } from "./components/ChatView";
import { GraphView } from "./components/GraphView";
import { TimelineView } from "./components/TimelineView";
import { MemoriesListView } from "./components/MemoriesListView";
import { EvidenceDrawer } from "./components/EvidenceDrawer";
import { MemoryIngestModal } from "./components/MemoryIngestModal";
import { AuthModal } from "./components/AuthModal";
import { SessionGate, type GateState } from "./components/SessionGate";
import { BrainGlyph } from "./components/ui";
import { detailError } from "./components/format";
import { EchoExperience } from "./experience/EchoExperience";
import { api } from "./services/api";
import type { CitationDetail, UserProfile } from "./services/api";
import { resolveInitialSession, retryInitialSession, startDemoSession, type SessionResult } from "./services/session";

type SessionState = GateState | { status: "ready" };

export function App() {
  const [activeTab, setActiveTab] = useState<"landing" | "chat" | "timeline" | "graph" | "memories">("landing");
  const [user, setUser] = useState<UserProfile | null>(null);
  const [providerMode, setProviderMode] = useState<string | null>(null);
  const [session, setSession] = useState<SessionState>({ status: "checking" });
  // Bumped after a new memory is recorded so the open view refetches.
  const [dataVersion, setDataVersion] = useState(0);

  // Modals & Drawers State
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isIngestOpen, setIsIngestOpen] = useState(false);
  const [selectedCitation, setSelectedCitation] = useState<CitationDetail | null>(null);
  const [isEvidenceOpen, setIsEvidenceOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Set when a memory is recorded, so the 3D graph plays its arrival the next time it is shown.
  const [pendingReveal, setPendingReveal] = useState(false);
  const clearPendingReveal = useCallback(() => setPendingReveal(false), []);

  const applySession = (result: SessionResult) => {
    setProviderMode(result.mode);
    if (result.kind === "authenticated") {
      setUser(result.user);
      setActiveTab("chat");
      setSession({ status: "ready" });
    } else if (result.kind === "offline") {
      setSession({ status: "offline" });
    } else if (result.kind === "demo-failed") {
      setSession({ status: "demo-failed", error: result.error });
    } else {
      setSession({ status: "ready" });
    }
  };

  // Initial load: restore a saved session, or open the demo session when the backend runs in demo mode.
  useEffect(() => {
    let active = true;
    resolveInitialSession().then((result) => {
      if (active) applySession(result);
    });
    return () => {
      active = false;
    };
  }, []);

  const retrySession = () => {
    setSession({ status: "checking" });
    retryInitialSession().then(applySession);
  };

  const openDemoSession = () => {
    setSession({ status: "checking" });
    startDemoSession().then(applySession);
  };

  const handleOpenCitation = (citation: CitationDetail) => {
    setSelectedCitation(citation);
    setIsEvidenceOpen(true);
  };

  const handleOpenCitationFromClaimId = async (claimId: string) => {
    try {
      const detail = await api.getClaimDetail(claimId);
      const activeV = detail.current_version || (detail.versions.length > 0 ? detail.versions[0] : null);
      if (activeV) {
        setSelectedCitation({
          claim_id: detail.id,
          kind: activeV.kind,
          statement: activeV.statement,
          quotes: activeV.evidences.map((e) => e.quote).filter(Boolean) as string[],
          valid_from: activeV.valid_from,
          valid_to: activeV.valid_to,
        });
        setIsEvidenceOpen(true);
      }
    } catch (err) {
      setNotice(detailError(err));
    }
  };

  const handleStart = () => {
    if (user) setActiveTab("chat");
    else if (providerMode === "demo") openDemoSession();
    else setIsAuthOpen(true);
  };

  if (session.status !== "ready") {
    return (
      <div className="app">
        <SessionGate
          state={session}
          onRetry={session.status === "offline" ? retrySession : openDemoSession}
          onLogin={() => setIsAuthOpen(true)}
          onSkip={() => {
            setActiveTab("landing");
            setSession({ status: "ready" });
          }}
        />
        <AuthModal
          isOpen={isAuthOpen}
          onClose={() => setIsAuthOpen(false)}
          onAuthSuccess={(loggedInUser) => {
            setUser(loggedInUser);
            setActiveTab("chat");
            setSession({ status: "ready" });
          }}
        />
      </div>
    );
  }

  return (
    <div className="app">
      {activeTab !== "landing" && (
        <div className="app-ambient" aria-hidden="true">
          <BrainGlyph />
        </div>
      )}

      {/* Top Header */}
      {activeTab !== "landing" && (
        <Header
          activeTab={activeTab}
          setActiveTab={(tab) => setActiveTab(tab)}
          user={user}
          onOpenAuth={() => setIsAuthOpen(true)}
          onLogout={() => {
            api.logout();
            setUser(null);
            setActiveTab("landing");
          }}
          providerMode={providerMode ?? "offline"}
          onNewMemory={() => setIsIngestOpen(true)}
        />
      )}

      {/* Main View Router */}
      <main className={`app-main${activeTab !== "landing" ? " app-main--inner" : ""}`}>
        {activeTab === "landing" && (
          <EchoExperience
            isSignedIn={!!user}
            onEnter={handleStart}
            onOpenTimeline={() => setActiveTab("timeline")}
          />
        )}

        {activeTab === "chat" && (
          <ChatView
            onSelectCitation={handleOpenCitation}
            onNewMemory={() => setIsIngestOpen(true)}
            userName={user?.display_name ?? undefined}
          />
        )}

        {activeTab === "timeline" && (
          <TimelineView
            key={dataVersion}
            onSelectCitation={handleOpenCitation}
            onNewMemory={() => setIsIngestOpen(true)}
          />
        )}

        {activeTab === "graph" && (
          <GraphView
            key={dataVersion}
            onSelectClaim={handleOpenCitationFromClaimId}
            revealLatest={pendingReveal}
            onRevealed={clearPendingReveal}
          />
        )}

        {activeTab === "memories" && (
          <MemoriesListView
            key={dataVersion}
            onNewMemory={() => setIsIngestOpen(true)}
            profileName={providerMode === "demo" ? (user?.display_name ?? undefined) : undefined}
          />
        )}
      </main>

      {/* Slide-over Evidence Drawer */}
      <EvidenceDrawer
        isOpen={isEvidenceOpen}
        onClose={() => setIsEvidenceOpen(false)}
        citation={selectedCitation}
      />

      {/* Memory Ingestion Modal */}
      <MemoryIngestModal
        isOpen={isIngestOpen}
        onClose={() => setIsIngestOpen(false)}
        onSuccess={() => {
          setDataVersion((v) => v + 1);
          setPendingReveal(true);
          if (activeTab === "landing") {
            setActiveTab("timeline");
          }
        }}
      />

      {/* Authentication Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onAuthSuccess={(loggedInUser) => {
          setUser(loggedInUser);
          setActiveTab("chat");
        }}
      />

      {notice && (
        <div className="toast alert alert--error" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span>{notice}</span>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setNotice(null)}>
            Fechar
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
