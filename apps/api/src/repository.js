"use strict";

const crypto = require("node:crypto");
const { and, asc, desc, eq, inArray, sql } = require("drizzle-orm");
const schema = require("./schema");
const { posteriorFromCriteria, decisionForPosterior } = require("./bayes");

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const initials = (name) => name.split(" ").map((part) => part[0]).join("");
const number = (value) => Number(value);
const asDate = (value) => value instanceof Date ? value.toISOString() : value;
const sessionFromRow = (row) => ({ id: row.id, assignmentId: row.assignmentId, classId: row.classId, studentId: row.studentId, state: row.state, createdAt: asDate(row.createdAt), ...row.payload });
const profileFromRows = (rows) => Object.fromEntries(rows.map((row) => [row.competencyId, { alpha: number(row.alpha), beta: number(row.beta), flags: row.flags || [], evidence: row.evidence || [] }]));
const safeTraceFeatures = (features, submitted) => Object.fromEntries(["edit_entropy", "erase_ratio", "pause_pattern", "spatial_progression", "process_order"].filter((key) => Object.hasOwn(features, key)).map((key) => [key, features[key]]).concat([["submitted", Boolean(submitted)]]));
const publicUser = ({ passwordHash, ...user }) => user;
const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

class PostgresRepository {
  constructor(db) { this.db = db; }

  async userForId(userId) { const user = (await this.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1))[0]; return user ? publicUser(user) : null; }
  async userForEmail(email) { return (await this.db.select().from(schema.users).where(eq(schema.users.email, String(email).trim().toLowerCase())).limit(1))[0] || null; }
  async userForToken(token) {
    if (!token) return null;
    const auth = (await this.db.select().from(schema.authSessions).where(and(eq(schema.authSessions.id, token), sql`${schema.authSessions.expiresAt} > now()`)).limit(1))[0];
    if (!auth) { await this.db.delete(schema.authSessions).where(and(eq(schema.authSessions.id, token), sql`${schema.authSessions.expiresAt} <= now()`)); return null; }
    return this.userForId(auth.userId);
  }
  async createAuthSession(userId) {
    const token = crypto.randomBytes(32).toString("base64url");
    await this.db.insert(schema.authSessions).values({ id: token, userId, expiresAt: new Date(Date.now() + AUTH_SESSION_TTL_MS) });
    return token;
  }
  async renewAuthSession(token) {
    if (!token) return;
    await this.db.update(schema.authSessions).set({ expiresAt: new Date(Date.now() + AUTH_SESSION_TTL_MS) }).where(and(eq(schema.authSessions.id, token), sql`${schema.authSessions.expiresAt} > now()`));
  }
  async revokeAuthSession(token) { if (token) await this.db.delete(schema.authSessions).where(eq(schema.authSessions.id, token)); }
  async ownsClass(teacherId, classId) { return Boolean((await this.db.select({ id: schema.classes.id }).from(schema.classes).where(and(eq(schema.classes.id, classId), eq(schema.classes.teacherId, teacherId))).limit(1))[0]); }
  async classForId(classId) { return (await this.db.select().from(schema.classes).where(eq(schema.classes.id, classId)).limit(1))[0] || null; }
  async teacherHasStudent(teacherId, studentId) { return Boolean((await this.db.select({ classId: schema.memberships.classId }).from(schema.memberships).innerJoin(schema.classes, eq(schema.classes.id, schema.memberships.classId)).where(and(eq(schema.classes.teacherId, teacherId), eq(schema.memberships.studentId, studentId))).limit(1))[0]); }

  async profileFor(studentId, db = this.db) {
    return profileFromRows(await db.select().from(schema.studentProfiles).where(eq(schema.studentProfiles.studentId, studentId)));
  }
  async ontologyProfileFor(studentId, ontologyRevisionId, db = this.db) {
    return profileFromRows(await db.select().from(schema.studentOntologyBeliefs).where(and(eq(schema.studentOntologyBeliefs.studentId, studentId), eq(schema.studentOntologyBeliefs.ontologyRevisionId, ontologyRevisionId))));
  }
  async profileForOntology(studentId, ontology, db = this.db) {
    return ontology?.concepts.some((concept) => concept.track && concept.track !== "legacy") ? this.ontologyProfileFor(studentId, ontology.id, db) : this.profileFor(studentId, db);
  }
  async ontologyForId(ontologyRevisionId) {
    const revision = (await this.db.select().from(schema.ontologyRevisions).where(eq(schema.ontologyRevisions.id, ontologyRevisionId)).limit(1))[0];
    if (!revision) return null;
    const [concepts, relations] = await Promise.all([
      this.db.select().from(schema.ontologyConcepts).where(eq(schema.ontologyConcepts.revisionId, revision.id)).orderBy(asc(schema.ontologyConcepts.id)),
      this.db.select().from(schema.ontologyRelations).where(eq(schema.ontologyRelations.revisionId, revision.id)).orderBy(asc(schema.ontologyRelations.sourceConceptId), asc(schema.ontologyRelations.targetConceptId), asc(schema.ontologyRelations.relationType)),
    ]);
    return { id: revision.id, domain: revision.domain, version: revision.version, title: revision.title, publishedAt: asDate(revision.publishedAt), concepts: concepts.map((concept) => ({ id: concept.id, title: concept.title, name: concept.title, domain: concept.domain, topic: concept.topic, track: concept.track, abstraction: concept.abstraction, definition: concept.definition, level: concept.level, diagnosticMetadata: concept.diagnosticMetadata })), relations: relations.map((relation) => ({ sourceConceptId: relation.sourceConceptId, targetConceptId: relation.targetConceptId, relationType: relation.relationType })) };
  }
  async activeOntology(domain) {
    const revision = (await this.db.select().from(schema.ontologyRevisions).where(and(eq(schema.ontologyRevisions.domain, domain), eq(schema.ontologyRevisions.status, "published"))).orderBy(desc(schema.ontologyRevisions.publishedAt)).limit(1))[0];
    return revision ? this.ontologyForId(revision.id) : null;
  }
  async classesForTeacher(teacherId) {
    const classRows = await this.db.select().from(schema.classes).where(eq(schema.classes.teacherId, teacherId));
    return Promise.all(classRows.map((item) => this.classSummary(item)));
  }
  async classSummary(classItem) {
    const [members, classSessions] = await Promise.all([
      this.db.select({ studentId: schema.memberships.studentId }).from(schema.memberships).where(eq(schema.memberships.classId, classItem.id)),
      this.db.select().from(schema.diagnosticSessions).where(eq(schema.diagnosticSessions.classId, classItem.id)),
    ]);
    const studentIds = members.map((member) => member.studentId);
    const profiles = studentIds.length ? await this.db.select().from(schema.studentProfiles).where(inArray(schema.studentProfiles.studentId, studentIds)) : [];
    const flagged = new Set(profiles.filter((profile) => profile.flags?.length).map((profile) => profile.studentId)).size;
    const completed = classSessions.filter((session) => session.state === "complete").length;
    return { id: classItem.id, teacherId: classItem.teacherId, name: classItem.name, period: classItem.period, createdAt: asDate(classItem.createdAt), studentCount: studentIds.length, activeSessions: classSessions.filter((session) => ["assigned", "in_progress", "follow_up"].includes(session.state)).length, completedSessions: completed, flaggedStudents: flagged, completionRate: classSessions.length ? Math.round(completed / classSessions.length * 100) : 0 };
  }
  async studentsForClass(classId, query = "") {
    const members = await this.db.select({ studentId: schema.memberships.studentId, name: schema.users.name, email: schema.users.email }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.studentId)).where(eq(schema.memberships.classId, classId));
    const ids = members.map((member) => member.studentId);
    const [profileRows, sessionRows] = ids.length ? await Promise.all([
      this.db.select().from(schema.studentProfiles).where(inArray(schema.studentProfiles.studentId, ids)),
      this.db.select().from(schema.diagnosticSessions).where(and(eq(schema.diagnosticSessions.classId, classId), inArray(schema.diagnosticSessions.studentId, ids))).orderBy(desc(schema.diagnosticSessions.createdAt)),
    ]) : [[], []];
    const profiles = new Map();
    for (const profile of profileRows) { const current = profiles.get(profile.studentId) || []; current.push(profile); profiles.set(profile.studentId, current); }
    const latest = new Map();
    for (const session of sessionRows) if (!latest.has(session.studentId)) latest.set(session.studentId, session);
    const normalized = query.trim().toLowerCase();
    return members.map((student) => {
      const nodes = profiles.get(student.studentId) || [], flags = [...new Set(nodes.flatMap((node) => node.flags || []))];
      const mastery = nodes.length ? Math.round(nodes.reduce((total, node) => total + number(node.alpha) / (number(node.alpha) + number(node.beta)), 0) / nodes.length * 100) : 0;
      const session = latest.get(student.studentId);
      return { id: student.studentId, name: student.name, email: student.email, initials: initials(student.name), mastery, flags, latestSession: session ? { id: session.id, state: session.state, createdAt: asDate(session.createdAt) } : null };
    }).filter((student) => !normalized || student.name.toLowerCase().includes(normalized));
  }
  async assignmentsForTeacher(teacherId, classId) {
    const conditions = [eq(schema.assignments.teacherId, teacherId)]; if (classId) conditions.push(eq(schema.assignments.classId, classId));
    const rows = await this.db.select().from(schema.assignments).where(and(...conditions)).orderBy(desc(schema.assignments.createdAt));
    return Promise.all(rows.map(async (assignment) => {
      const linked = await this.db.select().from(schema.diagnosticSessions).where(eq(schema.diagnosticSessions.assignmentId, assignment.id));
      const ids = linked.map((session) => session.studentId);
      const profileRows = ids.length ? await this.db.select().from(schema.studentProfiles).where(inArray(schema.studentProfiles.studentId, ids)) : [];
      const flagged = new Set(profileRows.filter((profile) => profile.flags?.length).map((profile) => profile.studentId));
      return { id: assignment.id, classId: assignment.classId, teacherId: assignment.teacherId, domain: assignment.domain, title: assignment.title, createdAt: asDate(assignment.createdAt), ...assignment.payload, total: linked.length, complete: linked.filter((session) => session.state === "complete").length, active: linked.filter((session) => ["assigned", "in_progress", "follow_up"].includes(session.state)).length, flagged: linked.filter((session) => flagged.has(session.studentId)).length };
    }));
  }
  async studentDashboard(studentId) {
    const rows = await this.db.select({ session: schema.diagnosticSessions, assignment: schema.assignments, className: schema.classes.name }).from(schema.diagnosticSessions).innerJoin(schema.assignments, eq(schema.assignments.id, schema.diagnosticSessions.assignmentId)).innerJoin(schema.classes, eq(schema.classes.id, schema.diagnosticSessions.classId)).where(eq(schema.diagnosticSessions.studentId, studentId)).orderBy(desc(schema.diagnosticSessions.createdAt));
    const ontology = await this.activeOntology("physics"), profile = await this.profileForOntology(studentId, ontology);
    const nodes = Object.values(profile), mastery = nodes.length ? Math.round(nodes.reduce((sum, node) => sum + node.alpha / (node.alpha + node.beta), 0) / nodes.length * 100) : 0;
    const assignments = rows.map(({ session, assignment, className }) => ({ id: session.id, assignmentId: assignment.id, title: assignment.title, domain: assignment.domain, className, state: session.state, targetId: session.payload.targetId, createdAt: asDate(session.createdAt), followUpCount: session.payload.followUps?.length || 0 }));
    return { revision: ontology ? { id: ontology.id, version: ontology.version, title: ontology.title } : null, assignments, summary: { mastery, total: assignments.length, ready: assignments.filter((item) => ["assigned", "in_progress", "follow_up"].includes(item.state)).length, complete: assignments.filter((item) => item.state === "complete").length } };
  }
  async activityForTeacher(teacherId) {
    const rows = await this.db.select({ session: schema.diagnosticSessions, className: schema.classes.name, studentName: schema.users.name }).from(schema.diagnosticSessions).innerJoin(schema.classes, eq(schema.classes.id, schema.diagnosticSessions.classId)).innerJoin(schema.users, eq(schema.users.id, schema.diagnosticSessions.studentId)).where(eq(schema.classes.teacherId, teacherId)).orderBy(desc(schema.diagnosticSessions.createdAt)).limit(12);
    const ids = rows.map((row) => row.session.studentId), profileRows = ids.length ? await this.db.select().from(schema.studentProfiles).where(inArray(schema.studentProfiles.studentId, ids)) : [];
    const flags = new Map(); for (const row of profileRows) flags.set(row.studentId, [...new Set([...(flags.get(row.studentId) || []), ...(row.flags || [])])]);
    return rows.map(({ session, className, studentName }) => ({ id: session.id, type: session.state === "complete" ? "complete" : "session", student: studentName, state: session.state, at: asDate(session.createdAt), className, flags: flags.get(session.studentId) || [] }));
  }

  async createAssignment({ classId, domain, teacherId, studentIds, sessions }) {
    return this.db.transaction(async (tx) => {
      const classRow = (await tx.select().from(schema.classes).where(and(eq(schema.classes.id, classId), eq(schema.classes.teacherId, teacherId))).limit(1))[0];
      if (!classRow) return null;
      const memberships = studentIds.length ? await tx.select({ studentId: schema.memberships.studentId }).from(schema.memberships).where(and(eq(schema.memberships.classId, classId), inArray(schema.memberships.studentId, studentIds))) : [];
      if (memberships.length !== studentIds.length) return { forbidden: true };
      const revisionIds = [...new Set(sessions.map((session) => session.ontologyRevisionId))];
      if (revisionIds.length !== 1 || !revisionIds[0]) return { invalidTarget: true };
      const revision = (await tx.select().from(schema.ontologyRevisions).where(and(eq(schema.ontologyRevisions.id, revisionIds[0]), eq(schema.ontologyRevisions.status, "published"))).limit(1))[0];
      if (!revision) return { invalidTarget: true };
      const targetIds = [...new Set(sessions.map((session) => session.targetId))];
      const targets = targetIds.length ? await tx.select().from(schema.ontologyConcepts).where(and(eq(schema.ontologyConcepts.revisionId, revision.id), inArray(schema.ontologyConcepts.id, targetIds))) : [];
      if (targets.length !== targetIds.length || targets.some((target) => target.domain !== domain)) return { invalidTarget: true };
      const decisionGradeTargetIds = new Set(targets.filter((target) => target.track !== "legacy").map((target) => target.id));
      const legacyProfiles = [...new Map(sessions.filter((session) => !decisionGradeTargetIds.has(session.targetId)).map((session) => [`${session.studentId}:${session.targetId}`, { studentId: session.studentId, competencyId: session.targetId, alpha: "1", beta: "1", flags: [], evidence: [] }])).values()];
      const revisionProfiles = [...new Map(sessions.filter((session) => decisionGradeTargetIds.has(session.targetId)).map((session) => [`${session.studentId}:${session.targetId}`, { studentId: session.studentId, ontologyRevisionId: revision.id, competencyId: session.targetId, alpha: "1", beta: "1", flags: [], evidence: [] }])).values()];
      if (legacyProfiles.length) await tx.insert(schema.studentProfiles).values(legacyProfiles).onConflictDoNothing();
      if (revisionProfiles.length) await tx.insert(schema.studentOntologyBeliefs).values(revisionProfiles).onConflictDoNothing();
      const assignment = { id: id("assignment"), classId, domain, teacherId, title: "Mechanics boundary diagnostic", studentIds, createdAt: new Date().toISOString() };
      await tx.insert(schema.assignments).values({ id: assignment.id, classId, teacherId, domain, title: assignment.title, payload: { studentIds } });
      const created = sessions.map((data) => ({ id: id("session"), assignmentId: assignment.id, classId, studentId: data.studentId, targetId: data.targetId, ontologyRevisionId: data.ontologyRevisionId, item: data.item, generation: data.generation, workZone: data.workZone, followUps: [], state: "assigned", createdAt: new Date().toISOString() }));
      if (created.length) {
        await tx.insert(schema.diagnosticSessions).values(created.map(({ id: sessionId, assignmentId, classId: sessionClassId, studentId, state, createdAt, ...payload }) => ({ id: sessionId, assignmentId, classId: sessionClassId, studentId, state, payload, createdAt: new Date(createdAt) })));
        await tx.insert(schema.generatedItems).values(created.map((session) => ({ id: id("item"), sessionId: session.id, promptVersion: session.generation.promptVersion || "mechanics-v1", modelMetadata: { source: session.generation.source, attempts: session.generation.attempts, ontologyRevisionId: session.ontologyRevisionId, targetId: session.targetId, ...(session.generation.metadata || {}) }, verifierResult: session.generation.verifierResult || { valid: true, source: "generation-contract" }, item: session.item })));
      }
      return { assignment, sessions: created };
    });
  }
  async sessionForId(sessionId) { const row = (await this.db.select().from(schema.diagnosticSessions).where(eq(schema.diagnosticSessions.id, sessionId)).limit(1))[0]; return row ? sessionFromRow(row) : null; }
  async sessionForStudent(sessionId, studentId) { const row = (await this.db.select().from(schema.diagnosticSessions).where(and(eq(schema.diagnosticSessions.id, sessionId), eq(schema.diagnosticSessions.studentId, studentId))).limit(1))[0]; return row ? sessionFromRow(row) : null; }
  async sessionForTeacher(sessionId, teacherId) { const row = (await this.db.select({ session: schema.diagnosticSessions }).from(schema.diagnosticSessions).innerJoin(schema.classes, eq(schema.classes.id, schema.diagnosticSessions.classId)).where(and(eq(schema.diagnosticSessions.id, sessionId), eq(schema.classes.teacherId, teacherId))).limit(1))[0]; return row ? sessionFromRow(row.session) : null; }
  async evidenceForSession(sessionId) { return this.db.select().from(schema.traceSnapshots).where(eq(schema.traceSnapshots.sessionId, sessionId)).orderBy(desc(schema.traceSnapshots.createdAt)); }
  async evidenceDetails(sessionId) {
    const session = await this.sessionForId(sessionId); if (!session) return null;
    const [student, evidence, generated, evaluations] = await Promise.all([this.userForId(session.studentId), this.evidenceForSession(sessionId), this.db.select().from(schema.generatedItems).where(eq(schema.generatedItems.sessionId, sessionId)).orderBy(desc(schema.generatedItems.createdAt)), this.db.select().from(schema.evidenceEvaluations).where(eq(schema.evidenceEvaluations.sessionId, sessionId)).orderBy(desc(schema.evidenceEvaluations.createdAt))]);
    const ontology = session.ontologyRevisionId ? await this.ontologyForId(session.ontologyRevisionId) : null;
    const profile = await this.profileForOntology(session.studentId, ontology);
    const target = profile[session.targetId];
    return { session: { id: session.id, state: session.state, targetId: session.targetId, ontologyRevisionId: session.ontologyRevisionId, student: student?.name, createdAt: session.createdAt }, generatedItems: generated.map((entry) => ({ id: entry.id, promptVersion: entry.promptVersion, modelMetadata: entry.modelMetadata, verifierResult: entry.verifierResult, item: entry.item, createdAt: asDate(entry.createdAt) })), evidence: evidence.map((entry) => ({ atlasSnapshot: entry.atlasSnapshot, explanation: entry.explanation, traceFeatures: entry.traceFeatures, submitted: Boolean(entry.traceFeatures?.submitted), at: asDate(entry.createdAt) })), evaluations: evaluations.map((entry) => ({ criterionResults: entry.criterionResults, aggregate: entry.aggregate, modelMetadata: entry.modelMetadata, promptVersion: entry.evaluatorPromptVersion, at: asDate(entry.createdAt) })), decision: target?.evidence?.find((entry) => entry.sessionId === sessionId) || null, flags: target?.flags || [] };
  }
  async submitEvidence({ sessionId, key, atlasSnapshot, traceFeatures, explanation, submitted }) {
    return this.db.transaction(async (tx) => {
      const previous = (await tx.select().from(schema.idempotencyKeys).where(and(eq(schema.idempotencyKeys.sessionId, sessionId), eq(schema.idempotencyKeys.key, key))).limit(1))[0];
      if (previous) return previous.response;
      const response = { accepted: true, rawStrokesStored: false, receivedAt: new Date().toISOString() };
      await tx.insert(schema.traceSnapshots).values({ sessionId, atlasSnapshot, traceFeatures: safeTraceFeatures(traceFeatures, submitted), explanation: explanation || null, createdAt: new Date(response.receivedAt) });
      await tx.insert(schema.idempotencyKeys).values({ sessionId, key, response });
      return response;
    });
  }
  async idempotencyResponse(sessionId, key) {
    return (await this.db.select({ response: schema.idempotencyKeys.response }).from(schema.idempotencyKeys).where(and(eq(schema.idempotencyKeys.sessionId, sessionId), eq(schema.idempotencyKeys.key, key))).limit(1))[0]?.response || null;
  }
  async completeOrFollowUp({ sessionId, inference, posterior, uncertaintyFlags }) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM sessions WHERE id = ${sessionId} FOR UPDATE`);
      const row = (await tx.select().from(schema.diagnosticSessions).where(eq(schema.diagnosticSessions.id, sessionId)).limit(1))[0];
      if (!row) return null;
      const session = sessionFromRow(row), followUps = session.followUps || [];
      if (inference.followUpNeeded && followUps.length < 2) {
        const followUp = { prompt: "Which force causes the cart's acceleration? State the equation and its units.", expectedEvidence: ["net force", "F = ma"] };
        await tx.update(schema.diagnosticSessions).set({ state: "follow_up", payload: { ...row.payload, followUps: [...followUps, followUp] }, updatedAt: new Date() }).where(eq(schema.diagnosticSessions.id, sessionId));
        return { state: "follow_up", followUp, session };
      }
      await tx.execute(sql`SELECT student_id FROM student_profiles WHERE student_id = ${session.studentId} AND competency_id = ${session.targetId} FOR UPDATE`);
      const profileRow = (await tx.select().from(schema.studentProfiles).where(and(eq(schema.studentProfiles.studentId, session.studentId), eq(schema.studentProfiles.competencyId, session.targetId))).limit(1))[0];
      if (!profileRow) throw new Error("Student profile is missing the session competency");
      const prior = { alpha: number(profileRow.alpha), beta: number(profileRow.beta), flags: profileRow.flags || [], evidence: profileRow.evidence || [] };
      const next = posterior(prior, inference.semanticScore, inference.processScore);
      const flags = uncertaintyFlags({ semanticConfidence: inference.confidence, processConfidence: inference.processScore, previousMean: prior.alpha / (prior.alpha + prior.beta), nextMean: next.mean });
      const result = { alpha: next.alpha, beta: next.beta, flags, evidence: [...prior.evidence, { sessionId, inference, at: new Date().toISOString() }] };
      await tx.update(schema.studentProfiles).set({ alpha: String(result.alpha), beta: String(result.beta), flags: result.flags, evidence: result.evidence, updatedAt: new Date() }).where(and(eq(schema.studentProfiles.studentId, session.studentId), eq(schema.studentProfiles.competencyId, session.targetId)));
      await tx.update(schema.diagnosticSessions).set({ state: "complete", updatedAt: new Date() }).where(eq(schema.diagnosticSessions.id, sessionId));
      return { state: "complete", profile: result, flags, session };
    });
  }
  async completeDecisionGradeSession({ sessionId, target, ontology, snapshot, evaluation }) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM sessions WHERE id = ${sessionId} FOR UPDATE`);
      const row = (await tx.select().from(schema.diagnosticSessions).where(eq(schema.diagnosticSessions.id, sessionId)).limit(1))[0];
      if (!row) return null;
      const session = sessionFromRow(row), followUps = session.followUps || [];
      if (session.ontologyRevisionId !== ontology.id || session.targetId !== target.id) throw new Error("Session ontology target does not match evidence evaluation.");
      const evaluationId = id("evaluation");
      await tx.insert(schema.evidenceEvaluations).values({ id: evaluationId, sessionId, traceSnapshotId: snapshot.id, ontologyRevisionId: ontology.id, competencyId: target.id, evaluatorPromptVersion: evaluation.promptVersion, modelMetadata: evaluation.modelMetadata, criterionResults: evaluation.criterionResults, aggregate: {} });
      await tx.insert(schema.studentOntologyBeliefs).values({ studentId: session.studentId, ontologyRevisionId: ontology.id, competencyId: target.id, alpha: "1", beta: "1", flags: [], evidence: [] }).onConflictDoNothing();
      await tx.execute(sql`SELECT student_id FROM student_ontology_beliefs WHERE student_id = ${session.studentId} AND ontology_revision_id = ${ontology.id} AND competency_id = ${target.id} FOR UPDATE`);
      const profileRow = (await tx.select().from(schema.studentOntologyBeliefs).where(and(eq(schema.studentOntologyBeliefs.studentId, session.studentId), eq(schema.studentOntologyBeliefs.ontologyRevisionId, ontology.id), eq(schema.studentOntologyBeliefs.competencyId, target.id))).limit(1))[0];
      const prior = { alpha: number(profileRow.alpha), beta: number(profileRow.beta), flags: profileRow.flags || [], evidence: profileRow.evidence || [] };
      const next = posteriorFromCriteria(prior, evaluation.criterionResults, target.diagnosticMetadata.evidenceCriteria);
      const temporalUnstable = prior.evidence.length > 0 && Math.abs(prior.alpha / (prior.alpha + prior.beta) - next.mean) > .35;
      if (temporalUnstable && followUps.length < 2) {
        const prompt = target.diagnosticMetadata.assessmentStrategy.followUpTemplates[followUps.length % target.diagnosticMetadata.assessmentStrategy.followUpTemplates.length];
        const followUp = { prompt, expectedEvidence: target.diagnosticMetadata.evidenceCriteria.filter((criterion) => criterion.required).map((criterion) => criterion.id), reason: "temporal_unstable" };
        await tx.update(schema.diagnosticSessions).set({ state: "follow_up", payload: { ...row.payload, followUps: [...followUps, followUp] }, updatedAt: new Date() }).where(eq(schema.diagnosticSessions.id, sessionId));
        return { state: "follow_up", followUp, flags: ["temporal_unstable"], evaluationId, session };
      }
      const allBeliefs = await tx.select().from(schema.studentOntologyBeliefs).where(and(eq(schema.studentOntologyBeliefs.studentId, session.studentId), eq(schema.studentOntologyBeliefs.ontologyRevisionId, ontology.id)));
      const trackById = new Map(ontology.concepts.map((concept) => [concept.id, concept.track]));
      const trackMeans = new Map();
      for (const belief of allBeliefs) {
        const value = belief.competencyId === target.id ? next : { alpha: number(belief.alpha), beta: number(belief.beta), evidence: belief.evidence || [] };
        if (!(value.evidence?.length || belief.competencyId === target.id)) continue;
        const track = trackById.get(belief.competencyId), current = trackMeans.get(track) || [];
        current.push(value.alpha / (value.alpha + value.beta)); trackMeans.set(track, current);
      }
      const means = [...trackMeans.values()].map((values) => values.reduce((sum, value) => sum + value, 0) / values.length);
      const divergence = means.length > 1 && Math.max(...means) - Math.min(...means) >= .25;
      const decision = decisionForPosterior(next, target.diagnosticMetadata.decisionMap);
      const flags = [...new Set([...(decision.flags || []), ...(divergence ? ["track_divergence"] : []), ...(evaluation.modelMetadata.source === "vision-evaluator-unavailable" ? ["evaluator_low_confidence"] : [])])];
      const evidence = [...prior.evidence, { sessionId, evaluationId, criterionResults: evaluation.criterionResults, decision: decision.outcome, at: new Date().toISOString() }];
      const result = { alpha: next.alpha, beta: next.beta, flags, evidence };
      await tx.update(schema.studentOntologyBeliefs).set({ alpha: String(result.alpha), beta: String(result.beta), flags, evidence, updatedAt: new Date() }).where(and(eq(schema.studentOntologyBeliefs.studentId, session.studentId), eq(schema.studentOntologyBeliefs.ontologyRevisionId, ontology.id), eq(schema.studentOntologyBeliefs.competencyId, target.id)));
      await tx.update(schema.evidenceEvaluations).set({ aggregate: { support: next.support, strength: next.strength, mean: next.mean, variance: next.variance, decision, flags } }).where(eq(schema.evidenceEvaluations.id, evaluationId));
      await tx.insert(schema.competencyBeliefUpdates).values({ id: id("belief_update"), studentId: session.studentId, ontologyRevisionId: ontology.id, competencyId: target.id, sessionId, evidenceEvaluationId: evaluationId, prior, next: { alpha: next.alpha, beta: next.beta, mean: next.mean, variance: next.variance }, decision: { ...decision, flags } });
      await tx.update(schema.diagnosticSessions).set({ state: "complete", updatedAt: new Date() }).where(eq(schema.diagnosticSessions.id, sessionId));
      return { state: "complete", profile: result, flags, decision, evaluationId, session };
    });
  }
  async studentProfile(studentId) {
    const student = await this.userForId(studentId); if (!student) return null;
    const ontology = await this.activeOntology("physics"), profile = await this.profileForOntology(studentId, ontology);
    return { revision: ontology ? { id: ontology.id, version: ontology.version, title: ontology.title } : null, student: { id: student.id, name: student.name, initials: initials(student.name) }, nodes: (ontology?.concepts || []).map((node) => ({ ...node, ...(profile[node.id] || { alpha: 1, beta: 1, flags: [], evidence: [] }) })) };
  }
}

module.exports = { PostgresRepository, id, sessionFromRow, profileFromRows, safeTraceFeatures, publicUser };
