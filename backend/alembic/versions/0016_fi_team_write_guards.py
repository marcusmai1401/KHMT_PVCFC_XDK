"""add stable per-team FI candidate-pool concurrency guards

Revision ID: 0016_fi_team_write_guards
Revises: 0015_user_feedback
"""

from alembic import op
import sqlalchemy as sa


revision = "0016_fi_team_write_guards"
down_revision = "0015_user_feedback"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "fi_team_write_guards" in sa.inspect(bind).get_table_names():
        return
    op.create_table(
        "fi_team_write_guards",
        sa.Column("team", sa.String(), nullable=False),
        sa.Column("revision", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("team"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if "fi_team_write_guards" in sa.inspect(bind).get_table_names():
        op.drop_table("fi_team_write_guards")
