"""Merge supervisor into admin and rename crew to user.

Revision ID: 20261017_0005
Revises: 20261017_0004
"""

import sqlalchemy as sa

from alembic import op

revision = "20261017_0005"
down_revision = "20261017_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # SQLAlchemy persists enum member names, while API values are lowercase.
    op.execute("UPDATE user_accounts SET role = 'USER' WHERE role = 'CREW'")
    op.execute("UPDATE user_accounts SET role = 'ADMIN' WHERE role = 'SUPERVISOR'")
    with op.batch_alter_table("user_accounts") as batch:
        batch.alter_column(
            "role", existing_type=sa.String(10), type_=sa.String(5), existing_nullable=False
        )
        batch.create_check_constraint("userrole", "role IN ('USER', 'ADMIN')")


def downgrade() -> None:
    # The merged admin role cannot distinguish former supervisors from admins.
    # Keep every admin as ADMIN rather than guessing which accounts to demote.
    with op.batch_alter_table("user_accounts") as batch:
        batch.drop_constraint("userrole", type_="check")
        batch.alter_column(
            "role", existing_type=sa.String(5), type_=sa.String(10), existing_nullable=False
        )
    op.execute("UPDATE user_accounts SET role = 'CREW' WHERE role = 'USER'")
