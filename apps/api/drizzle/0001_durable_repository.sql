ALTER TABLE sessions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS generated_items_session_idx ON generated_items(session_id);
CREATE INDEX IF NOT EXISTS trace_snapshots_session_created_idx ON trace_snapshots(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS trace_snapshots_session_payload_idx ON trace_snapshots(session_id, atlas_snapshot, created_at);
