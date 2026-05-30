from __future__ import annotations

import json

from sqlalchemy import select

from app.models.et_domain import Personnel
from scripts.seed_et_personnel import seed_personnel


def test_et_personnel_seed_is_idempotent(db_session, tmp_path):
    seed_path = tmp_path / "et_personnel_seed.json"
    seed_path.write_text(
        json.dumps(
            {
                "source": "test",
                "personnel": [
                    {
                        "id": "person-seed-1",
                        "employee_code": "E001",
                        "full_name": "Seed Person",
                        "role": "Staff",
                        "position_code": "KNL_ĐK_14",
                        "team": "TBHTĐK",
                        "current_level": 3,
                        "salary_grade": "B3",
                        "status": "active",
                        "user_id": "admin",
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    first = seed_personnel(seed_path=seed_path)
    second = seed_personnel(seed_path=seed_path)

    row = db_session.execute(select(Personnel).where(Personnel.employee_code == "E001")).scalar_one()
    assert first == {"created": 1, "updated": 0, "skipped": 0}
    assert second == {"created": 0, "updated": 0, "skipped": 1}
    assert row.full_name == "Seed Person"
    assert row.position_code == "KNL_ĐK_14"
    assert row.current_level == 3
