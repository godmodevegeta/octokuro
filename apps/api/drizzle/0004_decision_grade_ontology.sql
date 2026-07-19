ALTER TABLE ontology_concepts ADD COLUMN IF NOT EXISTS track text NOT NULL DEFAULT 'legacy';
ALTER TABLE ontology_concepts ADD COLUMN IF NOT EXISTS abstraction text;
ALTER TABLE ontology_concepts ADD COLUMN IF NOT EXISTS definition text;
CREATE INDEX IF NOT EXISTS ontology_concepts_revision_track_idx ON ontology_concepts(revision_id, track);
ALTER TABLE trace_snapshots ADD COLUMN IF NOT EXISTS explanation text;

CREATE TABLE IF NOT EXISTS student_ontology_beliefs (
  student_id text NOT NULL REFERENCES users(id),
  ontology_revision_id text NOT NULL REFERENCES ontology_revisions(id),
  competency_id text NOT NULL,
  alpha numeric NOT NULL,
  beta numeric NOT NULL,
  flags jsonb NOT NULL DEFAULT '[]',
  evidence jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, ontology_revision_id, competency_id),
  FOREIGN KEY (ontology_revision_id, competency_id) REFERENCES ontology_concepts(revision_id, id)
);
CREATE INDEX IF NOT EXISTS student_ontology_beliefs_revision_student_idx ON student_ontology_beliefs(ontology_revision_id, student_id);
CREATE INDEX IF NOT EXISTS student_ontology_beliefs_student_idx ON student_ontology_beliefs(student_id);

CREATE TABLE IF NOT EXISTS evidence_evaluations (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id),
  trace_snapshot_id bigint NOT NULL REFERENCES trace_snapshots(id),
  ontology_revision_id text NOT NULL REFERENCES ontology_revisions(id),
  competency_id text NOT NULL,
  evaluator_prompt_version text NOT NULL,
  model_metadata jsonb NOT NULL,
  criterion_results jsonb NOT NULL,
  aggregate jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (ontology_revision_id, competency_id) REFERENCES ontology_concepts(revision_id, id)
);
CREATE INDEX IF NOT EXISTS evidence_evaluations_session_idx ON evidence_evaluations(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS evidence_evaluations_snapshot_idx ON evidence_evaluations(trace_snapshot_id);

CREATE TABLE IF NOT EXISTS competency_belief_updates (
  id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES users(id),
  ontology_revision_id text NOT NULL REFERENCES ontology_revisions(id),
  competency_id text NOT NULL,
  session_id text NOT NULL REFERENCES sessions(id),
  evidence_evaluation_id text NOT NULL REFERENCES evidence_evaluations(id),
  prior jsonb NOT NULL,
  next jsonb NOT NULL,
  decision jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (ontology_revision_id, competency_id) REFERENCES ontology_concepts(revision_id, id)
);
CREATE INDEX IF NOT EXISTS competency_belief_updates_node_idx ON competency_belief_updates(student_id, ontology_revision_id, competency_id, created_at DESC);
