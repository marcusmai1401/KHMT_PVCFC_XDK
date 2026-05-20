from logging.config import fileConfig

from alembic import context

from app.core.config import settings
from app.db.session import Base
from app.models import domain  # noqa: F401
from app.models import et_domain  # noqa: F401

config = context.config
config.set_main_option("sqlalchemy.url", settings.effective_database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.effective_database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    from sqlalchemy import create_engine

    connect_args = {"check_same_thread": False} if settings.effective_database_url.startswith("sqlite") else {}
    engine = create_engine(settings.effective_database_url, pool_pre_ping=True, connect_args=connect_args)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
