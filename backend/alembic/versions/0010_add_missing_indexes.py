"""add missing indexes on frequently filtered/sorted columns

Revision ID: 0010_add_missing_indexes
Revises: 0009_competency_texts
Create Date: 2026-07-01
"""

from alembic import op
import sqlalchemy as sa


revision = "0010_add_missing_indexes"
down_revision = "0009_competency_texts"
branch_labels = None
depends_on = None


# (table, column) pairs that are filtered/ordered on in hot request paths
# (dashboard load, FI list/search, notification poll, audit viewer) but had
# no index. Fresh databases already get these via Base.metadata.create_all
# in 0001; this migration brings existing databases in line.
INDEXES = [
    ("team_reports", "team"),
    ("team_reports", "report_month"),
    ("team_reports", "report_year"),
    ("team_reports", "report_status"),
    ("team_reports", "is_current_version"),
    ("team_reports", "uploaded_at"),
    ("warnings", "team_report_id"),
    ("warnings", "created_at"),
    ("sk_ctkt", "author_user_id"),
    ("sk_ctkt", "team"),
    ("sk_ctkt", "status"),
    ("sk_ctkt", "khmt_month"),
    ("sk_ctkt", "khmt_year"),
    ("sk_ctkt", "is_historical_import"),
    ("notifications", "recipient_role"),
    ("notifications", "recipient_user_id"),
    ("notifications", "created_at"),
    ("audit_logs", "actor"),
    ("audit_logs", "entity_type"),
    ("audit_logs", "created_at"),
]


def _index_names(table_name: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    existing_by_table: dict[str, set[str]] = {}
    for table, column in INDEXES:
        existing = existing_by_table.setdefault(table, _index_names(table))
        index_name = op.f(f"ix_{table}_{column}")
        if index_name not in existing:
            op.create_index(index_name, table, [column], unique=False)


def downgrade() -> None:
    for table, column in reversed(INDEXES):
        op.drop_index(op.f(f"ix_{table}_{column}"), table_name=table)
