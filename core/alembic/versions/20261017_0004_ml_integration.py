"""Add ML catalog coverage and prediction dates.

Revision ID: 20261017_0004
Revises: 20261017_0003
"""

import sqlalchemy as sa

from alembic import op

revision = "20261017_0004"
down_revision = "20261017_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sites", sa.Column("ml_site_id", sa.String(length=80), nullable=True))
    op.add_column("sites", sa.Column("ml_model_version", sa.String(length=120), nullable=True))
    op.create_unique_constraint("uq_sites_ml_site_id", "sites", ["ml_site_id"])
    op.add_column("risk_scores", sa.Column("prediction_date", sa.Date(), nullable=True))
    op.execute("UPDATE risk_scores SET prediction_date = generated_at::date")
    op.alter_column("risk_scores", "prediction_date", nullable=False)
    op.drop_constraint("uq_risk_prediction", "risk_scores", type_="unique")
    op.create_unique_constraint(
        "uq_risk_prediction", "risk_scores", ["site_id", "prediction_date", "model_version"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_risk_prediction", "risk_scores", type_="unique")
    op.create_unique_constraint(
        "uq_risk_prediction", "risk_scores", ["site_id", "generated_at", "model_version"]
    )
    op.drop_column("risk_scores", "prediction_date")
    op.drop_constraint("uq_sites_ml_site_id", "sites", type_="unique")
    op.drop_column("sites", "ml_model_version")
    op.drop_column("sites", "ml_site_id")
