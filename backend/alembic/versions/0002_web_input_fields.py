"""web input fields

Revision ID: 0002_web_input_fields
Revises: 0001_initial
Create Date: 2026-05-11
"""

import sqlalchemy as sa
from alembic import op


revision = "0002_web_input_fields"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def _column_names(table_name: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    columns = _column_names("team_reports")
    if "source_type" not in columns:
        op.add_column(
            "team_reports",
            sa.Column("source_type", sa.String(), nullable=False, server_default="excel_upload"),
        )
    if "report_status" not in columns:
        op.add_column(
            "team_reports",
            sa.Column("report_status", sa.String(), nullable=False, server_default="draft"),
        )
    if "arising_work" not in columns:
        op.add_column(
            "team_reports",
            sa.Column("arising_work", sa.JSON(), nullable=False, server_default="[]"),
        )
    if "locked_at" not in columns:
        op.add_column("team_reports", sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True))
    if "locked_by" not in columns:
        op.add_column("team_reports", sa.Column("locked_by", sa.String(), nullable=True))
    if "lock_reason" not in columns:
        op.add_column("team_reports", sa.Column("lock_reason", sa.Text(), nullable=True))
    if "submitted_at" not in columns:
        op.add_column("team_reports", sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True))
    if "last_auto_save" not in columns:
        op.add_column("team_reports", sa.Column("last_auto_save", sa.DateTime(timezone=True), nullable=True))
    op.execute(
        "UPDATE team_reports SET report_status = 'submitted' "
        "WHERE source_type = 'excel_upload'"
    )


def downgrade() -> None:
    op.drop_column("team_reports", "last_auto_save")
    op.drop_column("team_reports", "submitted_at")
    op.drop_column("team_reports", "lock_reason")
    op.drop_column("team_reports", "locked_by")
    op.drop_column("team_reports", "locked_at")
    op.drop_column("team_reports", "arising_work")
    op.drop_column("team_reports", "report_status")
    op.drop_column("team_reports", "source_type")
