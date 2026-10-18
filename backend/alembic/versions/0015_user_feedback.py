"""add internal user feedback inbox

Revision ID: 0015_user_feedback
Revises: 0014_fi_period_write_guards
"""

from alembic import op
import sqlalchemy as sa


revision = "0015_user_feedback"
down_revision = "0014_fi_period_write_guards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "user_feedback" in sa.inspect(bind).get_table_names():
        return
    op.create_table(
        "user_feedback",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("feedback_type", sa.String(length=30), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("context", sa.JSON(), nullable=False),
        sa.Column("build_id", sa.String(length=100), nullable=True),
        sa.Column("consent", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="new"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_feedback_user_id", "user_feedback", ["user_id"])
    op.create_index("ix_user_feedback_feedback_type", "user_feedback", ["feedback_type"])
    op.create_index("ix_user_feedback_status", "user_feedback", ["status"])
    op.create_index("ix_user_feedback_created_at", "user_feedback", ["created_at"])


def downgrade() -> None:
    bind = op.get_bind()
    if "user_feedback" not in sa.inspect(bind).get_table_names():
        return
    for name in (
        "ix_user_feedback_created_at",
        "ix_user_feedback_status",
        "ix_user_feedback_feedback_type",
        "ix_user_feedback_user_id",
    ):
        op.drop_index(name, table_name="user_feedback")
    op.drop_table("user_feedback")
