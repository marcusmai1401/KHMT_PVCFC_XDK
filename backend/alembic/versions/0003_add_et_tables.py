"""add ET competency tables

Revision ID: 0003_add_et_tables
Revises: 0002_web_input_fields
Create Date: 2026-05-12
"""

from alembic import op

from app.db.session import Base
from app.models import domain, et_domain  # noqa: F401


revision = "0003_add_et_tables"
down_revision = "0002_web_input_fields"
branch_labels = None
depends_on = None


ET_TABLES = [
    "competency_frameworks",
    "competency_items",
    "personnel",
    "competency_assessments",
    "assessment_items",
    "learning_plans",
    "learning_plan_items",
]


def upgrade() -> None:
    bind = op.get_bind()
    for table_name in ET_TABLES:
        Base.metadata.tables[table_name].create(bind=bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    for table_name in reversed(ET_TABLES):
        Base.metadata.tables[table_name].drop(bind=bind, checkfirst=True)
