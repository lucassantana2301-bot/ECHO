import hashlib
import re
import unicodedata

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_WORD = re.compile(r"\w+", re.UNICODE)

STOPWORDS = {
    # pt
    "que", "qual", "quais", "como", "para", "por", "com", "uma", "uns", "umas", "dos", "das",
    "nos", "nas", "meu", "minha", "meus", "minhas", "sou", "estou", "isso", "esse", "essa",
    "sobre", "mais", "menos", "quando", "onde", "porque", "voce", "você", "ele", "ela", "eu",
    # en
    "the", "and", "for", "with", "what", "which", "how", "about", "are", "was", "were", "is",
    "my", "mine", "you", "your", "this", "that", "when", "where", "why", "who", "does", "did",
}


def strip_accents(value: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", value) if not unicodedata.combining(c)
    )


def slugify(value: str, max_len: int = 80) -> str:
    slug = _NON_ALNUM.sub("-", strip_accents(value).casefold()).strip("-")
    return slug[:max_len].rstrip("-") or "unknown"


def normalize_for_hash(value: str) -> str:
    return " ".join(value.split()).casefold()


def content_hash(value: str) -> str:
    return hashlib.sha256(normalize_for_hash(value).encode("utf-8")).hexdigest()


def query_terms(query: str, min_len: int = 3, max_terms: int = 24) -> list[str]:
    """Lowercased word tokens suitable for an OR tsquery (only \\w characters survive)."""
    seen: list[str] = []
    for token in _WORD.findall(query.casefold()):
        if len(token) < min_len or token in STOPWORDS or token.isdigit() and len(token) < 4:
            continue
        if token not in seen:
            seen.append(token)
        if len(seen) >= max_terms:
            break
    return seen


def tokens_for_embedding(value: str) -> list[str]:
    return [
        t
        for t in (strip_accents(w) for w in _WORD.findall(value.casefold()))
        if len(t) >= 2 and t not in STOPWORDS
    ]
