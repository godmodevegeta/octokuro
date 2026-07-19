"use strict";

const schema = require("./schema");
const { NODES } = require("./competencies");
const { PHYSICS_ONTOLOGY, DECISION_GRADE_MECHANICS_ONTOLOGY } = require("./ontology");
const { passwordHash } = require("./auth");

const studentNames = ["Aarav Shah", "Aditi Rao", "Aisha Khan", "Ananya Iyer", "Arjun Mehta", "Dev Patel", "Diya Kapoor", "Ishaan Gupta", "Kabir Singh", "Kavya Nair", "Manav Joshi", "Meera Das", "Mira Bose", "Neel Verma", "Nikhil Jain", "Priya Menon", "Rhea Malhotra", "Rohan Desai", "Riya Sharma", "Saanvi Kulkarni", "Samar Bhat", "Sofia Thomas", "Tanvi Sethi", "Ved Prakash", "Vihaan Kumar", "Yash Bansal", "Zara Ali", "Zoya Khan", "Aman Sood", "Ira Chandra"];

function createProfile(seed = 0) {
  return Object.fromEntries(NODES.map((node, index) => {
    const mean = Math.max(.16, Math.min(.9, .31 + ((seed * 11 + index * 7) % 58) / 100));
    const strength = 6 + ((seed + index) % 8), alpha = Number((mean * strength).toFixed(2));
    return [node.id, { alpha, beta: Number((strength - alpha).toFixed(2)), flags: (seed + index * 2) % 17 === 0 ? ["cross_task_untested"] : [], evidence: [] }];
  }));
}
function fixture() {
  const students = studentNames.map((name, index) => ({ id: index === 0 ? "student_demo" : `student_${String(index + 1).padStart(2, "0")}`, email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@socrates.local`, name, role: "student", profile: createProfile(index) }));
  const classes = [{ id: "class_mechanics", teacherId: "teacher_demo", name: "Mechanics I", period: "Period 3", students }, { id: "class_foundations", teacherId: "teacher_demo", name: "Physics Foundations", period: "Advisory", students: students.slice(0, 12) }];
  const states = ["complete", "complete", "follow_up", "assigned", "complete", "in_progress"];
  const assignments = students.slice(0, 18).map((student, index) => {
    const createdAt = new Date(Date.now() - (index + 1) * 86400000), state = states[index % states.length], sessionId = `seed_session_${index}`;
    const traceFeatures = { edit_entropy: .42 + (index % 4) * .1, erase_ratio: .08 + (index % 5) * .06, pause_pattern: { count: 3 + index % 4, mean_ms: 900 + index * 40 }, spatial_progression: { cells: 4 + index % 8, events: 9 + index }, submitted: state === "complete" };
    const mechanicsNodes = NODES.filter((node) => node.domain === "mechanics");
    return { id: `seed_assignment_${index}`, classId: "class_mechanics", teacherId: "teacher_demo", domain: "mechanics", title: "Mechanics boundary diagnostic", createdAt, studentIds: [student.id], session: { id: sessionId, studentId: student.id, targetId: mechanicsNodes[(index + 4) % mechanicsNodes.length].id, ontologyRevisionId: PHYSICS_ONTOLOGY.id, state, createdAt, item: { prompt: "Seeded diagnostic item", intendedSolution: "Stored in Postgres", rubric: [] }, followUps: state === "follow_up" ? [{ prompt: "Explain the force relationship.", expectedEvidence: ["F = ma"] }] : [], evidence: state === "assigned" ? null : traceFeatures } };
  });
  return { students, classes, assignments };
}

async function syncOntology(tx) {
  await tx.insert(schema.ontologyRevisions).values({ id: PHYSICS_ONTOLOGY.id, domain: PHYSICS_ONTOLOGY.domain, version: PHYSICS_ONTOLOGY.version, title: PHYSICS_ONTOLOGY.title, status: "published", publishedAt: new Date("2026-07-19T00:00:00.000Z") }).onConflictDoNothing();
  await tx.insert(schema.ontologyConcepts).values(PHYSICS_ONTOLOGY.concepts.map((concept) => ({ revisionId: PHYSICS_ONTOLOGY.id, id: concept.id, title: concept.title, domain: concept.domain, topic: concept.topic, level: concept.level, diagnosticMetadata: concept.diagnosticMetadata }))).onConflictDoNothing();
  await tx.insert(schema.ontologyRelations).values(PHYSICS_ONTOLOGY.relations.map((relation) => ({ revisionId: PHYSICS_ONTOLOGY.id, ...relation }))).onConflictDoNothing();
  await tx.insert(schema.ontologyRevisions).values({ id: DECISION_GRADE_MECHANICS_ONTOLOGY.id, domain: DECISION_GRADE_MECHANICS_ONTOLOGY.domain, version: DECISION_GRADE_MECHANICS_ONTOLOGY.version, title: DECISION_GRADE_MECHANICS_ONTOLOGY.title, status: "draft" }).onConflictDoNothing();
  await tx.insert(schema.ontologyConcepts).values(DECISION_GRADE_MECHANICS_ONTOLOGY.concepts.map((concept) => ({ revisionId: DECISION_GRADE_MECHANICS_ONTOLOGY.id, id: concept.id, title: concept.title, domain: concept.domain, topic: concept.topic, track: concept.track, abstraction: concept.abstraction, definition: concept.definition, level: concept.level, diagnosticMetadata: concept.diagnosticMetadata }))).onConflictDoNothing();
  await tx.insert(schema.ontologyRelations).values(DECISION_GRADE_MECHANICS_ONTOLOGY.relations.map((relation) => ({ revisionId: DECISION_GRADE_MECHANICS_ONTOLOGY.id, ...relation }))).onConflictDoNothing();
}

async function syncSeed(db) {
  const data = fixture(), teacher = { id: "teacher_demo", role: "teacher", email: "teacher@socrates.local", name: "Dr. Maya Sen", passwordHash: passwordHash() };
  await db.transaction(async (tx) => {
    await syncOntology(tx);
    await tx.insert(schema.users).values([teacher, ...data.students.map(({ profile, ...student }) => ({ ...student, passwordHash: passwordHash() }))]).onConflictDoNothing();
    await tx.update(schema.users).set({ passwordHash: passwordHash() });
    await tx.insert(schema.classes).values(data.classes.map(({ students, ...classItem }) => classItem)).onConflictDoNothing();
    await tx.insert(schema.memberships).values(data.classes.flatMap((classItem) => classItem.students.map((student) => ({ classId: classItem.id, studentId: student.id })))).onConflictDoNothing();
    await tx.insert(schema.competencyNodes).values(NODES.map((node) => ({ id: node.id, title: node.title, prerequisites: node.prerequisites }))).onConflictDoNothing();
    await tx.insert(schema.competencyNodes).values(DECISION_GRADE_MECHANICS_ONTOLOGY.concepts.map((node) => ({ id: node.id, title: node.title, prerequisites: node.prerequisites }))).onConflictDoNothing();
    await tx.insert(schema.studentProfiles).values(data.students.flatMap((student) => Object.entries(student.profile).map(([competencyId, value]) => ({ studentId: student.id, competencyId, alpha: String(value.alpha), beta: String(value.beta), flags: value.flags, evidence: value.evidence })))).onConflictDoNothing();
    await tx.insert(schema.assignments).values(data.assignments.map(({ id, classId, teacherId, domain, title, createdAt, studentIds }) => ({ id, classId, teacherId, domain, title, createdAt, payload: { studentIds } }))).onConflictDoNothing();
    await tx.insert(schema.diagnosticSessions).values(data.assignments.map((assignment) => ({ id: assignment.session.id, assignmentId: assignment.id, classId: assignment.classId, studentId: assignment.session.studentId, state: assignment.session.state, createdAt: assignment.session.createdAt, payload: { targetId: assignment.session.targetId, ontologyRevisionId: assignment.session.ontologyRevisionId, item: assignment.session.item, generation: { source: "seed", attempts: 0, promptVersion: "mechanics-v1", ontologyRevisionId: assignment.session.ontologyRevisionId }, workZone: { x: 1800, y: 4500, width: 16400, height: 13000 }, followUps: assignment.session.followUps } }))).onConflictDoNothing();
    await tx.insert(schema.generatedItems).values(data.assignments.map((assignment) => ({ id: `seed_item_${assignment.id}`, sessionId: assignment.session.id, promptVersion: "mechanics-v1", modelMetadata: { source: "seed" }, verifierResult: { valid: true, source: "seed" }, item: assignment.session.item }))).onConflictDoNothing();
    const snapshots = data.assignments.filter((assignment) => assignment.session.evidence).map((assignment) => ({ sessionId: assignment.session.id, atlasSnapshot: "seeded-atlas-snapshot", traceFeatures: assignment.session.evidence, createdAt: assignment.session.createdAt }));
    if (snapshots.length) await tx.insert(schema.traceSnapshots).values(snapshots).onConflictDoNothing();
  });
}

module.exports = { createProfile, fixture, syncOntology, syncSeed };
