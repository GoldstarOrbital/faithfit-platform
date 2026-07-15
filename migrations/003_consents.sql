-- Explicit consent required before ingesting biometrics or personalizing scripture (spec section 3).
CREATE TABLE user_consents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  scope TEXT NOT NULL, -- e.g. 'biometric_ingest', 'scripture_personalization'
  granted_at TIMESTAMP DEFAULT now(),
  revoked_at TIMESTAMP
);
CREATE INDEX idx_user_consents_user_scope ON user_consents (user_id, scope);
