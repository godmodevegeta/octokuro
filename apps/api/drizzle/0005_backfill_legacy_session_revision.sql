UPDATE sessions
SET payload = jsonb_set(payload, '{ontologyRevisionId}', '"physics-ap-al-2026-1"'::jsonb, true)
WHERE payload ? 'targetId'
  AND NOT payload ? 'ontologyRevisionId';
