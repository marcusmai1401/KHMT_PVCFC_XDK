"""Add FI execution tracking columns on sk_ctkt and image stage on sk_images."""
from __future__ import annotations

import json
from alembic import op
import sqlalchemy as sa

revision = "0019_fi_execution_tracking"
down_revision = "0018_fi_history_order"
branch_labels = None
depends_on = None

PLAN_HISTORY_REASONS = {
    "completion_plan_update",
    "execution_update",
    "completion_auto_done",
    "completion_auto_planned",
    "completion_auto_done_reverted",
}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "sk_ctkt" in tables:
        existing_sk_cols = {col["name"] for col in inspector.get_columns("sk_ctkt")}
        if "execution_status" not in existing_sk_cols:
            op.add_column("sk_ctkt", sa.Column("execution_status", sa.String(length=32), nullable=True))
        if "execution_note" not in existing_sk_cols:
            op.add_column("sk_ctkt", sa.Column("execution_note", sa.Text(), nullable=True))
        if "execution_updated_at" not in existing_sk_cols:
            op.add_column("sk_ctkt", sa.Column("execution_updated_at", sa.DateTime(timezone=True), nullable=True))
        if "execution_updated_by" not in existing_sk_cols:
            op.add_column("sk_ctkt", sa.Column("execution_updated_by", sa.String(), nullable=True))
        op.execute("CREATE INDEX IF NOT EXISTS ix_sk_ctkt_execution_status ON sk_ctkt (execution_status)")

        # Safe backfill: flag Approved records whose latest completion plan change
        # was system auto-completion so SQL filtering on completion=auto_done uses the index.
        rows = bind.execute(
            sa.text(
                "SELECT id, status_history FROM sk_ctkt "
                "WHERE status = 'Approved' AND completed_at IS NOT NULL AND execution_status IS NULL"
            )
        ).fetchall()
        for record_id, raw_history in rows:
            history = raw_history
            if isinstance(history, str):
                try:
                    history = json.loads(history)
                except ValueError:
                    history = []
            if not isinstance(history, list):
                continue
            last_plan = next(
                (
                    entry
                    for entry in reversed(history)
                    if isinstance(entry, dict) and entry.get("reason") in PLAN_HISTORY_REASONS
                ),
                None,
            )
            if last_plan is not None and last_plan.get("reason") == "completion_auto_done":
                bind.execute(
                    sa.text(
                        "UPDATE sk_ctkt SET execution_status = 'auto_completed' "
                        "WHERE id = :record_id AND execution_status IS NULL"
                    ),
                    {"record_id": record_id},
                )

    if "sk_images" in tables:
        existing_img_cols = {col["name"] for col in inspector.get_columns("sk_images")}
        if "stage" not in existing_img_cols:
            op.add_column(
                "sk_images",
                sa.Column("stage", sa.String(length=32), nullable=False, server_default="registration"),
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "sk_images" in tables:
        existing_img_cols = {col["name"] for col in inspector.get_columns("sk_images")}
        if "stage" in existing_img_cols:
            op.drop_column("sk_images", "stage")

    if "sk_ctkt" in tables:
        op.execute("DROP INDEX IF EXISTS ix_sk_ctkt_execution_status")
        existing_sk_cols = {col["name"] for col in inspector.get_columns("sk_ctkt")}
        for col_name in ("execution_updated_by", "execution_updated_at", "execution_note", "execution_status"):
            if col_name in existing_sk_cols:
                op.drop_column("sk_ctkt", col_name)
