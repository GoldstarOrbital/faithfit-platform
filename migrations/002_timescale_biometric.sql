-- TimescaleDB hypertable for biometric time-series data
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE biometric_data (
  time TIMESTAMPTZ NOT NULL,
  user_id UUID REFERENCES users(id),
  heart_rate INT,
  hrv INT,
  steps INT,
  movement JSONB,
  gps GEOGRAPHY,
  stress_level INT,
  PRIMARY KEY (user_id, time)
);

SELECT create_hypertable('biometric_data', 'time', if_not_exists => TRUE);

-- Retention / compression (adjust per data governance policy)
SELECT add_compression_policy('biometric_data', INTERVAL '7 days', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_biometric_user_time ON biometric_data (user_id, time DESC);
