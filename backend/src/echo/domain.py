"""Domain vocabulary shared by every module.

Values are stored as plain strings in the database; these enums are the single
source of truth for what is allowed.
"""

from enum import StrEnum


class ClaimKind(StrEnum):
    EXPLICIT_STATEMENT = "explicit_statement"  # the user said it directly
    INFERENCE = "inference"  # derived by a model from what the user said
    PREFERENCE = "preference"  # stable like/dislike, stated as such
    GOAL = "goal"
    DECISION = "decision"  # a contextual choice; never auto-promoted to preference
    PATTERN = "pattern"  # only created by consolidation over independent episodes


class Domain(StrEnum):
    CAREER = "career"
    LEARNING = "learning"
    PROJECTS = "projects"
    OTHER = "other"


class ClaimStatus(StrEnum):
    ACTIVE = "active"
    CONTESTED = "contested"
    RETRACTED = "retracted"


class VersionOrigin(StrEnum):
    EXTRACTION = "extraction"
    CONSOLIDATION = "consolidation"
    USER_CORRECTION = "user_correction"
    USER_CONFIRMATION = "user_confirmation"
    USER_CONTEST = "user_contest"
    USER_RETRACTION = "user_retraction"
    CONFLICT_RESOLUTION = "conflict_resolution"


class ChangeReason(StrEnum):
    CREATED = "created"
    ENDED = "ended"  # validity closed because the user reported a change
    CONFIRMED = "confirmed"
    CONTESTED = "contested"
    CORRECTED = "corrected"
    RETRACTED = "retracted"
    RESTORED = "restored"


class Sensitivity(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class Stance(StrEnum):
    SUPPORTS = "supports"
    CONTRADICTS = "contradicts"


class EpisodeSource(StrEnum):
    CHAT = "chat"
    NOTE = "note"
    IMPORT = "import"
    CORRECTION = "correction"  # text supplied by the user when correcting a claim
    SYNTHETIC_SEED = "synthetic_seed"
    SUMMARY = "summary"  # reserved: derived content, never independent evidence


CLIENT_EPISODE_SOURCES = {EpisodeSource.CHAT, EpisodeSource.NOTE, EpisodeSource.IMPORT}
DERIVED_EPISODE_SOURCES = {EpisodeSource.SUMMARY}


class ProcessingStatus(StrEnum):
    PENDING = "pending"
    RETRY_SCHEDULED = "retry_scheduled"
    PROCESSED = "processed"
    FAILED = "failed"
    NOT_APPLICABLE = "not_applicable"
    DELETED = "deleted"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobKind(StrEnum):
    PROCESS_EPISODE = "process_episode"
    EMBED = "embed"


class ConflictStatus(StrEnum):
    OPEN = "open"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


class ConflictResolution(StrEnum):
    KEEP_A = "keep_a"
    KEEP_B = "keep_b"
    BOTH_VALID = "both_valid"
    DISMISS = "dismiss"


class RetrievalPurpose(StrEnum):
    ANSWER = "answer"
    SELF_REVIEW = "self_review"
    CONTEXT_PREVIEW = "context_preview"


# Subject families that hold a single current value: a different value is either
# a reported change or a possible conflict.
SINGLE_VALUED_FAMILIES = {"goal", "role"}
