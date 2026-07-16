from datetime import datetime, timezone

from sqlalchemy import select

from app.core.config import settings
from app.db.session import create_session
from app.models.domain import (
    AuditLogModel,
    HistoricalSnapshotModel,
    NotificationModel,
    SKCTKTModel,
    SKCodeSequenceModel,
    SKImageModel,
    TeamMonthlySummaryModel,
    TeamReportModel,
    WarningModel,
)
from app.models.et_domain import Personnel
from scripts.reset_demo_data import reset_demo_data


def _report(report_id: str, source_type: str, month: int, file_path: str) -> TeamReportModel:
    return TeamReportModel(
        id=report_id,
        team="TBCH",
        report_month=month,
        report_year=2026,
        file_name=f"{report_id}.xlsx",
        file_path=file_path,
        file_hash=report_id,
        version=1,
        is_current_version=True,
        uploaded_by="admin",
        sheet_name="TBCH",
        assessments=[],
        team_level={},
        source_cell_references=[],
        source_type=source_type,
        report_status="submitted",
    )


def test_reset_demo_data_preserves_verified_historical_imports(db_session, tmp_path, monkeypatch):
    storage_dir = tmp_path / "storage"
    upload_dir = storage_dir / "uploads"
    export_dir = storage_dir / "exports"
    image_dir = upload_dir / "images"
    image_dir.mkdir(parents=True)
    export_dir.mkdir(parents=True)
    monkeypatch.setattr(settings, "workspace_dir", tmp_path)
    monkeypatch.setattr(settings, "storage_dir", storage_dir)

    historical_file = tmp_path / "KHMT_Monthly" / "OKR tháng 01-2026 - X.ĐK.xlsx"
    historical_file.parent.mkdir()
    historical_file.write_text("verified", encoding="utf-8")
    demo_upload = upload_dir / "demo.xlsx"
    demo_upload.write_text("demo", encoding="utf-8")
    demo_image = image_dir / "evidence.png"
    demo_image.write_text("image", encoding="utf-8")
    demo_export = export_dir / "okr-dashboard-export.xlsx"
    demo_export.write_text("export", encoding="utf-8")

    db_session.add(_report("report-historical", "historical_import", 1, str(historical_file)))
    db_session.add(_report("report-demo", "web_input", 5, str(demo_upload)))
    db_session.add(
        WarningModel(
            id="warn-historical",
            team_report_id="report-historical",
            warning_type="LOW_CONFIDENCE_EXTRACTION",
            severity="LOW",
            source_cell=None,
            extracted_value=None,
            reason="Historical warning",
        )
    )
    db_session.add(
        WarningModel(
            id="warn-demo",
            team_report_id="report-demo",
            warning_type="DEMO",
            severity="LOW",
            source_cell=None,
            extracted_value=None,
            reason="Demo warning",
        )
    )
    db_session.add(
        TeamMonthlySummaryModel(id="summary-historical", team="TBCH", month=1, year=2026, monthly_assessment="OK")
    )
    db_session.add(
        TeamMonthlySummaryModel(id="summary-demo", team="TBCH", month=5, year=2026, monthly_assessment="Demo")
    )
    db_session.add(
        HistoricalSnapshotModel(
            id="snapshot-historical",
            source_file_name="historical.xlsx",
            source_file_hash="hash-historical",
            source_sheet="Dashboard",
            source_range="A1:B2",
            team="TBCH",
            month=1,
            year=2026,
            imported_by="admin",
        )
    )
    db_session.add(
        HistoricalSnapshotModel(
            id="snapshot-demo",
            source_file_name="demo.xlsx",
            source_file_hash="hash-demo",
            source_sheet="Dashboard",
            source_range="A1:B2",
            team="TBCH",
            month=5,
            year=2026,
            imported_by="admin",
        )
    )
    db_session.add(
        SKCTKTModel(
            id="sk-demo",
            sk_code="FI-2026-TBCH-0001",
            title="Demo SK",
            author_name="Demo",
            author_user_id="TBCH",
            team="TBCH",
            content_description="Demo",
            completion_plan="T5/2026",
            status="Draft",
            status_history=[],
            is_historical_import=False,
        )
    )
    db_session.add(
        SKImageModel(
            id="image-demo",
            sk_ctkt_id="sk-demo",
            file_name="evidence.png",
            file_path=str(demo_image),
            file_size=5,
            uploaded_by="TBCH",
        )
    )
    db_session.add(SKCodeSequenceModel(prefix="FI-2026-TBCH", next_value=2))
    db_session.add(
        Personnel(
            id="person-demo",
            employee_code="E001",
            full_name="Demo Person",
            position_code="XDK",
            team="TBCH",
            current_level=1,
        )
    )
    db_session.add(NotificationModel(id="notif-demo", event="DEMO", payload={}))
    db_session.add(
        AuditLogModel(
            id="audit-demo",
            actor="admin",
            entity_type="Demo",
            entity_id="demo",
            action="create",
            changes={},
            created_at=datetime.now(timezone.utc),
        )
    )
    db_session.commit()
    db_session.close()

    counts = reset_demo_data()

    with create_session() as db:
        assert db.get(TeamReportModel, "report-historical") is not None
        assert db.get(TeamReportModel, "report-demo") is None
        assert db.get(WarningModel, "warn-historical") is not None
        assert db.get(WarningModel, "warn-demo") is None
        assert db.get(TeamMonthlySummaryModel, "summary-historical") is not None
        assert db.get(TeamMonthlySummaryModel, "summary-demo") is None
        assert db.get(HistoricalSnapshotModel, "snapshot-historical") is not None
        assert db.get(HistoricalSnapshotModel, "snapshot-demo") is None
        assert db.get(SKCTKTModel, "sk-demo") is None
        assert db.get(SKImageModel, "image-demo") is None
        assert db.get(Personnel, "person-demo") is None
        assert not db.scalars(select(NotificationModel)).all()
        assert not db.scalars(select(AuditLogModel)).all()

    assert historical_file.exists()
    assert not demo_upload.exists()
    assert not demo_image.exists()
    assert not demo_export.exists()
    assert counts["okr_team_reports"] == 1
    assert counts["okr_warnings"] == 1
