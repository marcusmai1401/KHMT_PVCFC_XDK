"""add optimistic-concurrency and session invalidation tokens

Revision ID: 0012_audit_remediation_revisions
Revises: 0011_fi_monthly_allocations
"""

from alembic import op
import sqlalchemy as sa


revision = "0012_audit_remediation_revisions"
down_revision = "0011_fi_monthly_allocations"
branch_labels = None
depends_on = None


COLUMNS = {
    "users": ("session_version", sa.Integer(), "1"),
    "team_reports": ("revision", sa.Integer(), "0"),
    "sk_ctkt": ("revision", sa.Integer(), "1"),
    "competency_assessments": ("revision", sa.Integer(), "0"),
}


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.alter_column("alembic_version", "version_num", type_=sa.String(128))
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    for table, (column, type_, default) in COLUMNS.items():
        if table not in tables:
            continue
        existing = {item["name"] for item in sa.inspect(bind).get_columns(table)}
        if column not in existing:
            op.add_column(
                table,
                sa.Column(column, type_, nullable=False, server_default=sa.text(default)),
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for table, (column, _, _) in reversed(list(COLUMNS.items())):
        if table not in inspector.get_table_names():
            continue
        existing = {item["name"] for item in sa.inspect(bind).get_columns(table)}
        if column in existing:
            op.drop_column(table, column)
