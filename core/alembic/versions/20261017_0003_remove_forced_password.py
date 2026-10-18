"""Remove forced password changes.

Revision ID: 20261017_0003
Revises: 20261017_0002
"""

import sqlalchemy as sa

from alembic import op

revision = "20261017_0003"
down_revision = "20261017_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("user_accounts", "must_change_password")


def downgrade() -> None:
    op.add_column(
        "user_accounts",
        sa.Column(
            "must_change_password",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )
    op.alter_column("user_accounts", "must_change_password", server_default=None)
