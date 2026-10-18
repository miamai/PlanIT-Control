"""Add local JWT accounts and scoped provider runs.

Revision ID: 20261017_0002
Revises: 20261017_0001
"""

import sqlalchemy as sa

from alembic import op

revision = "20261017_0002"
down_revision = "20261017_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_accounts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=True),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column(
            "role",
            sa.Enum("CREW", "SUPERVISOR", "ADMIN", name="userrole", native_enum=False),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum("ACTIVE", "DISABLED", name="userstatus", native_enum=False),
            nullable=False,
        ),
        sa.Column("must_change_password", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_accounts_username", "user_accounts", ["username"], unique=True)
    op.create_index("ix_user_accounts_role", "user_accounts", ["role"], unique=False)
    op.create_index("ix_user_accounts_status", "user_accounts", ["status"], unique=False)
    op.create_index("ix_user_accounts_deleted_at", "user_accounts", ["deleted_at"], unique=False)
    op.create_table(
        "refresh_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("replaced_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["user_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_refresh_sessions_user_id", "refresh_sessions", ["user_id"], unique=False)
    op.create_index(
        "ix_refresh_sessions_user_expiry",
        "refresh_sessions",
        ["user_id", "expires_at"],
        unique=False,
    )
    op.add_column(
        "provider_runs",
        sa.Column("scope", sa.JSON(), server_default=sa.text("'{}'::json"), nullable=False),
    )
    op.alter_column("provider_runs", "scope", server_default=None)


def downgrade() -> None:
    op.drop_column("provider_runs", "scope")
    op.drop_index("ix_refresh_sessions_user_expiry", table_name="refresh_sessions")
    op.drop_index("ix_refresh_sessions_user_id", table_name="refresh_sessions")
    op.drop_table("refresh_sessions")
    op.drop_index("ix_user_accounts_deleted_at", table_name="user_accounts")
    op.drop_index("ix_user_accounts_status", table_name="user_accounts")
    op.drop_index("ix_user_accounts_role", table_name="user_accounts")
    op.drop_index("ix_user_accounts_username", table_name="user_accounts")
    op.drop_table("user_accounts")
