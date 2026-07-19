"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { NODES, selectBoundary } = require("../src/competencies");
const { posterior, posteriorFromCriteria, decisionForPosterior, uncertaintyFlags } = require("../src/bayes");
const { summarizeTrace } = require("../src/trace");
const { PHYSICS_ONTOLOGY, DECISION_GRADE_MECHANICS_ONTOLOGY, learningPath, teachingPlan, validateOntology } = require("../src/ontology");

test("decision-grade Mechanics ontology has 20 four-track, evidence-bound competencies", () => {
  assert.equal(DECISION_GRADE_MECHANICS_ONTOLOGY.concepts.length, 20);
  assert.deepEqual(new Set(DECISION_GRADE_MECHANICS_ONTOLOGY.concepts.map((node) => node.track)), new Set(["conceptual", "procedural", "representational", "mathematical_prerequisite"]));
  const normalForce = DECISION_GRADE_MECHANICS_ONTOLOGY.concepts.find((node) => node.id === "mechanics.fbd.normal_force.inclined");
  assert.equal(normalForce.abstraction, "intermediate");
  assert.ok(normalForce.diagnosticMetadata.evidenceCriteria.some((criterion) => criterion.id === "normal_force_geometry"));
  assert.equal(learningPath(DECISION_GRADE_MECHANICS_ONTOLOGY, {}, { targetDomain: "mechanics" }).recommended.id, "math.vectors.scalar_vector_units.classify");
});

test("physics ontology preserves the Mechanics graph and expands it across AP and A-level domains", () => {
  assert.equal(NODES.length, 36);
  assert.deepEqual([...new Set(NODES.map((node) => node.domain))], ["mechanics", "oscillations-waves", "electricity-magnetism", "thermodynamics", "modern-physics"]);
  assert.equal(selectBoundary({}).id, "scalars-vectors-units");
  const profile = { "scalars-vectors-units": { alpha: 9, beta: 1 }, "dimensional-analysis": { alpha: 8, beta: 2 }, "coordinate-systems": { alpha: 8, beta: 2 } };
  assert.notEqual(selectBoundary(profile).id, "scalars-vectors-units");
});
test("learning paths select the ready, most uncertain frontier and explain blocked concepts", () => {
  const profile = { "scalars-vectors-units": { alpha: 9, beta: 1 }, "dimensional-analysis": { alpha: 9, beta: 1 }, "coordinate-systems": { alpha: 9, beta: 1 } };
  const path = learningPath(PHYSICS_ONTOLOGY, profile, { targetDomain: "mechanics" });
  assert.equal(path.recommended.id, "motion-graphs");
  assert.equal(path.recommended.ready, true);
  const blocked = path.blocked.find((concept) => concept.id === "newtons-second-law");
  assert.deepEqual(blocked.unmetPrerequisites.map((item) => item.id), ["newtons-first-law", "one-dimensional-kinematics"]);
});
test("ontology validation rejects cyclic prerequisite relations", () => {
  const cyclic = { id: "test", domain: "physics", concepts: [{ id: "a", title: "A", domain: "test", topic: "test" }, { id: "b", title: "B", domain: "test", topic: "test" }], relations: [{ sourceConceptId: "a", targetConceptId: "b", relationType: "prerequisite" }, { sourceConceptId: "b", targetConceptId: "a", relationType: "prerequisite" }] };
  assert.throws(() => validateOntology(cyclic), /acyclic/);
});
test("beta posterior records fractional semantic and process evidence", () => {
  const updated = posterior({ alpha: 2, beta: 2 }, .9, .7);
  assert.equal(updated.alpha, 2.85); assert.equal(updated.beta, 2.15); assert.ok(updated.mean > .5);
  assert.deepEqual(uncertaintyFlags({ semanticConfidence: .4, processConfidence: .4, previousMean: .3, nextMean: .8 }), ["semantic_low", "process_anomaly", "temporal_unstable"]);
});
test("criterion-bound evidence updates only declared evidence and yields an auditable decision", () => {
  const node = DECISION_GRADE_MECHANICS_ONTOLOGY.concepts.find((item) => item.id === "mechanics.fbd.normal_force.inclined");
  const results = node.diagnosticMetadata.evidenceCriteria.map((criterion) => ({ criterionId: criterion.id, score: .9, confidence: .8, rationale: "fixture" }));
  const updated = posteriorFromCriteria({ alpha: 2, beta: 2 }, results, node.diagnosticMetadata.evidenceCriteria);
  assert.ok(updated.mean > .5);
  assert.throws(() => posteriorFromCriteria({ alpha: 2, beta: 2 }, results.slice(1), node.diagnosticMetadata.evidenceCriteria), /Missing/);
  assert.equal(decisionForPosterior({ mean: .8, variance: .01 }, node.diagnosticMetadata.decisionMap).outcome, "high_confidence");
});
test("teaching plans surface a next probe, remediation, and cross-track uncertainty", () => {
  const profile = {
    "math.vectors.scalar_vector_units.classify": { alpha: 2, beta: 8, evidence: [{ sessionId: "one" }], flags: ["human_review_required"] },
    "mechanics.fbd.complete_diagram": { alpha: 8, beta: 2, evidence: [{ sessionId: "two" }], flags: [] },
  };
  const plan = teachingPlan(DECISION_GRADE_MECHANICS_ONTOLOGY, profile, { targetDomain: "mechanics" });
  assert.equal(plan.teachingPlan.remediation[0].id, "math.vectors.scalar_vector_units.classify");
  assert.ok(plan.teachingPlan.nextProbe);
  assert.equal(plan.teachingPlan.nextProbe.action, "diagnostic_probe");
  assert.ok(plan.teachingPlan.trackSummaries.some((summary) => summary.track === "representational"));
  assert.ok(plan.teachingPlan.flags.includes("human_review_required"));
});
test("trace feature summaries never retain raw input", () => {
  const result = summarizeTrace([{ type: "stroke", x: 0, y: 0, distance: 10 }, { type: "erase", x: 100, y: 0, distance: 5 }, { type: "pause", duration: 1200 }]);
  assert.deepEqual(Object.keys(result).sort(), ["edit_entropy", "erase_ratio", "pause_pattern", "spatial_progression"]);
  assert.equal(result.erase_ratio, .333);
});
