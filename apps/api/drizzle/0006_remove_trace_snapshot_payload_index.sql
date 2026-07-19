-- Atlas snapshots are durable audit artifacts, not B-tree index keys.
-- Canvas data URLs can exceed PostgreSQL's maximum B-tree index entry size.
DROP INDEX IF EXISTS trace_snapshots_session_payload_idx;
