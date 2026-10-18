"""add centralized FI period write guards

Revision ID: 0014_fi_period_write_guards
Revises: 0013_idempotency_notification_receipts
"""

from alembic import op
import sqlalchemy as sa


revision = "0014_fi_period_write_guards"
down_revision = "0013_idempotency_notification_receipts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "fi_period_write_guards" in sa.inspect(bind).get_table_names():
        return
    op.create_table(
        "fi_period_write_guards",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("team", sa.String(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("is_locked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("revision", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("locked_by", sa.String(), nullable=True),
        sa.Column("lock_reason", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("team", "month", "year", name="uq_fi_period_write_guard"),
    )
    op.create_index("ix_fi_period_write_guards_team", "fi_period_write_guards", ["team"])
    op.create_index("ix_fi_period_write_guards_month", "fi_period_write_guards", ["month"])
    op.create_index("ix_fi_period_write_guards_year", "fi_period_write_guards", ["year"])
    op.create_index("ix_fi_period_write_guards_is_locked", "fi_period_write_guards", ["is_locked"])


def downgrade() -> None:
    bind = op.get_bind()
    if "fi_period_write_guards" not in sa.inspect(bind).get_table_names():
        return
    for name in (
        "ix_fi_period_write_guards_is_locked",
        "ix_fi_period_write_guards_year",
        "ix_fi_period_write_guards_month",
        "ix_fi_period_write_guards_team",
    ):
        op.drop_index(name, table_name="fi_period_write_guards")
    op.drop_table("fi_period_write_guards")
