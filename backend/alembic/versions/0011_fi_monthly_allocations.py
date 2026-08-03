"""add FI monthly allocation finalization records

Revision ID: 0011_fi_monthly_allocations
Revises: 0010_add_missing_indexes
Create Date: 2026-08-03
"""

from alembic import op
import sqlalchemy as sa


revision = "0011_fi_monthly_allocations"
down_revision = "0010_add_missing_indexes"
branch_labels = None
depends_on = None


TABLE_NAME = "fi_monthly_allocations"
INDEXES = (
    ("ix_fi_monthly_allocations_team", ["team"]),
    ("ix_fi_monthly_allocations_month", ["month"]),
    ("ix_fi_monthly_allocations_year", ["year"]),
    ("ix_fi_monthly_allocations_status", ["status"]),
    ("ix_fi_monthly_allocations_report_id", ["report_id"]),
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # Revision 0001 builds Base.metadata dynamically, so a brand-new database
    # can already contain a model added by a later revision. Keep this migration
    # safe for both fresh installs and databases upgraded from an older release.
    if TABLE_NAME not in inspector.get_table_names():
        op.create_table(
            TABLE_NAME,
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("team", sa.String(), nullable=False),
            sa.Column("month", sa.Integer(), nullable=False),
            sa.Column("year", sa.Integer(), nullable=False),
            sa.Column("assessment", sa.String(), nullable=False),
            sa.Column("required_count", sa.Integer(), nullable=False),
            sa.Column("allocated_count", sa.Integer(), nullable=False),
            sa.Column("available_count", sa.Integer(), nullable=False),
            sa.Column("selected_sk_ids", sa.JSON(), nullable=False),
            sa.Column("released_sk_ids", sa.JSON(), nullable=False),
            sa.Column(
                "allocation_strategy",
                sa.String(),
                server_default="oldest_approved_first",
                nullable=False,
            ),
            sa.Column("status", sa.String(), server_default="finalized", nullable=False),
            sa.Column("report_id", sa.String(), nullable=False),
            sa.Column("report_version", sa.Integer(), nullable=False),
            sa.Column("finalized_by", sa.String(), nullable=False),
            sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("team", "month", "year", name="uq_fi_allocation_team_period"),
        )

    existing_indexes = {
        index["name"] for index in sa.inspect(bind).get_indexes(TABLE_NAME) if index.get("name")
    }
    for index_name, columns in INDEXES:
        if index_name not in existing_indexes:
            op.create_index(index_name, TABLE_NAME, columns)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if TABLE_NAME not in inspector.get_table_names():
        return

    existing_indexes = {
        index["name"] for index in inspector.get_indexes(TABLE_NAME) if index.get("name")
    }
    for index_name, _ in reversed(INDEXES):
        if index_name in existing_indexes:
            op.drop_index(index_name, table_name=TABLE_NAME)
    op.drop_table(TABLE_NAME)
