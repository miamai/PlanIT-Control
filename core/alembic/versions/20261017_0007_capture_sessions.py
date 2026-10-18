"""Add guided photo capture sessions and their evidence frames.

Revision ID: 20261017_0007
Revises: 20261017_0006
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261017_0007"
down_revision: str | None = "20261017_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "capture_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("site_id", sa.Uuid(), nullable=False),
        sa.Column("reporter_subject", sa.String(length=255), nullable=False),
        sa.Column(
            "hazard_type",
            sa.Enum(
                "WEATHER",
                "HEAT",
                "LIGHTNING",
                "FLOOD",
                "WILDFIRE",
                "SOIL",
                "WILDLIFE",
                name="hazardtype",
                native_enum=False,
            ),
            nullable=True,
        ),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("steps", sa.JSON(), nullable=False),
        sa.Column("danger", sa.JSON(), nullable=True),
        sa.Column("frame_checks", sa.Integer(), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("report_id", sa.Uuid(), nullable=True),
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
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["report_id"], ["crew_reports.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_capture_sessions_reporter_subject", "capture_sessions", ["reporter_subject"]
    )
    op.create_table(
        "capture_frames",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("item", sa.String(length=32), nullable=False),
        sa.Column("image", sa.LargeBinary(), nullable=False),
        sa.Column("content_type", sa.String(length=32), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("heading_deg", sa.Float(), nullable=True),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["capture_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_capture_frames_session_id", "capture_frames", ["session_id"])


def downgrade() -> None:
    op.drop_index("ix_capture_frames_session_id", table_name="capture_frames")
    op.drop_table("capture_frames")
    op.drop_index("ix_capture_sessions_reporter_subject", table_name="capture_sessions")
    op.drop_table("capture_sessions")
