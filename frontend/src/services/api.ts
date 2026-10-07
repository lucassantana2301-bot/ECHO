/**
 * API Service for ECHO Digital Twin.
 * Seamless communication with FastAPI backend.
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

/** Matches the backend `UserResponse` returned by /auth/me and token endpoints. */
export interface UserProfile {
  id: string;
  email: string;
  display_name: string | null;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user?: UserProfile | null;
}

export interface AuthResponse {
  token: string;
  user: UserProfile;
}

export interface CitationDetail {
  claim_id: string;
  kind: string;
  statement: string;
  quotes: string[];
  valid_from: string | null;
  valid_to: string | null;
}

export interface RetrieveResponse {
  answer: string;
  cited_claim_ids: string[];
  citations: CitationDetail[];
  reasoning_steps?: string[];
  provider_mode: string;
  pipeline_version: string;
}

export interface GraphNode {
  id: string;
  label: string;
  group: "user" | "domain" | "entity" | "claim";
  importance: number;
  domain: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  weight: number;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface EpisodeListItem {
  id: string;
  source_type: "chat" | "note" | "import" | "correction";
  content_preview: string | null;
  occurred_at: string;
  recorded_at: string;
  processing_status: string;
}

export interface EvidenceDetail {
  link_id: string;
  episode_id: string;
  quote: string | null;
  span_start: number | null;
  span_end: number | null;
  source_type: string | null;
  occurred_at: string | null;
  confidence: number | null;
  stance: string;
}

export interface ClaimVersionDetail {
  version_id: string;
  version_no: number;
  kind: string;
  statement: string;
  attributes: Record<string, any>;
  status: string;
  origin: string;
  change_reason: string;
  importance: number;
  sensitivity: string;
  valid_from: string | null;
  valid_to: string | null;
  recorded_at: string;
  superseded_at: string | null;
  pipeline_version: string;
  provider_mode: string;
  evidences: EvidenceDetail[];
}

export interface ClaimDetail {
  id: string;
  subject_key: string;
  domain: string;
  recorded_at: string;
  current_version: ClaimVersionDetail | null;
  versions: ClaimVersionDetail[];
}

export interface ClaimListItem {
  id: string;
  subject_key: string;
  domain: string;
  recorded_at: string;
  statement: string | null;
  kind: string | null;
  valid_from: string | null;
  valid_to: string | null;
  status: string | null;
  importance: number | null;
}

export interface HealthResponse {
  status: string;
  version: string;
  mode: string;
}

/** HTTP error from the backend; network failures stay plain `Error`s. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

class ApiClient {
  private token: string | null = null;

  constructor() {
    this.token = localStorage.getItem("echo_auth_token");
  }

  public setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem("echo_auth_token", token);
    } else {
      localStorage.removeItem("echo_auth_token");
    }
  }

  public getToken(): string | null {
    return this.token;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let errorMsg = `Erro ${response.status}: ${response.statusText}`;
      try {
        const errorJson = await response.json();
        if (errorJson.detail) {
          errorMsg = typeof errorJson.detail === "string" ? errorJson.detail : JSON.stringify(errorJson.detail);
        }
      } catch {}
      throw new ApiError(errorMsg, response.status);
    }

    return response.json();
  }

  // Health
  public async getHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health");
  }

  // Auth
  public async register(email: string, password: string, displayName?: string): Promise<AuthResponse> {
    await this.request<UserProfile>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, display_name: displayName }),
    });
    // Auto-login after registration
    return this.login(email, password);
  }

  public async login(email: string, password: string): Promise<AuthResponse> {
    const res = await this.request<TokenResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    this.setToken(res.access_token);
    const user = await this.getMe();
    return { token: res.access_token, user };
  }

  /** Isolated demo account; the backend only allows it in demo provider mode (403 otherwise). */
  public async startDemoSession(): Promise<AuthResponse> {
    const res = await this.request<TokenResponse>("/auth/demo-session", { method: "POST" });
    this.setToken(res.access_token);
    try {
      const user = res.user ?? (await this.getMe());
      return { token: res.access_token, user };
    } catch (err) {
      this.setToken(null);
      throw err;
    }
  }

  public async getMe(): Promise<UserProfile> {
    return this.request<UserProfile>("/auth/me");
  }

  public logout() {
    this.setToken(null);
  }

  // Retrieval / Chat
  public async retrieve(params: {
    question: string;
    purpose?: "answer" | "self_review" | "context_preview";
    as_of?: string | null;
    valid_at?: string | null;
    limit?: number;
  }): Promise<RetrieveResponse> {
    return this.request<RetrieveResponse>("/retrieve", {
      method: "POST",
      body: JSON.stringify({
        question: params.question,
        purpose: params.purpose || "answer",
        as_of: params.as_of || null,
        valid_at: params.valid_at || null,
        limit: params.limit || 10,
      }),
    });
  }

  // Episodes
  public async createEpisode(content: string, sourceType: string = "chat", occurredAt?: string): Promise<any> {
    return this.request<any>("/episodes", {
      method: "POST",
      body: JSON.stringify({
        content,
        source_type: sourceType,
        occurred_at: occurredAt || null,
      }),
    });
  }

  public async listEpisodes(limit: number = 50): Promise<EpisodeListItem[]> {
    return this.request<EpisodeListItem[]>(`/episodes?limit=${limit}`);
  }

  // Claims & Timeline
  public async listClaims(filters?: {
    as_of?: string | null;
    valid_at?: string | null;
    domain?: string | null;
  }): Promise<ClaimListItem[]> {
    const params = new URLSearchParams();
    if (filters?.as_of) params.append("as_of", filters.as_of);
    if (filters?.valid_at) params.append("valid_at", filters.valid_at);
    if (filters?.domain) params.append("domain", filters.domain);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request<ClaimListItem[]>(`/claims${qs}`);
  }

  public async getClaimDetail(claimId: string): Promise<ClaimDetail> {
    return this.request<ClaimDetail>(`/claims/${claimId}`);
  }

  // Knowledge Graph
  public async getKnowledgeGraph(): Promise<GraphResponse> {
    return this.request<GraphResponse>("/claims/graph/network");
  }
}

export const api = new ApiClient();

