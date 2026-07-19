CREATE TABLE IF NOT EXISTS ontology_revisions (
  id text PRIMARY KEY,
  domain text NOT NULL,
  version text NOT NULL,
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domain, version)
);
CREATE TABLE IF NOT EXISTS ontology_concepts (
  revision_id text NOT NULL REFERENCES ontology_revisions(id),
  id text NOT NULL,
  title text NOT NULL,
  domain text NOT NULL,
  topic text NOT NULL,
  level text NOT NULL,
  diagnostic_metadata jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (revision_id, id)
);
CREATE TABLE IF NOT EXISTS ontology_relations (
  revision_id text NOT NULL,
  source_concept_id text NOT NULL,
  target_concept_id text NOT NULL,
  relation_type text NOT NULL CHECK (relation_type IN ('prerequisite', 'related', 'part_of', 'misconception')),
  PRIMARY KEY (revision_id, source_concept_id, target_concept_id, relation_type),
  CHECK (source_concept_id <> target_concept_id),
  FOREIGN KEY (revision_id, source_concept_id) REFERENCES ontology_concepts(revision_id, id),
  FOREIGN KEY (revision_id, target_concept_id) REFERENCES ontology_concepts(revision_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ontology_one_published_revision_per_domain_idx ON ontology_revisions(domain) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS ontology_concepts_revision_domain_idx ON ontology_concepts(revision_id, domain);
CREATE INDEX IF NOT EXISTS ontology_relations_target_idx ON ontology_relations(revision_id, target_concept_id);
