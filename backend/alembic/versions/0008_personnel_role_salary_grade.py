"""add personnel role, salary grade, and hidden rows

Revision ID: 0008_personnel_role_salary_grade
Revises: 0007_fi_completed_at_dates
Create Date: 2026-05-28
"""

from alembic import op
import sqlalchemy as sa


revision = "0008_personnel_role_salary_grade"
down_revision = "0007_fi_completed_at_dates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    personnel_columns = {column["name"] for column in inspector.get_columns("personnel")}
    if "role" not in personnel_columns:
        op.add_column("personnel", sa.Column("role", sa.String(length=100), nullable=True))
        op.create_index(op.f("ix_personnel_role"), "personnel", ["role"], unique=False)
    if "salary_grade" not in personnel_columns:
        op.add_column("personnel", sa.Column("salary_grade", sa.String(length=50), nullable=True))
    with op.batch_alter_table("personnel") as batch_op:
        batch_op.alter_column("employee_code", existing_type=sa.String(length=50), nullable=True)
        batch_op.alter_column("position_code", existing_type=sa.String(length=50), nullable=True)
        batch_op.alter_column("team", existing_type=sa.String(length=50), nullable=True)
        batch_op.alter_column("current_level", existing_type=sa.Integer(), nullable=True)
    if "personnel_hidden_rows" not in inspector.get_table_names():
        op.create_table(
            "personnel_hidden_rows",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("source_type", sa.String(length=20), nullable=False),
            sa.Column("source_id", sa.String(), nullable=False),
            sa.Column("hidden_by", sa.String(), nullable=False),
            sa.Column("hidden_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["hidden_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("source_type", "source_id", name="uq_personnel_hidden_source"),
        )
        op.create_index(op.f("ix_personnel_hidden_rows_source_type"), "personnel_hidden_rows", ["source_type"], unique=False)
        op.create_index(op.f("ix_personnel_hidden_rows_source_id"), "personnel_hidden_rows", ["source_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_personnel_hidden_rows_source_id"), table_name="personnel_hidden_rows")
    op.drop_index(op.f("ix_personnel_hidden_rows_source_type"), table_name="personnel_hidden_rows")
    op.drop_table("personnel_hidden_rows")
    with op.batch_alter_table("personnel") as batch_op:
        batch_op.alter_column("current_level", existing_type=sa.Integer(), nullable=False)
        batch_op.alter_column("team", existing_type=sa.String(length=50), nullable=False)
        batch_op.alter_column("position_code", existing_type=sa.String(length=50), nullable=False)
        batch_op.alter_column("employee_code", existing_type=sa.String(length=50), nullable=False)
    op.drop_column("personnel", "salary_grade")
    op.drop_index(op.f("ix_personnel_role"), table_name="personnel")
    op.drop_column("personnel", "role")
