"use strict";

const { PHYSICS_ONTOLOGY, learningPath } = require("./ontology");

const prerequisiteIds = new Map(PHYSICS_ONTOLOGY.concepts.map((concept) => [concept.id, []]));
for (const relation of PHYSICS_ONTOLOGY.relations) if (relation.relationType === "prerequisite") prerequisiteIds.get(relation.sourceConceptId).push(relation.targetConceptId);
const NODES = PHYSICS_ONTOLOGY.concepts.map((concept) => ({ ...concept, prerequisites: prerequisiteIds.get(concept.id) }));

function selectBoundary(profile = {}, domain = "mechanics") {
  const target = learningPath(PHYSICS_ONTOLOGY, profile, { targetDomain: domain }).recommended;
  return target ? NODES.find((node) => node.id === target.id) : null;
}

module.exports = { NODES, selectBoundary };
