"""add source definition texts to competency items

Revision ID: 0009_competency_item_source_texts
Revises: 0008_personnel_role_salary_grade
Create Date: 2026-05-28
"""

from alembic import op
import sqlalchemy as sa


revision = "0009_competency_item_source_texts"
down_revision = "0008_personnel_role_salary_grade"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("competency_items")}
    if "definition" not in columns:
        op.add_column("competency_items", sa.Column("definition", sa.Text(), nullable=True))
    if "requirements_text" not in columns:
        op.add_column("competency_items", sa.Column("requirements_text", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("competency_items")}
    if "requirements_text" in columns:
        op.drop_column("competency_items", "requirements_text")
    if "definition" in columns:
        op.drop_column("competency_items", "definition")
