-- 0001_audit_log.sql — append-only, tamper-evident compliance ledger (plan §4).
--
-- Hash chain: each row's hash = SHA-256(seq || prev_hash || decision_ref || actor || ts).
-- `seq` is application-assigned and MUST be contiguous (prev row's seq + 1) so the
-- chain can be verified by full scan. The DB enforces append-only; the app enforces
-- chain integrity.

CREATE TABLE IF NOT EXISTS audit_log (
    seq          BIGINT PRIMARY KEY,                -- app-assigned; 0 = genesis
    prev_hash    CHAR(64) NOT NULL,                 -- all-'0' for genesis
    hash         CHAR(64) NOT NULL,                 -- lowercase hex SHA-256
    decision_ref TEXT NOT NULL,                     -- Decision id this entry attests
    actor        TEXT NOT NULL CHECK (actor IN ('MODEL', 'RULE', 'HUMAN')),
    ts           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS audit_log_hash_idx ON audit_log (hash);
CREATE INDEX IF NOT EXISTS audit_log_decision_ref_idx ON audit_log (decision_ref);

-- Append-only enforcement: reject UPDATE and DELETE at the database level.
CREATE OR REPLACE FUNCTION audit_log_forbid_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only: % blocked', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_mutation ON audit_log;
CREATE TRIGGER audit_log_no_mutation
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_forbid_mutation();
