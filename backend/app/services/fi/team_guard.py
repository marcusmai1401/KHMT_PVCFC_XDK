from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.domain import FITeamWriteGuardModel


def _ensure_row(db: Session, team: str) -> None:
    """Create a cold guard without turning a read/preview into a write."""
    dialect = db.get_bind().dialect.name
    values = {"team": team, "revision": 0}
    if dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert

        db.execute(insert(FITeamWriteGuardModel).values(**values).on_conflict_do_nothing(index_elements=["team"]))
        return
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert

        db.execute(insert(FITeamWriteGuardModel).values(**values).on_conflict_do_nothing(index_elements=["team"]))
        return
    db.add(FITeamWriteGuardModel(**values))
    db.flush()


def get_fi_team_revision(db: Session, team: str) -> int:
    row = db.execute(
        select(FITeamWriteGuardModel.revision).where(FITeamWriteGuardModel.team == team)
    ).scalar_one_or_none()
    return int(row or 0)


def lock_fi_team(db: Session, team: str) -> FITeamWriteGuardModel:
    """Return the team's stable row under a write lock for a mutation."""
    row = db.execute(
        select(FITeamWriteGuardModel)
        .where(FITeamWriteGuardModel.team == team)
        .with_for_update().execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if row is None:
        _ensure_row(db, team)
        row = db.execute(
            select(FITeamWriteGuardModel)
            .where(FITeamWriteGuardModel.team == team)
            .with_for_update().execution_options(populate_existing=True)
        ).scalar_one()
    return row


def lock_fi_teams(db: Session, teams: set[str] | list[str] | tuple[str, ...]) -> dict[str, FITeamWriteGuardModel]:
    """Lock all affected team rows in one stable lexical order."""
    normalized = sorted({str(team).strip() for team in teams if str(team).strip()})
    return {team: lock_fi_team(db, team) for team in normalized}


def bump_fi_team_revision(db: Session, team: str) -> int:
    row = lock_fi_team(db, team)
    row.revision = int(row.revision or 0) + 1
    db.flush()
    return int(row.revision)
