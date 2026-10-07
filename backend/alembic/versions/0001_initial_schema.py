"""Initial schema with bitemporal claims, episodes, embeddings and jobs

Revision ID: 0001_initial_schema
Revises: 
Create Date: 2026-10-05 13:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import pgvector.sqlalchemy
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0001_initial_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Ensure pgvector extension
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        'users',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('email', sa.String(length=320), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('display_name', sa.String(length=120), nullable=True),
        sa.Column('is_synthetic', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email')
    )

    op.create_table(
        'episodes',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('source_type', sa.String(length=32), nullable=False),
        sa.Column('content', sa.Text(), nullable=True),
        sa.Column('content_hash', sa.String(length=64), nullable=True),
        sa.Column('occurred_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('processing_status', sa.String(length=24), nullable=False),
        sa.Column('processing_error', sa.Text(), nullable=True),
        sa.Column('pipeline_version', sa.String(length=100), nullable=True),
        sa.Column('duplicate_of_episode_id', sa.UUID(), nullable=True),
        sa.Column('is_synthetic', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['duplicate_of_episode_id'], ['episodes.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_episodes_user_id', 'episodes', ['user_id'], unique=False)
    op.create_index('ix_episodes_user_recorded', 'episodes', ['user_id', 'recorded_at'], unique=False)

    op.create_table(
        'claims',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('subject_key', sa.String(length=200), nullable=False),
        sa.Column('domain', sa.String(length=24), nullable=False),
        sa.Column('is_synthetic', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_claims_user_id', 'claims', ['user_id'], unique=False)
    op.create_index('ix_claims_user_subject', 'claims', ['user_id', 'subject_key'], unique=False)

    op.create_table(
        'entities',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('kind', sa.String(length=24), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('normalized_name', sa.String(length=200), nullable=False),
        sa.Column('is_synthetic', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'kind', 'normalized_name', name='uq_entities_user_kind_name')
    )
    op.create_index('ix_entities_user_id', 'entities', ['user_id'], unique=False)

    op.create_table(
        'claim_versions',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('claim_id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('version_no', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=24), nullable=False),
        sa.Column('statement', sa.Text(), nullable=False),
        sa.Column('attributes', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('origin', sa.String(length=24), nullable=False),
        sa.Column('change_reason', sa.String(length=24), nullable=False),
        sa.Column('change_note', sa.Text(), nullable=True),
        sa.Column('extraction_confidence', sa.Float(), nullable=True),
        sa.Column('importance', sa.Float(), nullable=False),
        sa.Column('sensitivity', sa.String(length=8), nullable=False),
        sa.Column('last_confirmed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('valid_from', sa.DateTime(timezone=True), nullable=True),
        sa.Column('valid_to', sa.DateTime(timezone=True), nullable=True),
        sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('superseded_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('pipeline_version', sa.String(length=100), nullable=False),
        sa.Column('provider_mode', sa.String(length=8), nullable=False),
        sa.Column('source_episode_id', sa.UUID(), nullable=True),
        sa.CheckConstraint('extraction_confidence IS NULL OR (extraction_confidence >= 0 AND extraction_confidence <= 1)', name='ck_claim_versions_confidence_range'),
        sa.CheckConstraint('importance >= 0 AND importance <= 1', name='ck_claim_versions_importance_range'),
        sa.CheckConstraint('valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from', name='ck_claim_versions_valid_interval'),
        sa.ForeignKeyConstraint(['claim_id'], ['claims.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['source_episode_id'], ['episodes.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('claim_id', 'version_no', name='uq_claim_versions_claim_version')
    )
    op.create_index('ix_claim_versions_claim_id', 'claim_versions', ['claim_id'], unique=False)
    op.create_index('ix_claim_versions_user_id', 'claim_versions', ['user_id'], unique=False)
    op.create_index('ix_claim_versions_user_recorded', 'claim_versions', ['user_id', 'recorded_at'], unique=False)
    op.create_index('ux_claim_versions_current', 'claim_versions', ['claim_id'], unique=True, postgresql_where=sa.text('superseded_at IS NULL'))

    op.create_table(
        'evidence_links',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('claim_id', sa.UUID(), nullable=False),
        sa.Column('claim_version_id', sa.UUID(), nullable=False),
        sa.Column('episode_id', sa.UUID(), nullable=False),
        sa.Column('span_start', sa.Integer(), nullable=False),
        sa.Column('span_end', sa.Integer(), nullable=False),
        sa.Column('quote', sa.Text(), nullable=False),
        sa.Column('stance', sa.String(length=12), nullable=False),
        sa.Column('is_independent', sa.Boolean(), nullable=False),
        sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('invalidated_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint('span_start >= 0 AND span_end > span_start', name='ck_evidence_links_span'),
        sa.ForeignKeyConstraint(['claim_id'], ['claims.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['claim_version_id'], ['claim_versions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['episode_id'], ['episodes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('claim_id', 'episode_id', 'span_start', 'span_end', name='uq_evidence_links_span')
    )
    op.create_index('ix_evidence_links_claim_id', 'evidence_links', ['claim_id'], unique=False)
    op.create_index('ix_evidence_links_episode_id', 'evidence_links', ['episode_id'], unique=False)
    op.create_index('ix_evidence_links_user_id', 'evidence_links', ['user_id'], unique=False)

    op.create_table(
        'relation_versions',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('claim_id', sa.UUID(), nullable=False),
        sa.Column('claim_version_id', sa.UUID(), nullable=False),
        sa.Column('entity_id', sa.UUID(), nullable=False),
        sa.Column('predicate', sa.String(length=32), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('valid_from', sa.DateTime(timezone=True), nullable=True),
        sa.Column('valid_to', sa.DateTime(timezone=True), nullable=True),
        sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('superseded_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['claim_id'], ['claims.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['claim_version_id'], ['claim_versions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['entity_id'], ['entities.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_relation_versions_claim_id', 'relation_versions', ['claim_id'], unique=False)
    op.create_index('ix_relation_versions_entity_id', 'relation_versions', ['entity_id'], unique=False)
    op.create_index('ix_relation_versions_user_id', 'relation_versions', ['user_id'], unique=False)
    op.create_index('ux_relation_versions_current', 'relation_versions', ['claim_id'], unique=True, postgresql_where=sa.text('superseded_at IS NULL'))

    op.create_table(
        'conflict_links',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('claim_a_id', sa.UUID(), nullable=False),
        sa.Column('claim_b_id', sa.UUID(), nullable=False),
        sa.Column('kind', sa.String(length=24), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('resolution', sa.String(length=24), nullable=True),
        sa.Column('rationale', sa.Text(), nullable=False),
        sa.Column('detected_episode_id', sa.UUID(), nullable=True),
        sa.Column('pipeline_version', sa.String(length=100), nullable=False),
        sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint('claim_a_id <> claim_b_id', name='ck_conflict_links_distinct'),
        sa.ForeignKeyConstraint(['claim_a_id'], ['claims.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['claim_b_id'], ['claims.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['detected_episode_id'], ['episodes.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('claim_a_id', 'claim_b_id', name='uq_conflict_links_pair')
    )
    op.create_index('ix_conflict_links_claim_a_id', 'conflict_links', ['claim_a_id'], unique=False)
    op.create_index('ix_conflict_links_claim_b_id', 'conflict_links', ['claim_b_id'], unique=False)
    op.create_index('ix_conflict_links_user_id', 'conflict_links', ['user_id'], unique=False)

    op.create_table(
        'embeddings',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('episode_id', sa.UUID(), nullable=True),
        sa.Column('claim_version_id', sa.UUID(), nullable=True),
        sa.Column('model', sa.String(length=100), nullable=False),
        sa.Column('dim', sa.Integer(), nullable=False),
        sa.Column('vector', pgvector.sqlalchemy.Vector(), nullable=False),
        sa.Column('provider_mode', sa.String(length=8), nullable=False),
        sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint('(episode_id IS NULL) <> (claim_version_id IS NULL)', name='ck_embeddings_single_owner'),
        sa.ForeignKeyConstraint(['claim_version_id'], ['claim_versions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['episode_id'], ['episodes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('claim_version_id', 'model', name='uq_embeddings_claim_version_model'),
        sa.UniqueConstraint('episode_id', 'model', name='uq_embeddings_episode_model')
    )
    op.create_index('ix_embeddings_user_id', 'embeddings', ['user_id'], unique=False)

    op.create_table(
        'jobs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=True),
        sa.Column('kind', sa.String(length=32), nullable=False),
        sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('idempotency_key', sa.String(length=200), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('attempts', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('max_attempts', sa.Integer(), nullable=False),
        sa.Column('run_after', sa.DateTime(timezone=True), nullable=False),
        sa.Column('locked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('locked_by', sa.String(length=100), nullable=True),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('result', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('idempotency_key')
    )
    op.create_index('ix_jobs_status_run_after', 'jobs', ['status', 'run_after'], unique=False)
    op.create_index('ix_jobs_user_id', 'jobs', ['user_id'], unique=False)

    op.create_table(
        'audit_events',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=True),
        sa.Column('actor', sa.String(length=16), nullable=False),
        sa.Column('action', sa.String(length=48), nullable=False),
        sa.Column('target_type', sa.String(length=32), nullable=False),
        sa.Column('target_id', sa.UUID(), nullable=True),
        sa.Column('details', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_audit_events_user_recorded', 'audit_events', ['user_id', 'recorded_at'], unique=False)


def downgrade() -> None:
    op.drop_table('audit_events')
    op.drop_table('jobs')
    op.drop_table('embeddings')
    op.drop_table('conflict_links')
    op.drop_table('relation_versions')
    op.drop_table('evidence_links')
    op.drop_table('claim_versions')
    op.drop_table('entities')
    op.drop_table('claims')
    op.drop_table('episodes')
    op.drop_table('users')
    op.execute("DROP EXTENSION IF EXISTS vector")
