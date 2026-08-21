-- 0002_backend_core.sql — backend-core persistence (WS-B).
-- audit_log lives in 0001_audit_log.sql (append-only, hash-chained).

CREATE TABLE IF NOT EXISTS payment_failed_events (
    stripe_id     TEXT PRIMARY KEY,
    customer_id   TEXT NOT NULL,
    amount_minor  BIGINT NOT NULL CHECK (amount_minor > 0),
    currency      TEXT NOT NULL,
    decline_code  TEXT NOT NULL,
    attempt       INT  NOT NULL CHECK (attempt >= 1),
    card_brand    TEXT NOT NULL,
    ts            TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS payment_failed_events_scope_idx
    ON payment_failed_events (customer_id, card_brand, ts);

CREATE TABLE IF NOT EXISTS replay_streams (
    stream_id  TEXT PRIMARY KEY,
    events     JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS replay_runs (
    run_id     TEXT PRIMARY KEY,
    stream_id  TEXT NOT NULL REFERENCES replay_streams(stream_id),
    record     JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
