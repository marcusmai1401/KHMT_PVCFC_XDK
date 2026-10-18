"""Enforce one current report in each draft/published lane without repairing legacy data."""
from alembic import op
import sqlalchemy as sa
revision = "0017_report_current_lanes"
down_revision = "0016_fi_team_write_guards"
branch_labels = None
depends_on = None

LANES = {"uq_report_current_draft": "report_status = 'draft'", "uq_report_current_published": "report_status IN ('submitted', 'locked')"}

def upgrade():
    bind = op.get_bind()
    if "fi_monthly_allocations" in sa.inspect(bind).get_table_names():
        conflicts = list(bind.execute(sa.text("""
            SELECT a.id, a.report_id, a.report_version
            FROM fi_monthly_allocations a LEFT JOIN team_reports r ON r.id = a.report_id
            WHERE a.status = 'finalized' AND (
                r.id IS NULL OR r.team IS NULL OR r.report_month IS NULL
                OR r.report_year IS NULL OR r.version IS NULL OR r.report_status IS NULL
                OR r.is_current_version IS NULL OR r.team <> a.team OR r.report_month <> a.month
                OR r.report_year <> a.year OR r.version <> a.report_version
                OR r.report_status <> 'locked' OR r.is_current_version <> true
            )
        """)).mappings())
        if conflicts:
            raise RuntimeError(f"Finalized allocation/report conflicts; read-only diagnostic: {conflicts}")
    # Complete diagnostics before creating any index. Never pick a winner.
    for name, predicate in LANES.items():
        conflicts = list(bind.execute(sa.text(f"SELECT team, report_month, report_year, COUNT(*) AS count FROM team_reports WHERE is_current_version = true AND ({predicate}) GROUP BY team, report_month, report_year HAVING COUNT(*) > 1")).mappings())
        if conflicts:
            raise RuntimeError(f"Current report lane conflicts ({name}); read-only diagnostic: {conflicts}")
    existing = {item["name"] for item in sa.inspect(bind).get_indexes("team_reports")}
    for name, predicate in LANES.items():
        if name not in existing:
            where = sa.text(f"is_current_version = true AND ({predicate})")
            op.create_index(name, "team_reports", ["team", "report_month", "report_year"], unique=True, sqlite_where=where, postgresql_where=where)

def downgrade():
    for name in LANES: op.drop_index(name, table_name="team_reports")
