-- Run only after GET /api/admin/system confirms timescaledb_available=true.
-- Timescale unique constraints must include the partitioning timestamp, so the
-- application retains its provider-event constraints in regular PostgreSQL by default.
CREATE EXTENSION IF NOT EXISTS timescaledb;

SELECT create_hypertable(
  'hazard_observations',
  by_range('observed_at'),
  if_not_exists => TRUE,
  migrate_data => TRUE
);

-- lightning_strikes remains a regular PostgreSQL table so provider+strike_id
-- can stay globally unique regardless of a provider timestamp correction.
