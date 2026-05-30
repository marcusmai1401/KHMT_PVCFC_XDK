from __future__ import annotations

from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import Role, hash_password
from app.db.session import Base, engine
from app.models.domain import (
    KRMappingModel,
    SystemConfigModel,
    TeamHeadcountModel,
    TemplateModel,
    User,
    VHDNExemptionModel,
)
from app.models import et_domain  # noqa: F401
from app.services.okr.constants import BASELINE_HEADCOUNT, FIXED_VHDN_EXEMPTIONS, WORKSHOP_STAFF_HEADCOUNT
from app.services.okr.kr_mapping import load_master_kr_mapping
from app.services.repositories import audit, make_id


DEMO_USERS = [
    {
        "id": "admin",
        "display_name": "Demo Admin",
        "password": "admin-pass",
        "role": Role.ADMIN,
    },
    {
        "id": "leader",
        "display_name": "Lãnh đạo Xưởng",
        "password": "leader-pass",
        "role": Role.WORKSHOP_LEADER,
        "team": "Workshop_Staff",
    },
    {
        "id": "fi",
        "display_name": "Đầu mối SK",
        "password": "fi-pass",
        "role": Role.FI_COORDINATOR,
        "team": "TBHTĐK",
    },
    {
        "id": "TBHTĐK",
        "display_name": "TBHTĐK",
        "password": "tbhtdk-pass",
        "role": Role.TEAM_ACCOUNT,
        "team": "TBHTĐK",
    },
    {
        "id": "TBCH",
        "display_name": "TBCH",
        "password": "tbch-pass",
        "role": Role.TEAM_ACCOUNT,
        "team": "TBCH",
    },
    {
        "id": "TBĐL",
        "display_name": "TBĐL",
        "password": "tbdl-pass",
        "role": Role.TEAM_ACCOUNT,
        "team": "TBĐL",
    },
    {
        "id": "TCĐK",
        "display_name": "TCĐK",
        "password": "tcdk-pass",
        "role": Role.TEAM_ACCOUNT,
        "team": "TCĐK",
    },
]

LEGACY_DEMO_USER_IDS = {"user"}


def create_schema() -> None:
    Base.metadata.create_all(bind=engine)
    _ensure_sqlite_web_input_columns()
    _ensure_user_extra_columns()
    _ensure_personnel_extra_columns()
    _ensure_competency_item_text_columns()
    _ensure_sk_ctkt_completed_at_column()


def _ensure_sqlite_web_input_columns() -> None:
    if engine.dialect.name != "sqlite":
        return
    inspector = inspect(engine)
    if "team_reports" not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns("team_reports")}
    statements = {
        "source_type": "ALTER TABLE team_reports ADD COLUMN source_type VARCHAR NOT NULL DEFAULT 'excel_upload'",
        "report_status": "ALTER TABLE team_reports ADD COLUMN report_status VARCHAR NOT NULL DEFAULT 'draft'",
        "arising_work": "ALTER TABLE team_reports ADD COLUMN arising_work JSON NOT NULL DEFAULT '[]'",
        "locked_at": "ALTER TABLE team_reports ADD COLUMN locked_at DATETIME",
        "locked_by": "ALTER TABLE team_reports ADD COLUMN locked_by VARCHAR",
        "lock_reason": "ALTER TABLE team_reports ADD COLUMN lock_reason TEXT",
        "submitted_at": "ALTER TABLE team_reports ADD COLUMN submitted_at DATETIME",
        "last_auto_save": "ALTER TABLE team_reports ADD COLUMN last_auto_save DATETIME",
    }
    with engine.begin() as connection:
        for column_name, statement in statements.items():
            if column_name not in existing:
                connection.execute(text(statement))
        if "report_status" not in existing:
            connection.execute(text("UPDATE team_reports SET report_status = 'submitted' WHERE source_type = 'excel_upload'"))


def _ensure_sk_ctkt_completed_at_column() -> None:
    if engine.dialect.name != "sqlite":
        return
    inspector = inspect(engine)
    if "sk_ctkt" not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns("sk_ctkt")}
    if "completed_at" in existing:
        return
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE sk_ctkt ADD COLUMN completed_at DATETIME"))


def _ensure_personnel_extra_columns() -> None:
    if engine.dialect.name != "sqlite":
        return
    inspector = inspect(engine)
    if "personnel" not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns("personnel")}
    statements = {
        "role": "ALTER TABLE personnel ADD COLUMN role VARCHAR",
        "salary_grade": "ALTER TABLE personnel ADD COLUMN salary_grade VARCHAR",
    }
    with engine.begin() as connection:
        for column_name, statement in statements.items():
            if column_name not in existing:
                connection.execute(text(statement))


def _ensure_competency_item_text_columns() -> None:
    if engine.dialect.name != "sqlite":
        return
    inspector = inspect(engine)
    if "competency_items" not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns("competency_items")}
    statements = {
        "definition": "ALTER TABLE competency_items ADD COLUMN definition TEXT",
        "requirements_text": "ALTER TABLE competency_items ADD COLUMN requirements_text TEXT",
    }
    with engine.begin() as connection:
        for column_name, statement in statements.items():
            if column_name not in existing:
                connection.execute(text(statement))


def _ensure_user_extra_columns() -> None:
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns("users")}
    dialect = engine.dialect.name
    bool_default = "0" if dialect == "sqlite" else "false"
    statements = {
        "full_name": "ALTER TABLE users ADD COLUMN full_name VARCHAR",
        "team": "ALTER TABLE users ADD COLUMN team VARCHAR",
        "must_change_password": f"ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT {bool_default}",
    }
    with engine.begin() as connection:
        for column_name, statement in statements.items():
            if column_name not in existing:
                connection.execute(text(statement))


def seed_baseline(db: Session) -> None:
    _ensure_competency_item_text_columns()
    _seed_admin(db)
    db.flush()
    _seed_demo_users(db)
    if settings.environment == "development":
        from app.services.pvcfc_knl_seed import seed_pvcfc_knl_frameworks

        seed_pvcfc_knl_frameworks(db, actor_id="admin")
    _seed_kr_mapping(db)
    _seed_headcounts(db)
    _seed_exemptions(db)
    _seed_config(db)
    _seed_template(db)
    db.commit()


def _seed_admin(db: Session) -> None:
    has_user = db.execute(select(User.id).limit(1)).first()
    if has_user or not settings.bootstrap_admin_id or not settings.bootstrap_admin_password:
        return
    user = User(
        id=settings.bootstrap_admin_id,
        display_name=settings.bootstrap_admin_name,
        password_hash=hash_password(settings.bootstrap_admin_password),
        role=Role.ADMIN.value,
        is_active=True,
    )
    db.add(user)
    audit(db, "system", "Account", user.id, "bootstrap_admin", {"role": user.role})


def _seed_demo_users(db: Session) -> None:
    if settings.environment != "development":
        return
    for user_id in LEGACY_DEMO_USER_IDS:
        user = db.get(User, user_id)
        if user is None:
            continue
        user.display_name = "Tài khoản đội/tổ cũ (ngưng dùng)"
        user.role = Role.TEAM_ACCOUNT.value
        user.is_active = False
    for item in DEMO_USERS:
        user = db.get(User, item["id"])
        password_hash = hash_password(str(item["password"]))
        role = item["role"].value
        if user is None:
            db.add(
                User(
                    id=str(item["id"]),
                    display_name=str(item["display_name"]),
                    full_name=str(item["display_name"]),
                    password_hash=password_hash,
                    role=role,
                    team=item.get("team"),
                    is_active=True,
                )
            )
            audit(db, "system", "Account", str(item["id"]), "seed_demo_user", {"role": role})
            continue
        user.display_name = str(item["display_name"])
        user.full_name = str(item["display_name"])
        user.password_hash = password_hash
        user.role = role
        user.team = item.get("team")
        user.is_active = True


def _seed_kr_mapping(db: Session) -> None:
    if db.execute(select(KRMappingModel.workshop_kr_code).limit(1)).first():
        return
    for item in load_master_kr_mapping():
        db.add(
            KRMappingModel(
                workshop_kr_code=item.workshop_kr_code,
                kr_name=item.kr_name,
                dashboard_column=item.dashboard_column,
                measurement_type=item.measurement_type,
                target_value=item.target_value,
                source_row=item.source_row,
            )
        )


def _seed_headcounts(db: Session) -> None:
    if db.execute(select(TeamHeadcountModel.id).limit(1)).first():
        return
    exemptions_by_team = {
        team: sum(1 for exemption in FIXED_VHDN_EXEMPTIONS if exemption["team"] == team)
        for team in BASELINE_HEADCOUNT
    }
    for team, count in BASELINE_HEADCOUNT.items():
        db.add(
            TeamHeadcountModel(
                id=make_id("headcount"),
                team=team,
                total_headcount=count,
                vhdn_eligible_headcount=count - exemptions_by_team.get(team, 0),
                notes="Seed baseline 2026",
            )
        )
    db.add(
        TeamHeadcountModel(
            id=make_id("headcount"),
            team="Workshop_Staff",
            total_headcount=WORKSHOP_STAFF_HEADCOUNT,
            vhdn_eligible_headcount=WORKSHOP_STAFF_HEADCOUNT,
            notes="Workshop staff is not displayed in OKR dashboard matrix",
        )
    )


def _seed_exemptions(db: Session) -> None:
    if db.execute(select(VHDNExemptionModel.id).limit(1)).first():
        return
    for item in FIXED_VHDN_EXEMPTIONS:
        db.add(
            VHDNExemptionModel(
                id=make_id("exemption"),
                personnel_name=item["personnel_name"],
                team=item["team"],
                exemption_reason=item["exemption_reason"],
                is_active=True,
            )
        )


def _seed_config(db: Session) -> None:
    defaults = {
        "submission_deadline_day": 25,
        "notification_channel": "in-system",
    }
    for key, value in defaults.items():
        if db.get(SystemConfigModel, key) is None:
            db.add(SystemConfigModel(key=key, value=value, updated_by="system"))


def _seed_template(db: Session) -> None:
    if db.get(TemplateModel, "standard-template") is not None:
        return
    db.add(
        TemplateModel(
            id="standard-template",
            name="Standard OKR Team Report Template",
            definition={
                "columns": [
                    "STT",
                    "Workshop_KR_Code",
                    "Team_KR_Code",
                    "KR_Name",
                    "Measurement",
                    "Target",
                    "Frequency",
                    "Weight",
                    "Action_Plan",
                    "Start_Date",
                    "End_Date",
                    "Responsible_Person",
                    "Reviewer",
                    "Implementation_Report",
                    "KR_Assessment",
                    "Notes",
                ],
                "team_level_fields": [
                    "Discipline_Status",
                    "Discipline_Description",
                    "Related_KR",
                    "Objective_Reasons",
                    "Monthly_Assessment",
                ],
            },
            updated_by="system",
        )
    )
