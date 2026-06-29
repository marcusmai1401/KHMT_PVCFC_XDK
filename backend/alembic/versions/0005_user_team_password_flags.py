"""user team + must_change_password flags

Revision ID: 0005_user_team_password_flags
Revises: 0004_historical_snapshots
Create Date: 2026-05-24
"""

import sqlalchemy as sa
from alembic import op


revision = "0005_user_team_password_flags"
down_revision = "0004_historical_snapshots"
branch_labels = None
depends_on = None


def _column_names(table_name: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    columns = _column_names("users")
    if "full_name" not in columns:
        op.add_column("users", sa.Column("full_name", sa.String(), nullable=True))
    if "team" not in columns:
        op.add_column("users", sa.Column("team", sa.String(), nullable=True))
    if "must_change_password" not in columns:
        op.add_column(
            "users",
            sa.Column(
                "must_change_password",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
        )


def downgrade() -> None:
    op.drop_column("users", "must_change_password")
    op.drop_column("users", "team")
    op.drop_column("users", "full_name")
