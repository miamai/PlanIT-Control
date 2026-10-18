from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import IntegrityError


def test_two_role_migration_preserves_accounts_and_rejects_legacy_roles() -> None:
    path = Path(__file__).resolve().parents[1] / "alembic/versions/20261017_0005_two_roles.py"
    spec = importlib.util.spec_from_file_location("two_roles", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    accounts = sa.Table(
        "user_accounts",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("status", sa.String, nullable=False),
        sa.Column("password_hash", sa.String, nullable=False),
        sa.Column("deleted_at", sa.String),
    )
    sa.Index("ix_user_accounts_role", accounts.c.role)
    original = [
        {
            "id": "field",
            "role": "CREW",
            "status": "ACTIVE",
            "password_hash": "original-hash",
            "deleted_at": None,
        },
        {
            "id": "supervisor",
            "role": "SUPERVISOR",
            "status": "ACTIVE",
            "password_hash": "original-hash",
            "deleted_at": None,
        },
        {
            "id": "disabled",
            "role": "SUPERVISOR",
            "status": "DISABLED",
            "password_hash": "original-hash",
            "deleted_at": None,
        },
        {
            "id": "deleted",
            "role": "CREW",
            "status": "DISABLED",
            "password_hash": "original-hash",
            "deleted_at": "2026-10-17",
        },
        {
            "id": "admin",
            "role": "ADMIN",
            "status": "ACTIVE",
            "password_hash": "original-hash",
            "deleted_at": None,
        },
    ]
    with engine.begin() as connection:
        metadata.create_all(connection)
        connection.execute(accounts.insert(), original)
        context = MigrationContext.configure(connection)
        with Operations.context(context):
            migration.upgrade()
        rows = connection.execute(sa.select(accounts)).mappings().all()
        assert len(rows) == len(original)
        expected = {"CREW": "USER", "SUPERVISOR": "ADMIN", "ADMIN": "ADMIN"}
        for old in original:
            row = next(row for row in rows if row["id"] == old["id"])
            assert dict(row) == {**old, "role": expected[old["role"]]}
        assert "ix_user_accounts_role" in {
            index["name"] for index in sa.inspect(connection).get_indexes("user_accounts")
        }
        for legacy in ("CREW", "SUPERVISOR", "UNKNOWN"):
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.execute(
                    accounts.update().where(accounts.c.id == "field").values(role=legacy)
                )
        with Operations.context(context):
            migration.downgrade()
        roles = dict(connection.execute(sa.select(accounts.c.id, accounts.c.role)).all())
        assert roles == {
            "field": "CREW",
            "supervisor": "ADMIN",
            "disabled": "ADMIN",
            "deleted": "CREW",
            "admin": "ADMIN",
        }
    engine.dispose()
