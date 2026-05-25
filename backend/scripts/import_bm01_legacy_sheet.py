from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import argparse

from sqlalchemy import and_, or_, select

from app.db.session import create_session
from app.models.domain import SKCTKTModel
from app.services.fi.completion import completion_plan_completed_at
from app.services.fi.workflow import SKStatus
from app.services.integration.bm01_import import SHEET_TEAM, build_bm01_status_history, preview_bm01
from app.services.repositories import make_id


def parse_sheet(workbook_path: Path, sheet_name: str, year: int) -> list[dict]:
    preview_rows = [
        row
        for row in preview_bm01(workbook_path)["rows"]
        if row["source_sheet"] == sheet_name
    ]
    return [
        {
            "source_row": row["source_row"],
            "month_raw": None,
            "registration_month": row["registration_month"],
            "registration_year": year,
            "author_name": row["author_name"],
            "title": row["title"],
            "content_description": row["content_description"],
            "completion_plan": row["completion_plan"],
            "completion_done": row["completion_done"],
            "review": row["raw_conclusion"],
            "leader_conclusion": row["workshop_leader_conclusion"],
            "khmt_raw": row["khmt_raw"],
            "khmt_month": row["khmt_month"],
            "khmt_year": year if row["consider_for_khmt"] and row["khmt_month"] else None,
            "consider_for_khmt": row["consider_for_khmt"],
            "status": row["status"],
        }
        for row in preview_rows
    ]


def import_rows(
    rows: list[dict],
    *,
    source_label: str,
    sheet_name: str,
    team: str,
    year: int,
    imported_by: str,
) -> tuple[int, int]:
    inserted = 0
    updated = 0
    with create_session() as db:
        for item in rows:
            sk_code = f"HIST-{team}-{sheet_name}-{item['source_row']}"
            record = db.execute(
                select(SKCTKTModel).where(
                    or_(
                        SKCTKTModel.sk_code == sk_code,
                        and_(
                            SKCTKTModel.bm01_source_file == source_label,
                            SKCTKTModel.bm01_source_sheet == sheet_name,
                            SKCTKTModel.bm01_source_row == item["source_row"],
                        ),
                    )
                )
            ).scalar_one_or_none()
            created_at = datetime(year, item["registration_month"], 1, tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
            completed_at = completion_plan_completed_at(item["completion_plan"], fallback=created_at)
            is_approved = item["status"] in {SKStatus.APPROVED.value, SKStatus.COMPLETED.value}
            consider_for_khmt = bool(item["consider_for_khmt"])
            khmt_year = item["khmt_year"] if consider_for_khmt else None
            history = build_bm01_status_history(
                {
                    **item,
                    "raw_conclusion": item["review"],
                    "consider_for_khmt": consider_for_khmt,
                    "khmt_year": khmt_year,
                },
                imported_by=imported_by,
                imported_at=now,
            )
            values = {
                "sk_code": sk_code,
                "title": item["title"],
                "author_name": item["author_name"],
                "author_user_id": "historical-import",
                "team": team,
                "content_description": item["content_description"],
                "completion_plan": item["completion_plan"],
                "status": item["status"],
                "status_history": history,
                "fi_coordinator_comments": item["review"] or None,
                "workshop_leader_conclusion": item["leader_conclusion"] or None,
                "decision_note": None,
                "consider_for_khmt": consider_for_khmt,
                "khmt_month": item["khmt_month"] if consider_for_khmt else None,
                "khmt_year": khmt_year,
                "is_public": is_approved,
                "is_counted_for_okr": consider_for_khmt,
                "is_historical_import": True,
                "bm01_source_file": source_label,
                "bm01_source_sheet": sheet_name,
                "bm01_source_row": item["source_row"],
                "bm01_raw_conclusion": item["review"],
                "created_at": created_at,
                "updated_at": now,
                "submitted_at": created_at,
                "reviewed_at": now
                if item["status"] in {SKStatus.APPROVED.value, SKStatus.REJECTED.value, SKStatus.DEFERRED.value}
                else None,
                "approved_at": now if item["status"] == SKStatus.APPROVED.value else None,
                "completed_at": completed_at,
            }
            if record is None:
                db.add(SKCTKTModel(id=make_id("sk"), **values))
                inserted += 1
            else:
                for key, value in values.items():
                    setattr(record, key, value)
                updated += 1
        db.commit()
    return inserted, updated


def main() -> int:
    parser = argparse.ArgumentParser(description="Import one legacy BM01 sheet into SK-CTKT records")
    parser.add_argument("workbook")
    parser.add_argument("--sheet", required=True, choices=sorted(SHEET_TEAM))
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--expected-count", type=int)
    parser.add_argument("--source-label", default="FI xlsx/BM 01 Dang ky - Danh gia SK _Rev1.xlsx")
    parser.add_argument("--imported-by", default="bm01-legacy-import")
    parser.add_argument("--no-commit", action="store_true")
    args = parser.parse_args()

    team = SHEET_TEAM[args.sheet]
    rows = parse_sheet(Path(args.workbook), args.sheet, args.year)
    if args.expected_count is not None and len(rows) != args.expected_count:
        raise SystemExit(f"Expected {args.expected_count} rows, got {len(rows)}. Abort.")
    missing_month_rows = [item["source_row"] for item in rows if item["registration_month"] is None]
    if missing_month_rows:
        raise SystemExit(f"Rows without registration month: {missing_month_rows}. Abort.")

    if args.no_commit:
        inserted = updated = 0
    else:
        inserted, updated = import_rows(
            rows,
            source_label=args.source_label,
            sheet_name=args.sheet,
            team=team,
            year=args.year,
            imported_by=args.imported_by,
        )

    print(f"Imported {args.sheet} -> {team}: inserted={inserted}, updated={updated}, total={len(rows)}")
    for item in rows:
        print(
            f"row={item['source_row']:02d} "
            f"month=T{item['registration_month']}/{args.year} "
            f"status={item['status']:<9} "
            f"author={item['author_name'][:24]} "
            f"title={item['title'][:70]}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
