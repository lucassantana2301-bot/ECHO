"""Deterministic DEMO providers.

These run without credentials for tests and exploration. They perform real,
reproducible computation (regex rules, feature hashing) but they are NOT an AI
model and every artifact they produce is labelled ``provider_mode="demo"``.

Known, intentional limits: PT/EN surface patterns only; no inferences; values
are matched by normalized string equality.
"""

import hashlib
import math
import re
from dataclasses import dataclass
from datetime import UTC, datetime

from echo.core.text import slugify, tokens_for_embedding
from echo.domain import ClaimKind, Domain, Sensitivity
from echo.providers.base import AnswerDraft, ContextItem, ExtractionOutput

MONTHS = {
    "janeiro": 1, "fevereiro": 2, "março": 3, "marco": 3, "abril": 4, "maio": 5, "junho": 6,
    "julho": 7, "agosto": 8, "setembro": 9, "outubro": 10, "novembro": 11, "dezembro": 12,
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6, "july": 7,
    "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}
_MONTH_ALT = "|".join(sorted(MONTHS, key=len, reverse=True))
TEMPORAL_RE = re.compile(
    rf"\b(?:em|desde|a partir de|in|since)\s+(?P<month>{_MONTH_ALT})"
    rf"(?:\s+(?:de\s+)?(?P<year>\d{{4}}))?\b",
    re.IGNORECASE,
)
CHANGE_RE = re.compile(
    r"\b(?:mudei|mudou|troquei|agora|não quero mais|nao quero mais|deixei de|"
    r"changed|switched|now|no longer|anymore)\b",
    re.IGNORECASE,
)
SENSITIVE_RE = re.compile(
    r"\b(?:salário|salario|salary|saúde|saude|health|terapia|therapy|diagnóstico|"
    r"diagnostico|diagnosis|dívida|divida|debt)\b",
    re.IGNORECASE,
)
_SENTENCE_RE = re.compile(r"[^.!?\n]+[.!?]?")
_CUT_RE = re.compile(
    r"\s*(?:[,;:()]|\s-\s|\b(?:porque|pois|because|mas|but|e agora|and now)\b)", re.IGNORECASE
)
_V = r"(?P<v>[^.!?;\n]+)"


@dataclass(frozen=True)
class Rule:
    name: str
    kind: ClaimKind
    family: str
    single_valued: bool
    domain: Domain
    entity_kind: str
    confidence: float
    importance: float
    polarity: str
    labels: dict[str, str]
    patterns: tuple[tuple[str, re.Pattern[str]], ...]


def _p(regex: str) -> re.Pattern[str]:
    return re.compile(regex, re.IGNORECASE)


RULES: tuple[Rule, ...] = (
    Rule(
        "goal", ClaimKind.GOAL, "goal", True, Domain.CAREER, "topic", 0.7, 0.8, "positive",
        {"pt": "Objetivo de carreira", "en": "Career goal"},
        (
            ("pt", _p(r"\b(?:meu objetivo(?: agora)? é|minha meta(?: agora)? é|quero me tornar|"
                      r"quero virar)\s+(?:me tornar\s+|ser\s+)?" + _V)),
            ("en", _p(r"\b(?:my goal(?: now)? is|i want to become)\s+(?:to become\s+|to\s+)?" + _V)),
        ),
    ),
    Rule(
        "role", ClaimKind.EXPLICIT_STATEMENT, "role", True, Domain.CAREER, "role", 0.7, 0.6,
        "positive", {"pt": "Função atual", "en": "Current role"},
        (
            ("pt", _p(r"\b(?:trabalho como|atuo como)\s+(?:um\s+|uma\s+)?" + _V)),
            ("en", _p(r"\b(?:i work as|my role is)\s+(?:an?\s+)?" + _V)),
        ),
    ),
    Rule(
        "learning", ClaimKind.EXPLICIT_STATEMENT, "learning", False, Domain.LEARNING, "skill",
        0.7, 0.5, "positive", {"pt": "Está aprendendo", "en": "Is learning"},
        (
            ("pt", _p(r"\b(?:estou aprendendo|estou estudando|comecei a estudar|"
                      r"comecei a aprender)\s+" + _V)),
            ("en", _p(r"\b(?:i'?m learning|i am learning|i'?m studying|i am studying|"
                      r"i started learning)\s+" + _V)),
        ),
    ),
    Rule(
        "project", ClaimKind.EXPLICIT_STATEMENT, "project", False, Domain.PROJECTS, "project",
        0.65, 0.6, "positive", {"pt": "Trabalha no projeto", "en": "Works on project"},
        (
            ("pt", _p(r"\bestou (?:trabalhando|construindo|desenvolvendo)\s+"
                      r"(?:em\s+|no\s+|na\s+|o\s+|a\s+|um\s+|uma\s+)?" + _V)),
            ("en", _p(r"\b(?:i'?m|i am)\s+(?:working on|building)\s+(?:an?\s+|the\s+)?" + _V)),
        ),
    ),
    Rule(
        "preference_positive", ClaimKind.PREFERENCE, "preference", False, Domain.OTHER, "topic",
        0.6, 0.5, "positive", {"pt": "Prefere", "en": "Prefers"},
        (
            ("pt", _p(r"\b(?<!não )(?<!nao )(?:eu\s+)?(?:prefiro|gosto muito de|gosto de)\s+" + _V)),
            ("en", _p(r"\b(?:i prefer|i really like|i enjoy|i like)\s+" + _V)),
        ),
    ),
    Rule(
        "preference_negative", ClaimKind.PREFERENCE, "preference", False, Domain.OTHER, "topic",
        0.6, 0.5, "negative", {"pt": "Não gosta de", "en": "Dislikes"},
        (
            ("pt", _p(r"\b(?:não gosto de|nao gosto de|odeio|detesto)\s+" + _V)),
            ("en", _p(r"\b(?:i don'?t like|i do not like|i hate|i dislike)\s+" + _V)),
        ),
    ),
    Rule(
        "decision", ClaimKind.DECISION, "decision", False, Domain.OTHER, "topic", 0.65, 0.6,
        "positive", {"pt": "Decidiu", "en": "Decided"},
        (
            ("pt", _p(r"\b(?:decidi|escolhi|optei por)\s+" + _V)),
            ("en", _p(r"\b(?:i decided to|i decided|i chose to|i chose)\s+" + _V)),
        ),
    ),
)


def resolve_month(month: int, year: int | None, reference: datetime) -> datetime:
    """Most recent occurrence of ``month`` not after the reference date (unless year given)."""
    if year is None:
        year = reference.year if month <= reference.month else reference.year - 1
    return datetime(year, month, 1, tzinfo=UTC)


def clean_value(raw: str) -> str:
    value = TEMPORAL_RE.sub("", raw)
    value = _CUT_RE.split(value, maxsplit=1)[0]
    value = " ".join(value.split()).strip(" \t.!?\"'")
    return value[:200]


def _sentences(text: str) -> list[tuple[int, int]]:
    spans = []
    for m in _SENTENCE_RE.finditer(text):
        s, e = m.span()
        while s < e and text[s].isspace():
            s += 1
        while e > s and text[e - 1].isspace():
            e -= 1
        if e > s:
            spans.append((s, e))
    return spans


class DemoRuleExtractor:
    id = "rules-v1"

    def extract(self, text: str, *, occurred_at: datetime) -> ExtractionOutput:
        if occurred_at.tzinfo is None:
            occurred_at = occurred_at.replace(tzinfo=UTC)
        candidates: list[dict] = []
        for s, e in _sentences(text):
            sentence = text[s:e]
            temporal = TEMPORAL_RE.search(sentence)
            valid_from = occurred_at
            if temporal:
                year = int(temporal.group("year")) if temporal.group("year") else None
                valid_from = resolve_month(
                    MONTHS[temporal.group("month").casefold()], year, occurred_at
                )
            signals_change = bool(CHANGE_RE.search(sentence))
            sensitivity = Sensitivity.HIGH if SENSITIVE_RE.search(sentence) else Sensitivity.LOW
            for rule in RULES:
                for lang, pattern in rule.patterns:
                    m = pattern.search(sentence)
                    if not m:
                        continue
                    value = clean_value(m.group("v"))
                    if not value:
                        continue
                    slug = slugify(value)
                    subject = f"{rule.family}:primary" if rule.single_valued else (
                        f"{rule.family}:{slug}"
                    )
                    candidates.append(
                        {
                            "kind": rule.kind.value,
                            "subject_key": subject,
                            "statement": f"{rule.labels[lang]}: {value}",
                            "value": value,
                            "polarity": rule.polarity,
                            "domain": rule.domain.value,
                            "quote": sentence,
                            "span_start": s,
                            "span_end": e,
                            "valid_from": valid_from.isoformat(),
                            "signals_change": signals_change,
                            "extraction_confidence": rule.confidence,
                            "importance": rule.importance,
                            "sensitivity": sensitivity.value,
                            "entity": {"kind": rule.entity_kind, "name": value},
                            "lang": lang,
                        }
                    )
                    break  # one match per rule per sentence
        return ExtractionOutput(
            raw_candidates=candidates,
            extractor_id=self.id,
            notes=["deterministic demo rules; not an AI model"],
        )


class DemoHashingEmbedder:
    """Signed feature hashing of word unigrams and bigrams, L2-normalized."""

    def __init__(self, dim: int = 256) -> None:
        self.provider_name = "demo"
        self.dim = dim
        self.model = f"demo-hashing-v1-{dim}"

    def _vector(self, text: str) -> list[float] | None:
        tokens = tokens_for_embedding(text)
        features = tokens + [f"{a}_{b}" for a, b in zip(tokens, tokens[1:], strict=False)]
        if not features:
            return None
        vec = [0.0] * self.dim
        for feat in features:
            digest = hashlib.blake2b(feat.encode("utf-8"), digest_size=8).digest()
            idx = int.from_bytes(digest[:4], "big") % self.dim
            sign = 1.0 if digest[4] & 1 else -1.0
            vec[idx] += sign
        norm = math.sqrt(sum(v * v for v in vec))
        if norm == 0:
            return None
        return [v / norm for v in vec]

    def embed(self, texts: list[str]) -> list[list[float] | None]:
        return [self._vector(t) for t in texts]


class DemoExtractiveAnswerer:
    """Lists retrieved claims with citations. Composes no new content."""

    def answer(self, question: str, context: list[ContextItem]) -> AnswerDraft:
        if not context:
            return AnswerDraft(
                text="Não encontrei memórias registradas que respondam a isso. "
                "(modo demo: resposta extrativa, sem modelo de linguagem)",
                cited_claim_ids=[],
                mode="extractive_demo",
            )
        lines = ["Memórias relevantes registradas (modo demo, extrativo, sem LLM):"]
        for item in context:
            period = ""
            if item.valid_from or item.valid_to:
                start = item.valid_from.date().isoformat() if item.valid_from else "?"
                end = item.valid_to.date().isoformat() if item.valid_to else "atual"
                period = f" ({start} → {end})"
            lines.append(f"- {item.statement}{period} [{item.claim_id}]")
        return AnswerDraft(
            text="\n".join(lines),
            cited_claim_ids=[i.claim_id for i in context],
            mode="extractive_demo",
        )
