import { api, ApiError, type UserProfile } from "./api";

export type SessionResult =
  | { kind: "authenticated"; user: UserProfile; mode: string | null }
  | { kind: "anonymous"; mode: string | null }
  | { kind: "offline"; mode: null }
  | { kind: "demo-failed"; mode: string | null; error: unknown };

let initial: Promise<SessionResult> | null = null;

/**
 * Resolves the session once per page load. React StrictMode runs mount effects
 * twice in development; sharing the promise keeps /auth/me, /health and
 * /auth/demo-session from being called twice.
 */
export function resolveInitialSession(): Promise<SessionResult> {
  initial ??= resolve();
  return initial;
}

/** Runs the whole resolution again, e.g. after the backend was unreachable. */
export function retryInitialSession(): Promise<SessionResult> {
  initial = resolve();
  return initial;
}

async function resolve(): Promise<SessionResult> {
  const mode = api.getHealth().then(
    (h) => h.mode ?? null,
    () => null,
  );

  if (api.getToken()) {
    try {
      const user = await api.getMe();
      return { kind: "authenticated", user, mode: await mode };
    } catch (err) {
      // Only a rejected token is discarded; an unreachable backend keeps it for later.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) api.logout();
    }
  }

  const currentMode = await mode;
  if (currentMode === null) return { kind: "offline", mode: null };
  if (currentMode !== "demo") return { kind: "anonymous", mode: currentMode };
  return startDemoSession();
}

export async function startDemoSession(): Promise<SessionResult> {
  try {
    const { user } = await api.startDemoSession();
    return { kind: "authenticated", user, mode: "demo" };
  } catch (error) {
    return { kind: "demo-failed", mode: "demo", error };
  }
}
