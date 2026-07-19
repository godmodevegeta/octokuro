"use strict";

const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const RELATION_TYPES = new Set(["prerequisite", "related", "part_of", "misconception"]);
const TRACKS = new Set(["conceptual", "procedural", "representational", "mathematical_prerequisite"]);
const EVIDENCE_TYPES = new Set(["diagram", "explanation", "process"]);
const EVALUATORS = new Set(["rubric_vision_v1", "process_v1"]);
const READY_THRESHOLD = .55;

const definition = [
  ["scalars-vectors-units", "Scalars, vectors, and units", "mechanics", "foundations"],
  ["dimensional-analysis", "Dimensional analysis", "mechanics", "foundations", ["scalars-vectors-units"]],
  ["coordinate-systems", "Coordinate systems", "mechanics", "foundations", ["scalars-vectors-units"]],
  ["motion-graphs", "Motion graphs", "mechanics", "kinematics", ["coordinate-systems"]],
  ["one-dimensional-kinematics", "One-dimensional kinematics", "mechanics", "kinematics", ["motion-graphs", "dimensional-analysis"]],
  ["two-dimensional-kinematics", "Two-dimensional kinematics", "mechanics", "kinematics", ["one-dimensional-kinematics"]],
  ["calculus-motion", "Calculus-based motion", "mechanics", "kinematics", ["two-dimensional-kinematics"]],
  ["free-body-diagrams", "Free-body diagrams", "mechanics", "forces", ["scalars-vectors-units"]],
  ["newtons-first-law", "Newton's first law", "mechanics", "forces", ["free-body-diagrams"]],
  ["newtons-second-law", "Newton's second law", "mechanics", "forces", ["newtons-first-law", "one-dimensional-kinematics"]],
  ["newtons-third-law", "Newton's third law", "mechanics", "forces", ["newtons-first-law"]],
  ["friction-normal-force", "Friction and normal force", "mechanics", "forces", ["newtons-second-law"]],
  ["tension-connected-bodies", "Tension and connected bodies", "mechanics", "forces", ["newtons-second-law"]],
  ["inclined-planes", "Inclined planes", "mechanics", "forces", ["friction-normal-force", "coordinate-systems"]],
  ["uniform-circular-motion", "Uniform circular motion", "mechanics", "circular-motion", ["two-dimensional-kinematics", "newtons-second-law"]],
  ["work-work-energy", "Work and work-energy", "mechanics", "energy", ["newtons-second-law"]],
  ["conservative-energy", "Conservative energy", "mechanics", "energy", ["work-work-energy"]],
  ["impulse-momentum", "Impulse and momentum", "mechanics", "momentum", ["newtons-second-law"]],
  ["collisions", "Collisions", "mechanics", "momentum", ["impulse-momentum"]],
  ["rotational-differential-mechanics", "Rotational and differential-equation mechanics", "mechanics", "advanced-mechanics", ["calculus-motion", "uniform-circular-motion", "conservative-energy"]],
  ["simple-harmonic-motion", "Simple harmonic motion", "oscillations-waves", "oscillations", ["one-dimensional-kinematics", "newtons-second-law"]],
  ["wave-properties", "Wave properties and representations", "oscillations-waves", "waves", ["scalars-vectors-units"]],
  ["wave-superposition", "Superposition and interference", "oscillations-waves", "waves", ["wave-properties"]],
  ["standing-waves", "Standing waves and resonance", "oscillations-waves", "waves", ["wave-superposition", "simple-harmonic-motion"]],
  ["sound-waves", "Sound and Doppler effect", "oscillations-waves", "waves", ["wave-properties"]],
  ["electrostatics", "Electric charge, field, and potential", "electricity-magnetism", "electrostatics", ["scalars-vectors-units"]],
  ["circuits", "DC circuits", "electricity-magnetism", "circuits", ["electrostatics", "dimensional-analysis"]],
  ["capacitors", "Capacitance and RC circuits", "electricity-magnetism", "circuits", ["circuits", "work-work-energy"]],
  ["magnetic-fields", "Magnetic fields and forces", "electricity-magnetism", "magnetism", ["newtons-second-law", "electrostatics"]],
  ["electromagnetic-induction", "Electromagnetic induction", "electricity-magnetism", "magnetism", ["magnetic-fields", "wave-properties"]],
  ["thermal-energy", "Thermal energy and heat transfer", "thermodynamics", "thermal-physics", ["work-work-energy"]],
  ["ideal-gases", "Ideal gases and kinetic theory", "thermodynamics", "thermal-physics", ["thermal-energy", "dimensional-analysis"]],
  ["thermodynamic-laws", "Laws of thermodynamics", "thermodynamics", "thermal-physics", ["ideal-gases", "conservative-energy"]],
  ["atomic-models", "Atomic models and spectra", "modern-physics", "atomic", ["wave-properties"]],
  ["quantum-physics", "Quantum phenomena", "modern-physics", "quantum", ["atomic-models", "conservative-energy"]],
  ["nuclear-physics", "Nuclear physics and radioactivity", "modern-physics", "nuclear", ["quantum-physics", "conservative-energy"]],
];

const concepts = definition.map(([id, title, domain, topic, prerequisites = []]) => ({
  id,
  title,
  domain,
  topic,
  level: "ap-a-level",
  diagnosticMetadata: { assessable: true },
  prerequisites,
}));
const prerequisiteRelations = concepts.flatMap((concept) => concept.prerequisites.map((targetId) => ({ sourceConceptId: concept.id, targetConceptId: targetId, relationType: "prerequisite" })));
const contextualRelations = [
  ["motion-graphs", "one-dimensional-kinematics", "related"],
  ["work-work-energy", "conservative-energy", "part_of"],
  ["newtons-third-law", "newtons-second-law", "misconception"],
  ["wave-properties", "electromagnetic-induction", "related"],
].map(([sourceConceptId, targetConceptId, relationType]) => ({ sourceConceptId, targetConceptId, relationType }));

const PHYSICS_ONTOLOGY = {
  id: "physics-ap-al-2026-1",
  domain: "physics",
  version: "2026.1",
  title: "AP and A-level Physics",
  concepts,
  relations: [...prerequisiteRelations, ...contextualRelations],
};

function normalizeDecisionNode(node) {
  return {
    id: node.node_id,
    title: node.name,
    name: node.name,
    domain: node.domain,
    topic: node.track,
    track: node.track,
    abstraction: node.abstraction,
    definition: node.definition,
    level: "ap-a-level",
    diagnosticMetadata: {
      assessable: true,
      evidenceCriteria: node.evidence_criteria,
      assessmentStrategy: node.assessment_strategy,
      decisionMap: node.decision_map,
    },
    prerequisites: node.prerequisite_edges,
  };
}

function loadDecisionGradeOntology(file = path.resolve(__dirname, "../ontology/physics-mechanics-2026-2.yaml")) {
  const source = YAML.parse(fs.readFileSync(file, "utf8"));
  if (!source?.id || !Array.isArray(source.nodes)) throw new TypeError("Decision-grade ontology YAML requires an id and nodes.");
  const concepts = source.nodes.map(normalizeDecisionNode);
  return {
    id: source.id,
    domain: source.domain,
    version: source.version,
    title: source.title,
    status: source.status || "draft",
    concepts,
    relations: concepts.flatMap((concept) => concept.prerequisites.map((targetConceptId) => ({ sourceConceptId: concept.id, targetConceptId, relationType: "prerequisite" }))),
  };
}

const DECISION_GRADE_MECHANICS_ONTOLOGY = loadDecisionGradeOntology();

function validateOntology(ontology) {
  if (!ontology?.id || !ontology.domain || !Array.isArray(ontology.concepts) || !Array.isArray(ontology.relations)) throw new TypeError("Ontology requires an id, domain, concepts, and relations.");
  const ids = new Set();
  for (const concept of ontology.concepts) {
    if (!concept?.id || !concept.title || !concept.domain || !concept.topic || ids.has(concept.id)) throw new TypeError("Ontology concepts require unique ids, titles, domains, and topics.");
    if (concept.track || concept.abstraction || concept.definition || concept.diagnosticMetadata?.evidenceCriteria) validateDecisionNode(concept);
    ids.add(concept.id);
  }
  const prerequisites = new Map(ontology.concepts.map((concept) => [concept.id, []]));
  for (const relation of ontology.relations) {
    if (!RELATION_TYPES.has(relation?.relationType) || !ids.has(relation.sourceConceptId) || !ids.has(relation.targetConceptId) || relation.sourceConceptId === relation.targetConceptId) throw new TypeError("Ontology relations must use valid, distinct concept ids and supported types.");
    if (relation.relationType === "prerequisite") prerequisites.get(relation.sourceConceptId).push(relation.targetConceptId);
  }
  const visiting = new Set(), visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw new TypeError("Prerequisite relationships must be acyclic.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const prerequisiteId of prerequisites.get(id)) visit(prerequisiteId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const concept of ontology.concepts) visit(concept.id);
  return ontology;
}

function validateDecisionNode(node) {
  if (!TRACKS.has(node.track) || node.abstraction !== "intermediate" || !node.definition) throw new TypeError("Decision-grade nodes require a supported track, intermediate abstraction, and definition.");
  const criteria = node.diagnosticMetadata?.evidenceCriteria;
  const strategy = node.diagnosticMetadata?.assessmentStrategy;
  const decisionMap = node.diagnosticMetadata?.decisionMap;
  if (!Array.isArray(criteria) || !criteria.length || !strategy?.target_probe || !Array.isArray(strategy.follow_up_templates) || !strategy.follow_up_templates.length || !strategy.anti_gaming_check || !decisionMap?.high_confidence || !decisionMap?.low_confidence || !decisionMap?.uncertainty) throw new TypeError("Decision-grade nodes require evidence, assessment strategy, and a decision map.");
  const criterionIds = new Set();
  for (const criterion of criteria) {
    if (!criterion?.id || criterionIds.has(criterion.id) || !EVIDENCE_TYPES.has(criterion.type) || !EVALUATORS.has(criterion.evaluator) || !Array.isArray(criterion.rubrics) || !criterion.rubrics.length || !Number.isFinite(criterion.likelihood_weight) || criterion.likelihood_weight <= 0) throw new TypeError("Decision-grade evidence criteria are invalid.");
    criterionIds.add(criterion.id);
  }
}

function beliefFor(profile, conceptId) {
  const belief = profile?.[conceptId] || { alpha: 1, beta: 1, flags: [], evidence: [] };
  const alpha = Number(belief.alpha), beta = Number(belief.beta);
  if (!Number.isFinite(alpha) || !Number.isFinite(beta) || alpha <= 0 || beta <= 0) return { alpha: 1, beta: 1, mean: .5, uncertainty: 1, flags: [], evidence: [] };
  const mean = alpha / (alpha + beta);
  return { alpha, beta, mean, uncertainty: 1 - Math.abs(mean - .5) * 2, flags: belief.flags || [], evidence: belief.evidence || [] };
}

function learningPath(ontology, profile = {}, { targetDomain } = {}) {
  validateOntology(ontology);
  const conceptsById = new Map(ontology.concepts.map((concept, index) => [concept.id, { ...concept, order: index }]));
  const prerequisites = new Map(ontology.concepts.map((concept) => [concept.id, []]));
  for (const relation of ontology.relations) if (relation.relationType === "prerequisite") prerequisites.get(relation.sourceConceptId).push(relation.targetConceptId);
  const states = ontology.concepts.filter((concept) => !targetDomain || concept.domain === targetDomain).map((concept) => {
    const unmetPrerequisites = prerequisites.get(concept.id).filter((id) => beliefFor(profile, id).mean < READY_THRESHOLD);
    const belief = beliefFor(profile, concept.id);
    return { concept, belief, unmetPrerequisites, ready: unmetPrerequisites.length === 0 };
  });
  const ranked = states.filter((state) => state.ready).sort((a, b) => b.belief.uncertainty - a.belief.uncertainty || a.concept.order - b.concept.order);
  const serialize = ({ concept, belief, unmetPrerequisites, ready }) => ({
    id: concept.id,
    title: concept.title,
    domain: concept.domain,
    topic: concept.topic,
    level: concept.level,
    belief: { mean: belief.mean, uncertainty: belief.uncertainty },
    ready,
    unmetPrerequisites: unmetPrerequisites.map((id) => ({ id, title: conceptsById.get(id).title, belief: beliefFor(profile, id).mean })),
  });
  return { recommended: ranked[0] ? serialize(ranked[0]) : null, ready: ranked.map(serialize), blocked: states.filter((state) => !state.ready).sort((a, b) => a.concept.order - b.concept.order).map(serialize) };
}

function teachingPlan(ontology, profile = {}, { targetDomain } = {}) {
  const path = learningPath(ontology, profile, { targetDomain });
  const concepts = ontology.concepts.filter((concept) => !targetDomain || concept.domain === targetDomain);
  const byId = new Map(ontology.concepts.map((concept) => [concept.id, concept]));
  const trackBuckets = new Map();
  for (const concept of concepts) {
    const belief = beliefFor(profile, concept.id), bucket = trackBuckets.get(concept.track || "legacy") || { track: concept.track || "legacy", observed: 0, means: [], flags: new Set() };
    if (belief.evidence.length) { bucket.observed++; bucket.means.push(belief.mean); for (const flag of belief.flags) bucket.flags.add(flag); }
    trackBuckets.set(bucket.track, bucket);
  }
  const trackSummaries = [...trackBuckets.values()].map((bucket) => ({ track: bucket.track, observedNodes: bucket.observed, mean: bucket.means.length ? bucket.means.reduce((sum, value) => sum + value, 0) / bucket.means.length : null, flags: [...bucket.flags] })).sort((a, b) => a.track.localeCompare(b.track));
  const needsRemediation = concepts.filter((concept) => { const belief = beliefFor(profile, concept.id); return belief.evidence.length && belief.mean <= .4; }).sort((a, b) => beliefFor(profile, a.id).mean - beliefFor(profile, b.id).mean).slice(0, 3).map((concept) => ({ id: concept.id, name: concept.name || concept.title, track: concept.track, action: concept.diagnosticMetadata?.decisionMap?.low_confidence, belief: beliefFor(profile, concept.id).mean }));
  const next = path.recommended ? byId.get(path.recommended.id) : null;
  return { ...path, teachingPlan: { nextProbe: next ? { id: next.id, name: next.name || next.title, track: next.track, action: "diagnostic_probe", targetProbe: next.diagnosticMetadata?.assessmentStrategy?.target_probe, transferPrompts: next.diagnosticMetadata?.assessmentStrategy?.follow_up_templates || [], uncertaintyAction: next.diagnosticMetadata?.decisionMap?.uncertainty } : null, remediation: needsRemediation, trackSummaries, flags: [...new Set(trackSummaries.flatMap((summary) => summary.flags))] } };
}

function conceptDetail(ontology, conceptId) {
  validateOntology(ontology);
  const concept = ontology.concepts.find((item) => item.id === conceptId);
  if (!concept) return null;
  const concepts = new Map(ontology.concepts.map((item) => [item.id, item]));
  const hydrate = (relation) => ({ type: relation.relationType, concept: concepts.get(relation.sourceConceptId === conceptId ? relation.targetConceptId : relation.sourceConceptId) });
  return {
    ...concept,
    relations: {
      outbound: ontology.relations.filter((relation) => relation.sourceConceptId === conceptId).map(hydrate),
      inbound: ontology.relations.filter((relation) => relation.targetConceptId === conceptId).map(hydrate),
    },
  };
}

validateOntology(PHYSICS_ONTOLOGY);
validateOntology(DECISION_GRADE_MECHANICS_ONTOLOGY);

module.exports = { PHYSICS_ONTOLOGY, DECISION_GRADE_MECHANICS_ONTOLOGY, READY_THRESHOLD, RELATION_TYPES, TRACKS, EVIDENCE_TYPES, EVALUATORS, loadDecisionGradeOntology, validateOntology, beliefFor, learningPath, teachingPlan, conceptDetail };
