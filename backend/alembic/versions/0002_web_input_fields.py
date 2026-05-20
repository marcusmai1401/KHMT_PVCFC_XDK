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


def upgrade() -> None:
    op.add_column(
        "team_reports",
        sa.Column("source_type", sa.String(), nullable=False, server_default="excel_upload"),
    )
    op.add_column(
        "team_reports",
        sa.Column("report_status", sa.String(), nullable=False, server_default="draft"),
    )
    op.add_column(
        "team_reports",
        sa.Column("arising_work", sa.JSON(), nullable=False, server_default="[]"),
    )
    op.add_column("team_reports", sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("team_reports", sa.Column("locked_by", sa.String(), nullable=True))
    op.add_column("team_reports", sa.Column("lock_reason", sa.Text(), nullable=True))
    op.add_column("team_reports", sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("team_reports", sa.Column("last_auto_save", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE team_reports SET report_status = 'submitted' WHERE source_type = 'excel_upload'")


def downgrade() -> None:
    op.drop_column("team_reports", "last_auto_save")
    op.drop_column("team_reports", "submitted_at")
    op.drop_column("team_reports", "lock_reason")
    op.drop_column("team_reports", "locked_by")
    op.drop_column("team_reports", "locked_at")
    op.drop_column("team_reports", "arising_work")
    op.drop_column("team_reports", "report_status")
    op.drop_column("team_reports", "source_type")
