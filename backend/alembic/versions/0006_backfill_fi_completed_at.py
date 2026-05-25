"""backfill FI completed_at from BM01 completion plan

Revision ID: 0006_backfill_fi_completed_at
Revises: 0005_user_team_password_flags
Create Date: 2026-05-25
"""

from alembic import op


revision = "0006_backfill_fi_completed_at"
down_revision = "0005_user_team_password_flags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE sk_ctkt
        SET completed_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
        WHERE completed_at IS NULL
          AND (
            lower(coalesce(completion_plan, '')) LIKE '%hoàn thành%'
            OR lower(coalesce(completion_plan, '')) LIKE '%hoan thanh%'
            OR lower(coalesce(completion_plan, '')) LIKE '%đã thực hiện%'
            OR lower(coalesce(completion_plan, '')) LIKE '%da thuc hien%'
            OR lower(coalesce(completion_plan, '')) LIKE '%đã triển khai%'
            OR lower(coalesce(completion_plan, '')) LIKE '%da trien khai%'
          )
          AND lower(coalesce(completion_plan, '')) NOT LIKE '%chưa thực hiện%'
          AND lower(coalesce(completion_plan, '')) NOT LIKE '%chua thuc hien%'
          AND lower(coalesce(completion_plan, '')) NOT LIKE '%chưa hoàn thành%'
          AND lower(coalesce(completion_plan, '')) NOT LIKE '%chua hoan thanh%'
          AND lower(coalesce(completion_plan, '')) NOT LIKE '%dự kiến%'
          AND lower(coalesce(completion_plan, '')) NOT LIKE '%du kien%'
        """
    )

def downgrade() -> None:
    op.execute(
        """
        UPDATE sk_ctkt
        SET completed_at = NULL
        WHERE is_historical_import = true
          AND completed_at IS NOT NULL
          AND (
            lower(coalesce(completion_plan, '')) LIKE '%hoàn thành%'
            OR lower(coalesce(completion_plan, '')) LIKE '%hoan thanh%'
            OR lower(coalesce(completion_plan, '')) LIKE '%đã thực hiện%'
            OR lower(coalesce(completion_plan, '')) LIKE '%da thuc hien%'
            OR lower(coalesce(completion_plan, '')) LIKE '%đã triển khai%'
            OR lower(coalesce(completion_plan, '')) LIKE '%da trien khai%'
          )
        """
    )
