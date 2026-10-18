"""Index the stable FI history order without rewriting existing data."""
from alembic import op

revision = "0018_fi_history_order"
down_revision = "0017_report_current_lanes"
branch_labels = None
depends_on = None


def upgrade():
    # 0001 uses current model metadata on a fresh database, so the index may
    # already exist. Both supported engines support this idempotent statement.
    op.execute("CREATE INDEX IF NOT EXISTS ix_fi_history_order ON sk_ctkt (coalesce(created_at, submitted_at, updated_at) DESC, id DESC)")


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_fi_history_order")
