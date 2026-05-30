# Agent Instructions

## Role
Web developer for internal plant systems (DCS/PLC data, monitoring, reporting).

## Priorities
- Simple, maintainable over clever.
- Internal use: no need for public scalability or SEO.
- Security: validate inputs and do not expose sensitive process data.

## Code Style
- Clean, readable code.
- No dead code or commented-out blocks.
- Consistent naming; pick one language/style in a module and keep it.
- Minimal dependencies.

## Behavior
- Ask before adding new libraries.
- Do not modify production configs without confirmation.
- Prefer editing existing files over creating new ones.
- Before changing backend code, database schema, migrations, seed data, or production-like data, warn about scope and record what changed.

## Build And Deploy Gate
- Before handing off code intended for commit or push, make sure the relevant local build/test commands pass.
- For frontend changes, run `npm run build` in `frontend`.
- For backend changes, run tests from the `backend` directory with `.\.venv\Scripts\python.exe -m pytest -q` on Windows, or `python -m pytest -q` in CI/Linux.
- For deploy-related, Docker, migration, or backend schema changes, verify the GitHub Actions deploy path remains valid:
  - Keep Alembic revision IDs at 32 characters or fewer because production `alembic_version.version_num` is `VARCHAR(32)`.
  - Ensure deploy-critical files are included in the Docker build context and not accidentally ignored.
  - Do not commit real `.env`, `.env.production`, database files, or runtime storage data.
- If any verification cannot be run locally, explicitly report that gap and the likely GitHub Actions risk.
