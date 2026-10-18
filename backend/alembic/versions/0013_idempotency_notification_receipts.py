"""persist mutation idempotency and per-user notification receipts

Revision ID: 0013_idempotency_notification_receipts
Revises: 0012_audit_remediation_revisions
"""

from alembic import op
import sqlalchemy as sa


revision = "0013_idempotency_notification_receipts"
down_revision = "0012_audit_remediation_revisions"
branch_labels = None
depends_on = None


def _tables(bind):
    return set(sa.inspect(bind).get_table_names())


def upgrade() -> None:
    bind = op.get_bind()
    tables = _tables(bind)
    if "notification_receipts" not in tables:
        op.create_table(
            "notification_receipts",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("notification_id", sa.String(), nullable=False),
            sa.Column("user_id", sa.String(), nullable=False),
            sa.Column("read_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("notification_id", "user_id", name="uq_notification_receipt_user"),
        )
        op.create_index("ix_notification_receipts_notification_id", "notification_receipts", ["notification_id"])
        op.create_index("ix_notification_receipts_user_id", "notification_receipts", ["user_id"])
    if "idempotency_keys" not in tables:
        op.create_table(
            "idempotency_keys",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("actor", sa.String(), nullable=False),
            sa.Column("scope", sa.String(), nullable=False),
            sa.Column("key", sa.String(), nullable=False),
            sa.Column("request_hash", sa.String(), nullable=False),
            sa.Column("response", sa.JSON(), nullable=False),
            sa.Column("status_code", sa.Integer(), nullable=False, server_default="200"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("actor", "scope", "key", name="uq_idempotency_actor_scope_key"),
        )
        op.create_index("ix_idempotency_keys_actor", "idempotency_keys", ["actor"])


def downgrade() -> None:
    bind = op.get_bind()
    tables = _tables(bind)
    if "idempotency_keys" in tables:
        op.drop_index("ix_idempotency_keys_actor", table_name="idempotency_keys")
        op.drop_table("idempotency_keys")
    if "notification_receipts" in tables:
        op.drop_index("ix_notification_receipts_user_id", table_name="notification_receipts")
        op.drop_index("ix_notification_receipts_notification_id", table_name="notification_receipts")
        op.drop_table("notification_receipts")
