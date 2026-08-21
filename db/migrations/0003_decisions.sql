-- 0003_decisions.sql — persisted decision feed (plan §3: /api/decisions +
-- stored SHAP explanations). The full Decision (contract-shaped JSON) is kept
-- in `record`; created_at orders the feed newest-first.

CREATE TABLE IF NOT EXISTS decisions (
    payment_id TEXT PRIMARY KEY,
    record     JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
