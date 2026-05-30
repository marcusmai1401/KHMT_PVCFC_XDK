"""Seed PVCFC-KNL competency frameworks into the OKR database.

Run from the backend folder:

    python scripts/seed_pvcfc_knl.py

The seed is idempotent. Use --force to create a new active version when the
current active framework is already referenced by assessments or learning plans.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from app.db.session import create_session
from app.services.bootstrap import create_schema
from app.services.pvcfc_knl_seed import seed_pvcfc_knl_frameworks


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--actor", default="admin", help="User id recorded in audit logs")
    parser.add_argument("--force", action="store_true", help="Force a new active version for referenced frameworks")
    args = parser.parse_args()

    create_schema()
    with create_session() as db:
        result = seed_pvcfc_knl_frameworks(db, actor_id=args.actor, force=args.force)
        db.commit()
    print(result)


if __name__ == "__main__":
    main()
