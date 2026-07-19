"use strict";

const crypto = require("node:crypto");
const { fixture } = require("../../src/seed");
const { passwordHash } = require("../../src/auth");
const { PHYSICS_ONTOLOGY } = require("../../src/ontology");

function createMemoryRepository() {
  const data = fixture(), users = new Map([["teacher_demo", { id: "teacher_demo", email: "teacher@socrates.local", name: "Dr. Maya Sen", role: "teacher", passwordHash: passwordHash() }], ...data.students.map(({ profile, ...student }) => [student.id, { ...student, passwordHash: passwordHash() }])]);
  const classes = new Map(data.classes.map((item) => [item.id, item]));
  const profiles = new Map(data.students.map((student) => [student.id, student.profile]));
  const sessions = new Map(data.assignments.map((assignment) => [assignment.session.id, { ...assignment.session, assignmentId: assignment.id, classId: assignment.classId, evidence: assignment.session.evidence ? [{ atlasSnapshot: "seeded-atlas-snapshot", traceFeatures: assignment.session.evidence, createdAt: assignment.session.createdAt }] : [] }]));
  const tokens = new Map();
  const initial = (name) => name.split(" ").map((part) => part[0]).join("");
  return {
    async userForId(userId) { return users.get(userId) || null; },
    async userForEmail(email) { return [...users.values()].find((user) => user.email === String(email).trim().toLowerCase()) || null; },
    async userForToken(token) { const auth = tokens.get(token); return auth && auth.expiresAt > Date.now() ? users.get(auth.userId) : null; },
    async createAuthSession(userId) { const token = crypto.randomBytes(16).toString("hex"); tokens.set(token, { userId, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 }); return token; },
    async renewAuthSession(token) { const auth = tokens.get(token); if (auth && auth.expiresAt > Date.now()) auth.expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; },
    async revokeAuthSession(token) { tokens.delete(token); },
    async ownsClass(teacherId, classId) { return classes.get(classId)?.teacherId === teacherId; },
    async classForId(classId) { const item = classes.get(classId); return item && { ...item }; },
    async teacherHasStudent(teacherId, studentId) { return [...classes.values()].some((item) => item.teacherId === teacherId && item.students.some((student) => student.id === studentId)); },
    async profileFor(studentId) { return profiles.get(studentId) || {}; },
    async profileForOntology(studentId) { return profiles.get(studentId) || {}; },
    async activeOntology(domain) { return domain === "physics" ? PHYSICS_ONTOLOGY : null; },
    async ontologyForId(revisionId) { return revisionId === PHYSICS_ONTOLOGY.id ? PHYSICS_ONTOLOGY : null; },
    async classSummary(item) { const linked = [...sessions.values()].filter((session) => session.classId === item.id), ids = item.students.map((student) => student.id), completed = linked.filter((session) => session.state === "complete").length, flagged = ids.filter((studentId) => Object.values(profiles.get(studentId) || {}).some((node) => node.flags?.length)).length; return { id: item.id, teacherId: item.teacherId, name: item.name, period: item.period, studentCount: ids.length, activeSessions: linked.filter((session) => ["assigned", "in_progress", "follow_up"].includes(session.state)).length, completedSessions: completed, flaggedStudents: flagged, completionRate: linked.length ? Math.round(completed / linked.length * 100) : 0 }; },
    async classesForTeacher(teacherId) { return Promise.all([...classes.values()].filter((item) => item.teacherId === teacherId).map((item) => this.classSummary(item))); },
    async studentsForClass(classId, query = "") { const item = classes.get(classId), normalized = query.toLowerCase(); return item.students.map((student) => { const nodes = Object.values(profiles.get(student.id)), mastery = Math.round(nodes.reduce((sum, node) => sum + node.alpha / (node.alpha + node.beta), 0) / nodes.length * 100), latest = [...sessions.values()].filter((session) => session.classId === classId && session.studentId === student.id).sort((a, b) => b.createdAt - a.createdAt)[0]; return { id: student.id, name: student.name, email: student.email, initials: initial(student.name), mastery, flags: [...new Set(nodes.flatMap((node) => node.flags || []))], latestSession: latest ? { id: latest.id, state: latest.state, createdAt: latest.createdAt } : null }; }).filter((student) => !normalized || student.name.toLowerCase().includes(normalized)); },
    async activityForTeacher() { return []; }, async assignmentsForTeacher() { return []; }, async studentDashboard(studentId) { const assigned = [...sessions.values()].filter((session) => session.studentId === studentId).map((session) => ({ id: session.id, assignmentId: session.assignmentId, title: "Mechanics boundary diagnostic", domain: "mechanics", className: classes.get(session.classId)?.name, state: session.state, targetId: session.targetId, createdAt: session.createdAt, followUpCount: session.followUps?.length || 0 })); const nodes = Object.values(profiles.get(studentId) || {}), mastery = Math.round(nodes.reduce((sum, node) => sum + node.alpha / (node.alpha + node.beta), 0) / Math.max(nodes.length, 1) * 100); return { assignments: assigned, summary: { mastery, total: assigned.length, ready: assigned.filter((item) => ["assigned", "in_progress", "follow_up"].includes(item.state)).length, complete: assigned.filter((item) => item.state === "complete").length } }; },
    async sessionForId(sessionId) { return sessions.get(sessionId) || null; }, async sessionForStudent(sessionId, studentId) { const session = sessions.get(sessionId); return session?.studentId === studentId ? session : null; }, async sessionForTeacher(sessionId, teacherId) { const session = sessions.get(sessionId); return session && classes.get(session.classId)?.teacherId === teacherId ? session : null; }, async evidenceForSession(sessionId) { return sessions.get(sessionId)?.evidence || []; }, async evidenceDetails() { return null; }, async idempotencyResponse() { return null; }, async studentProfile(studentId) { const student = users.get(studentId); return student ? { student: { id: student.id, name: student.name, initials: initial(student.name) }, nodes: [] } : null; },
  };
}
module.exports = { createMemoryRepository };
