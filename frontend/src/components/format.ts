import { ApiError } from "../services/api";

/**
 * The backend records instants in UTC; SQLite returns them without an offset.
 * Read offset-less timestamps as UTC instead of the browser's local time.
 */
export const parseApiDate = (iso: string) => new Date(/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(iso) || !iso.includes("T") ? iso : `${iso}Z`);

export const formatDate = (iso: string | null | undefined, withTime = false) =>
  iso ? parseApiDate(iso).toLocaleString("pt-BR", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }) : null;

/** Turns low-level failures into a message a person can act on. */
export const friendlyError = (err: unknown, fallback: string) => {
  if (err instanceof ApiError && err.status === 401) {
    return "Sua sessão expirou ou não é mais válida. Recarregue a página para abrir uma nova sessão.";
  }
  const message = err instanceof Error ? err.message : "";
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Não foi possível falar com o servidor do ECHO. Verifique a conexão e tente de novo.";
  }
  return message || fallback;
};

/**
 * A failed claim-detail request. A backend crash arrives without CORS headers and is
 * indistinguishable from a network failure in the browser, so the message stays neutral.
 */
export const detailError = (err: unknown) =>
  err instanceof ApiError && err.status === 401
    ? friendlyError(err, "")
    : "Não foi possível abrir os detalhes deste fato agora. Tente de novo em instantes.";

/** Replaces raw claim ids like "[2f98a671-…]" in an answer with the evidence number shown below it. */
export const numberCitations = (text: string, citations?: { claim_id: string }[]) => {
  if (!citations?.length) return text;
  return text.replace(/\s?\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi, (match, id: string) => {
    const index = citations.findIndex((c) => c.claim_id.toLowerCase() === id.toLowerCase());
    return index >= 0 ? ` [${index + 1}]` : match;
  });
};
