"""Preview manifest-owned orphan files. Apply requires a paused-write maintenance window."""
import argparse
import json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--writers-paused", action="store_true")
    args = parser.parse_args()
    if args.apply and not args.writers_paused:
        parser.error("--apply requires --writers-paused after pausing all writers")
    from app.db.session import create_session
    from app.services.artifacts import reconcile_artifacts
    with create_session() as db:
        print(json.dumps(reconcile_artifacts(db, apply=args.apply, writers_paused=args.writers_paused), indent=2))


if __name__ == "__main__":
    main()
