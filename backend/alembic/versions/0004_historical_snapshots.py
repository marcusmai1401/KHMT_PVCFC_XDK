"""add historical snapshots

Revision ID: 0004_historical_snapshots
Revises: 0003_add_et_tables
Create Date: 2026-05-13
"""

from alembic import op

from app.db.session import Base
from app.models import domain, et_domain  # noqa: F401


revision = "0004_historical_snapshots"
down_revision = "0003_add_et_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.tables["historical_snapshots"].create(bind=bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.tables["historical_snapshots"].drop(bind=bind, checkfirst=True)
