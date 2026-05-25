"""Seed 56 user accounts for Xưởng Điều khiển.

Run inside the backend container:

    python scripts/seed_users_xuong_dk.py [--reset-passwords] [--default-password PWD]

Idempotent by default: existing users keep their current password unless
--reset-passwords is given. Newly-created users always start with
``must_change_password = True`` so the first login forces a password reset.
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from pathlib import Path

# Cho phép chạy script trực tiếp từ thư mục backend (python scripts/seed_users_xuong_dk.py)
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from app.core.security import Role, hash_password
from app.db.session import create_session
from app.models.domain import User
from app.services.bootstrap import create_schema
from app.services.repositories import audit


DEFAULT_PASSWORD = "PVCFC@123"
ADMIN_DISPLAY_NAME = "Quản trị hệ thống"

TEAM_DISPLAY = {
    "TBHTĐK": "Đội TBHTĐK",
    "TBCH": "Đội TBCH",
    "TBĐL": "Đội TBĐL",
    "TCĐK": "Tổ TCĐK",
    "Workshop_Staff": "Xưởng",
}


@dataclass(frozen=True)
class SeedUser:
    id: str
    full_name: str
    role: Role
    team: str | None
    title_suffix: str  # phần đuôi sau dấu "-" trong display_name

    @property
    def display_name(self) -> str:
        return f"{self.full_name} - {self.title_suffix}"


def _team_label(team_code: str) -> str:
    return TEAM_DISPLAY.get(team_code, team_code)


def _staff(full_name: str, user_id: str, team: str) -> SeedUser:
    return SeedUser(
        id=user_id,
        full_name=full_name,
        role=Role.STAFF,
        team=team,
        title_suffix=_team_label(team),
    )


SEED_USERS: list[SeedUser] = [
    # Workshop leader
    SeedUser("kiaq", "Quách Kía", Role.WORKSHOP_LEADER, "Workshop_Staff", "Quản đốc Xưởng"),
    # FI coordinator
    SeedUser("quyenpt", "Phạm Thanh Quyền", Role.FI_COORDINATOR, "TBHTĐK", "Đầu mối FI"),
    # Đội trưởng (Team_Account, team riêng)
    SeedUser("minhvq", "Võ Quang Minh", Role.TEAM_ACCOUNT, "TBHTĐK", "Đội trưởng TBHTĐK"),
    SeedUser("linhln", "Lý Ngọc Lĩnh", Role.TEAM_ACCOUNT, "TBCH", "Đội trưởng TBCH"),
    SeedUser("haint", "Nguyễn Thanh Hải", Role.TEAM_ACCOUNT, "TBĐL", "Đội trưởng TBĐL"),
    # Tổ trưởng Tổ TCĐK
    SeedUser("thanhdq", "Dương Quốc Thạnh", Role.TEAM_ACCOUNT, "TCĐK", "Tổ trưởng TCĐK"),
    SeedUser("doint", "Nguyễn Tấn Đời", Role.TEAM_ACCOUNT, "TCĐK", "Tổ trưởng TCĐK"),
    SeedUser("chienpq", "Phạm Quyết Chiến", Role.TEAM_ACCOUNT, "TCĐK", "Tổ trưởng TCĐK"),
    SeedUser("loitt", "Trịnh Thạnh Lợi", Role.TEAM_ACCOUNT, "TCĐK", "Tổ trưởng TCĐK"),
    # Staff - 46 người
    _staff("Trịnh Văn Kiều", "kieutv", "TBHTĐK"),
    _staff("Nguyễn Văn Vũ", "vunv", "TBCH"),
    _staff("Trần Chí Bằng", "bangtc", "TBĐL"),
    _staff("Phạm Minh Nhật", "nhatpm", "TBCH"),
    _staff("Hữu Văn Cưng", "cunghv", "TBCH"),
    _staff("Phạm Văn Tuyên", "tuyenpv", "TBCH"),
    _staff("Nguyễn Cao Minh", "minhnc", "TBHTĐK"),
    _staff("Võ Minh Hoàng", "hoangvm", "TBĐL"),
    _staff("Nguyễn Mạnh Quỳnh", "quynhnm", "TBHTĐK"),
    _staff("Lê Minh Hải", "hailm", "TBHTĐK"),
    _staff("Phan Thanh Sang", "sangpt", "TBĐL"),
    _staff("Nguyễn Văn Bình", "binhnv1", "TBCH"),
    _staff("Trần Tuyết Quyên", "quyentt", "Workshop_Staff"),
    _staff("Nguyễn Ngọc Sơn", "sonnn", "TBCH"),
    _staff("Trần Nhựt Quang", "quangtn", "TBĐL"),
    _staff("Nguyễn Quốc Toản", "toannq", "TCĐK"),
    _staff("Đinh Văn Triển", "triendv", "TCĐK"),
    _staff("Huỳnh Chí Hiền", "hienhc", "TBĐL"),
    _staff("Nguyễn Hữu Tiến", "tiennh", "TBHTĐK"),
    _staff("Trịnh Tấn Hưng", "hungtt", "TCĐK"),
    _staff("Cù Minh Thành", "thanhcm", "TBĐL"),
    _staff("Lê Đình Sơn", "sonld", "TBCH"),
    _staff("Đào Văn Khanh", "khanhdv1", "TBCH"),
    _staff("Dương Chí Chiến", "chiendc", "TCĐK"),
    _staff("Dương Văn Hằng", "hangdv", "TBCH"),
    _staff("Lê Bá Tứ", "tulb", "TBHTĐK"),
    _staff("Nguyễn Văn Hiếu", "hieunv", "TCĐK"),
    _staff("Trần Trung Hiếu", "hieutt", "TCĐK"),
    _staff("Nguyễn Mạnh Trung", "trungnm", "TCĐK"),
    _staff("Nguyễn Hoàng Mai", "mainh", "Workshop_Staff"),
    _staff("Lưu Quang Linh", "linhlq", "TBĐL"),
    _staff("Nguyễn Văn Ngà", "nganv", "TBĐL"),
    _staff("Đặng Trung Hậu", "haudt", "TCĐK"),
    _staff("Đào Văn Thành", "thanhdv", "TCĐK"),
    _staff("Hồ Đức Trung", "trunghd", "TBCH"),
    _staff("Phan Trung Kiên", "kienpt", "TBHTĐK"),
    _staff("Đàm Trung Hiếu", "hieudt2", "TBĐL"),
    _staff("Trần Trương Kiên", "kientt", "TBĐL"),
    _staff("Lê Hữu Duyên", "duyenlh", "TBCH"),
    _staff("Trần Khánh Hòa", "hoatk", "TCĐK"),
    _staff("Nguyễn Văn Đình", "dinhnv", "TBHTĐK"),
    _staff("Trịnh Phước Tùng", "tungtp", "TBĐL"),
    _staff("Ngô Thanh Lâm", "lamnt", "TBCH"),
    _staff("Trương Đức Anh", "anhtd", "TBCH"),
    _staff("Mai Thái Bảo", "baomt", "Workshop_Staff"),
    _staff("Lâm Phùng Phước Vinh", "vinhlpp", "Workshop_Staff"),
]

ADMIN_USER = SeedUser(
    id="admin",
    full_name=ADMIN_DISPLAY_NAME,
    role=Role.ADMIN,
    team=None,
    title_suffix="",
)


def _admin_display_name() -> str:
    return ADMIN_DISPLAY_NAME


def seed(default_password: str, reset_passwords: bool) -> dict[str, int]:
    create_schema()
    password_hash = hash_password(default_password)
    counts = {"created": 0, "updated": 0, "passwords_reset": 0, "skipped": 0}
    with create_session() as db:
        # Admin
        admin = db.get(User, ADMIN_USER.id)
        if admin is None:
            db.add(
                User(
                    id=ADMIN_USER.id,
                    display_name=_admin_display_name(),
                    full_name=_admin_display_name(),
                    password_hash=password_hash,
                    role=Role.ADMIN.value,
                    team=None,
                    is_active=True,
                    must_change_password=True,
                )
            )
            audit(db, "system", "Account", ADMIN_USER.id, "seed_admin", {"role": Role.ADMIN.value})
            counts["created"] += 1
        else:
            admin.display_name = _admin_display_name()
            admin.full_name = _admin_display_name()
            admin.role = Role.ADMIN.value
            admin.is_active = True
            if reset_passwords:
                admin.password_hash = password_hash
                admin.must_change_password = True
                counts["passwords_reset"] += 1
            counts["updated"] += 1

        # 55 users
        for user_seed in SEED_USERS:
            existing = db.get(User, user_seed.id)
            if existing is None:
                db.add(
                    User(
                        id=user_seed.id,
                        display_name=user_seed.display_name,
                        full_name=user_seed.full_name,
                        password_hash=password_hash,
                        role=user_seed.role.value,
                        team=user_seed.team,
                        is_active=True,
                        must_change_password=True,
                    )
                )
                audit(
                    db,
                    "system",
                    "Account",
                    user_seed.id,
                    "seed_xuong_dk_user",
                    {"role": user_seed.role.value, "team": user_seed.team},
                )
                counts["created"] += 1
            else:
                existing.display_name = user_seed.display_name
                existing.full_name = user_seed.full_name
                existing.role = user_seed.role.value
                existing.team = user_seed.team
                existing.is_active = True
                if reset_passwords:
                    existing.password_hash = password_hash
                    existing.must_change_password = True
                    counts["passwords_reset"] += 1
                counts["updated"] += 1
        db.commit()
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset-passwords", action="store_true", help="Reset all passwords to default and force change on next login")
    parser.add_argument("--default-password", default=DEFAULT_PASSWORD, help=f"Default password to assign (default: {DEFAULT_PASSWORD})")
    args = parser.parse_args()

    result = seed(args.default_password, args.reset_passwords)
    print(
        f"Seed complete: created={result['created']}, updated={result['updated']}, "
        f"passwords_reset={result['passwords_reset']}, skipped={result['skipped']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
