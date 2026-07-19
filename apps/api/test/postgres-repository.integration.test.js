"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { and, eq } = require("drizzle-orm");
const { durableStores } = require("../src/db");
const { PostgresRepository } = require("../src/repository");
const schema = require("../src/schema");
const { syncSeed } = require("../src/seed");
const { loadLocalEnv } = require("../src/server");
const { DECISION_GRADE_MECHANICS_ONTOLOGY, PHYSICS_ONTOLOGY } = require("../src/ontology");

const enabled = process.env.SOCRATES_INTEGRATION_TESTS === "true";
test("Postgres repository preserves legacy sessions and durable auth after the decision-grade revision is added", { skip: !enabled }, async () => {
  loadLocalEnv();
  const stores = durableStores(), repository = new PostgresRepository(stores.db);
  try {
    await Promise.all([stores.redis.connect(), syncSeed(stores.db)]);
    const legacy = await repository.ontologyForId(PHYSICS_ONTOLOGY.id);
    assert.equal(legacy.id, PHYSICS_ONTOLOGY.id);
    assert.equal((await repository.sessionForId("seed_session_0")).ontologyRevisionId, PHYSICS_ONTOLOGY.id, "historical session retains its original revision");
    const restartedRepository = new PostgresRepository(stores.db);
    const token = await repository.createAuthSession("teacher_demo");
    assert.equal((await restartedRepository.userForToken(token)).id, "teacher_demo");
    await restartedRepository.revokeAuthSession(token);
    assert.equal(await repository.userForToken(token), null);
    assert.equal(await repository.ownsClass("teacher_demo", "class_mechanics"), true);
    assert.equal(await repository.ownsClass("student_demo", "class_mechanics"), false);
  } finally {
    if (stores.redis.isOpen) await stores.redis.disconnect();
    await stores.sql.end({ timeout: 5 });
  }
});

test("decision-grade evidence accepts Canvas-sized snapshots, is revision-scoped, and omits raw strokes", { skip: !enabled }, async () => {
  loadLocalEnv();
  const stores = durableStores(), repository = new PostgresRepository(stores.db);
  let assignment, previousBelief;
  try {
    await syncSeed(stores.db);
    const ontology = await repository.ontologyForId(DECISION_GRADE_MECHANICS_ONTOLOGY.id);
    const target = ontology.concepts.find((concept) => concept.id === "math.vectors.scalar_vector_units.classify");
    assert.equal(ontology.concepts.length, 20);
    previousBelief = (await stores.db.select().from(schema.studentOntologyBeliefs).where(and(eq(schema.studentOntologyBeliefs.studentId, "student_demo"), eq(schema.studentOntologyBeliefs.ontologyRevisionId, ontology.id), eq(schema.studentOntologyBeliefs.competencyId, target.id))).limit(1))[0];
    assignment = (await repository.createAssignment({ classId: "class_mechanics", domain: "mechanics", teacherId: "teacher_demo", studentIds: ["student_demo"], sessions: [{ studentId: "student_demo", targetId: target.id, ontologyRevisionId: ontology.id, item: { prompt: "Classify velocity and mass.", intendedSolution: "velocity vector, mass scalar", rubric: [] }, generation: { source: "integration", attempts: 1, promptVersion: "mechanics-2026-2", metadata: { model: "test" }, verifierResult: { valid: true } }, workZone: { x: 1, y: 1, width: 2, height: 2 } }] })).assignment;
    const session = (await stores.db.select().from(schema.diagnosticSessions).where(eq(schema.diagnosticSessions.assignmentId, assignment.id)))[0];
    const atlasSnapshot = `data:image/png;base64,${crypto.randomBytes(63_000).toString("base64")}`;
    assert.ok(Buffer.byteLength(atlasSnapshot) > 8_191, "fixture must exceed PostgreSQL's B-tree index entry limit");
    await repository.submitEvidence({ sessionId: session.id, key: "decision-grade-key", atlasSnapshot, explanation: "Velocity includes direction while mass does not.", traceFeatures: { edit_entropy: .2, erase_ratio: .1, pause_pattern: { count: 1 }, spatial_progression: { cells: 2, events: 5 }, process_order: { diagramBeforeEquations: true } }, submitted: true });
    const snapshot = (await repository.evidenceForSession(session.id))[0];
    assert.equal(snapshot.atlasSnapshot, atlasSnapshot);
    const evaluation = { promptVersion: "integration", modelMetadata: { source: "test" }, criterionResults: target.diagnosticMetadata.evidenceCriteria.map((criterion) => ({ criterionId: criterion.id, score: .9, confidence: .8, rationale: "fixture" })) };
    const completed = await repository.completeDecisionGradeSession({ sessionId: session.id, target, ontology, snapshot, evaluation });
    assert.equal(completed.state, "complete");
    const beliefs = await repository.ontologyProfileFor("student_demo", ontology.id);
    assert.ok(beliefs[target.id]);
    assert.equal((await repository.profileFor("student_demo"))[target.id], undefined, "new revision does not overwrite legacy beliefs");
    const evaluations = await stores.db.select().from(schema.evidenceEvaluations).where(eq(schema.evidenceEvaluations.sessionId, session.id));
    assert.equal(evaluations.length, 1);
    assert.equal(JSON.stringify(snapshot.traceFeatures).includes("rawStrokes"), false);
  } finally {
    if (assignment) {
      const sessions = await stores.db.select({ id: schema.diagnosticSessions.id }).from(schema.diagnosticSessions).where(eq(schema.diagnosticSessions.assignmentId, assignment.id));
      for (const session of sessions) {
        const evaluations = await stores.db.select({ id: schema.evidenceEvaluations.id }).from(schema.evidenceEvaluations).where(eq(schema.evidenceEvaluations.sessionId, session.id));
        for (const evaluation of evaluations) await stores.db.delete(schema.competencyBeliefUpdates).where(eq(schema.competencyBeliefUpdates.evidenceEvaluationId, evaluation.id));
        await stores.db.delete(schema.evidenceEvaluations).where(eq(schema.evidenceEvaluations.sessionId, session.id));
        await stores.db.delete(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.sessionId, session.id));
        await stores.db.delete(schema.traceSnapshots).where(eq(schema.traceSnapshots.sessionId, session.id));
        await stores.db.delete(schema.generatedItems).where(eq(schema.generatedItems.sessionId, session.id));
      }
      await stores.db.delete(schema.diagnosticSessions).where(eq(schema.diagnosticSessions.assignmentId, assignment.id));
      await stores.db.delete(schema.assignments).where(eq(schema.assignments.id, assignment.id));
      const beliefCondition = and(eq(schema.studentOntologyBeliefs.studentId, "student_demo"), eq(schema.studentOntologyBeliefs.ontologyRevisionId, DECISION_GRADE_MECHANICS_ONTOLOGY.id), eq(schema.studentOntologyBeliefs.competencyId, "math.vectors.scalar_vector_units.classify"));
      if (previousBelief) await stores.db.update(schema.studentOntologyBeliefs).set({ alpha: previousBelief.alpha, beta: previousBelief.beta, flags: previousBelief.flags, evidence: previousBelief.evidence, updatedAt: previousBelief.updatedAt }).where(beliefCondition);
      else await stores.db.delete(schema.studentOntologyBeliefs).where(beliefCondition);
    }
    await stores.sql.end({ timeout: 5 });
  }
});
