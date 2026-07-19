"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Writable } = require("node:stream");
const Fastify = require("fastify");
const websocket = require("@fastify/websocket");
const { conceptDetail, learningPath, teachingPlan } = require("./ontology");
const { posterior, uncertaintyFlags } = require("./bayes");
const { generateValidatedItem, defaultInference, evaluateEvidence } = require("./executor");
const { localHealth } = require("./health");
const { durableStores } = require("./db");
const { PostgresRepository, publicUser } = require("./repository");
const { syncSeed } = require("./seed");
const { passwordMatches } = require("./auth");

function loadLocalEnv() {
  for (const file of [path.resolve(__dirname, "../../../.env"), path.resolve(__dirname, "../.env")]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
}
const AUTH_WORKSPACES = new Set(["teacher", "student"]);
const AUTH_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const sessionCookieName = (workspace) => `socrates_${workspace}_session`;
const LEGACY_SESSION_COOKIE = "socrates_session";
function cookieValue(request, name) { return String(request.headers.cookie || "").split(";").map((entry) => entry.trim().split("=")).find(([key]) => key === name)?.[1]; }
function workspaceFor(request) { const workspace = request.headers["x-socrates-workspace"]; return typeof workspace === "string" && AUTH_WORKSPACES.has(workspace) ? workspace : null; }
function sessionCookie(workspace, token) { return `${sessionCookieName(workspace)}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${AUTH_SESSION_TTL_SECONDS}`; }
function expiredSessionCookie(workspace) { return `${sessionCookieName(workspace)}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`; }
function expiredLegacySessionCookie() { return `${LEGACY_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`; }
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function createApp({ repository, redis } = {}) {
  if (!repository) throw new Error("A repository is required. Use PostgresRepository for application startup or inject a test repository.");
  const logStream = new Writable({ write(chunk, _encoding, done) { try { const record = JSON.parse(chunk); delete record.level; process.stdout.write(`${JSON.stringify(record)}\n`, done); } catch (error) { done(error); } } });
  const app = Fastify({ logController: new Fastify.LogController({ disableRequestLogging: true }), logger: { level: process.env.SOCRATES_LOG_LEVEL || "info", base: null, timestamp: false, stream: logStream, redact: { paths: ["req.headers.authorization", "req.headers.cookie", "req.body.atlasSnapshot", "req.body.token", "req.body.email"], censor: "[REDACTED]" } } });
  app.register(websocket);
  const statusSockets = new Set(), allowedOrigins = new Set(["http://localhost:3000", "http://127.0.0.1:3000", "http://127.0.0.1:3888", "http://localhost:3888"]);
  const broadcastStatus = (event) => { const payload = JSON.stringify(event); for (const socket of statusSockets) if (socket.readyState === socket.OPEN) socket.send(payload); };
  const publishStatus = async (event) => { if (redis) await redis.publish("socrates:session-status", JSON.stringify(event)); else broadcastStatus(event); };
  app.broadcastStatus = broadcastStatus;
  app.addHook("onSend", async (request, reply) => { const origin = request.headers.origin; if (allowedOrigins.has(origin)) { reply.header("access-control-allow-origin", origin); reply.header("access-control-allow-credentials", "true"); reply.header("access-control-allow-methods", "GET, POST, OPTIONS"); reply.header("vary", "origin"); } if (request.url.startsWith("/auth/")) reply.header("cache-control", "no-store"); reply.header("access-control-allow-headers", "content-type, x-socrates-user, x-socrates-workspace"); });
  app.options("*", async (_request, reply) => reply.code(204).send());
  app.get("/session-status", { websocket: true }, (socket) => { statusSockets.add(socket); socket.on("close", () => statusSockets.delete(socket)); });
  app.addHook("preHandler", async (request, reply) => {
    request.workspace = workspaceFor(request);
    const namedToken = request.workspace ? cookieValue(request, sessionCookieName(request.workspace)) : null;
    const legacyToken = request.workspace && !namedToken ? cookieValue(request, LEGACY_SESSION_COOKIE) : null;
    const token = namedToken || legacyToken;
    request.user = await repository.userForToken(token);
    if (request.user && request.workspace && request.user.role !== request.workspace) request.user = null;
    if (!request.user && process.env.NODE_ENV === "test") request.user = await repository.userForId(request.headers["x-socrates-user"]);
    if (request.user && request.workspace && !request.url.startsWith("/auth/logout")) {
      await repository.renewAuthSession?.(token);
      reply.header("set-cookie", legacyToken ? [sessionCookie(request.workspace, token), expiredLegacySessionCookie()] : sessionCookie(request.workspace, token));
    }
  });
  app.setErrorHandler((error, request, reply) => { request.log.error({ err: error, event: "request.failed", userId: request.user?.id }, "Assessment API request failed"); reply.code(error.statusCode || 500).send({ error: "Internal server error" }); });
  const requireRole = (role) => async (request, reply) => { if (!request.user) return reply.code(401).send({ error: "authentication required" }); if (request.user.role !== role) return reply.code(403).send({ error: "forbidden" }); };
  const requireAuth = async (request, reply) => { if (!request.user) return reply.code(401).send({ error: "authentication required" }); };

  app.get("/health", async () => ({ ok: true, services: await localHealth(), persistence: "postgres-redis", mode: "local-pilot" }));
  app.post("/auth/login", async (request, reply) => { const workspace = request.workspace; if (!workspace) return reply.code(400).send({ error: "a valid workspace is required" }); const user = await repository.userForEmail(request.body?.email); if (!user || !passwordMatches(user.passwordHash, request.body?.password || "")) { request.log.warn({ event: "auth.password.rejected", knownUser: !!user }, "Password sign-in rejected"); return reply.code(401).send({ error: "invalid email or password" }); } if (user.role !== workspace) return reply.code(403).send({ error: `This account must sign in through the ${user.role} workspace.` }); const token = await repository.createAuthSession(user.id); reply.header("set-cookie", sessionCookie(workspace, token)); request.log.info({ event: "auth.password.verified", userId: user.id, role: user.role }, "Password sign-in verified"); return { user: publicUser(user) }; });
  app.post("/auth/magic-link", async (_request, reply) => reply.code(410).send({ error: "Password sign-in is required for this local pilot." }));
  app.post("/auth/verify", async (_request, reply) => reply.code(410).send({ error: "Password sign-in is required for this local pilot." }));
  app.get("/auth/me", async (request, reply) => { if (!request.user) return reply.code(401).send({ error: "authentication required" }); return { user: request.user }; });
  app.post("/auth/logout", async (request, reply) => {
    if (!request.workspace) return reply.code(400).send({ error: "a valid workspace is required" });
    const namedToken = cookieValue(request, sessionCookieName(request.workspace)), legacyToken = cookieValue(request, LEGACY_SESSION_COOKIE), tokens = [namedToken].filter(Boolean), cookies = [expiredSessionCookie(request.workspace)];
    if (legacyToken) {
      const legacyUser = await repository.userForToken(legacyToken);
      if (legacyUser?.role === request.workspace) { tokens.push(legacyToken); cookies.push(expiredLegacySessionCookie()); }
    }
    await Promise.all([...new Set(tokens)].map((token) => repository.revokeAuthSession(token)));
    reply.header("set-cookie", cookies.length === 1 ? cookies[0] : cookies);
    return { ok: true };
  });
  app.get("/classes", { preHandler: requireRole("teacher") }, async (request) => ({ classes: await repository.classesForTeacher(request.user.id) }));
  app.get("/classes/:id", { preHandler: requireRole("teacher") }, async (request, reply) => { const classItem = await repository.classForId(request.params.id); if (!classItem || classItem.teacherId !== request.user.id) return reply.code(404).send({ error: "class not found" }); return { class: await repository.classSummary(classItem) }; });
  app.get("/classes/:id/students", { preHandler: requireRole("teacher") }, async (request, reply) => { if (!await repository.ownsClass(request.user.id, request.params.id)) return reply.code(404).send({ error: "class not found" }); return { students: await repository.studentsForClass(request.params.id, request.query?.q || "") }; });
  app.get("/activity", { preHandler: requireRole("teacher") }, async (request) => ({ activity: await repository.activityForTeacher(request.user.id) }));
  app.get("/ontology/physics", { preHandler: requireAuth }, async (_request, reply) => {
    const ontology = await repository.activeOntology("physics");
    if (!ontology) return reply.code(404).send({ error: "published physics ontology not found" });
    return { revision: { id: ontology.id, domain: ontology.domain, version: ontology.version, title: ontology.title, publishedAt: ontology.publishedAt }, concepts: ontology.concepts.map(({ id, title, domain, topic, track, abstraction, level }) => ({ id, title, domain, topic, track, abstraction, level })) };
  });
  app.get("/ontology/physics/concepts/:id", { preHandler: requireAuth }, async (request, reply) => {
    const ontology = await repository.activeOntology("physics");
    if (!ontology) return reply.code(404).send({ error: "published physics ontology not found" });
    const concept = conceptDetail(ontology, request.params.id);
    if (!concept) return reply.code(404).send({ error: "concept not found" });
    return { revision: { id: ontology.id, domain: ontology.domain, version: ontology.version }, concept };
  });
  app.get("/ontology/physics/learning-path", { preHandler: requireAuth }, async (request, reply) => {
    const studentId = request.query?.studentId;
    if (!studentId) return reply.code(400).send({ error: "studentId is required" });
    if (request.user.role === "student" && request.user.id !== studentId) return reply.code(403).send({ error: "forbidden" });
    if (request.user.role === "teacher" && !await repository.teacherHasStudent(request.user.id, studentId)) return reply.code(403).send({ error: "forbidden" });
    if (!["student", "teacher"].includes(request.user.role)) return reply.code(403).send({ error: "forbidden" });
    const ontology = await repository.activeOntology("physics");
    if (!ontology) return reply.code(404).send({ error: "published physics ontology not found" });
    const path = teachingPlan(ontology, await repository.profileForOntology(studentId, ontology));
    return { revision: { id: ontology.id, domain: ontology.domain, version: ontology.version, title: ontology.title, publishedAt: ontology.publishedAt }, studentId, ...path };
  });
  app.post("/assignments", { preHandler: requireRole("teacher") }, async (request, reply) => {
    const { classId, domain, studentIds } = request.body || {};
    if (domain !== "mechanics" || !Array.isArray(studentIds) || !studentIds.length) return reply.code(400).send({ error: "Invalid class, domain, or students" });
    if (!await repository.ownsClass(request.user.id, classId)) return reply.code(400).send({ error: "Invalid class or domain" });
    const ontology = await repository.activeOntology("physics");
    if (!ontology) return reply.code(503).send({ error: "published physics ontology is unavailable" });
    const profiles = await Promise.all(studentIds.map((studentId) => repository.profileForOntology(studentId, ontology)));
    const generated = await Promise.all(profiles.map(async (profile) => {
      const recommendation = learningPath(ontology, profile, { targetDomain: domain }).recommended;
      if (!recommendation) throw new Error(`No ready ${domain} concept is available for assignment.`);
      const target = ontology.concepts.find((concept) => concept.id === recommendation.id);
      return { targetId: target.id, ontologyRevisionId: ontology.id, ...(await generateValidatedItem(target)), workZone: { x: 1800, y: 4500, width: 16400, height: 13000 } };
    }));
    const created = await repository.createAssignment({ classId, domain, teacherId: request.user.id, studentIds, sessions: studentIds.map((studentId, index) => ({ studentId, ...generated[index] })) });
    if (!created?.assignment) return reply.code(created?.forbidden ? 403 : 400).send({ error: created?.forbidden ? "Student is not in this class" : created?.invalidTarget ? "Invalid ontology target" : "Invalid class or domain" });
    const status = created.sessions.map((session) => ({ studentId: session.studentId, sessionId: session.id, state: session.state }));
    request.log.info({ event: "assignment.created", assignmentId: created.assignment.id, classId, domain, studentCount: status.length, teacherId: request.user.id }, "Mechanics diagnostic assigned");
    for (const session of created.sessions) request.log.info({ event: "session.assigned", assignmentId: created.assignment.id, sessionId: session.id, studentId: session.studentId, targetId: session.targetId, generationSource: session.generation.source, attempts: session.generation.attempts }, "Diagnostic session ready");
    await publishStatus({ type: "assignment.created", assignmentId: created.assignment.id, sessions: status });
    return reply.code(201).send({ assignment: created.assignment, sessions: status });
  });
  app.get("/assignments", { preHandler: requireRole("teacher") }, async (request, reply) => { const classId = request.query?.classId; if (classId && !await repository.ownsClass(request.user.id, classId)) return reply.code(404).send({ error: "class not found" }); return { assignments: await repository.assignmentsForTeacher(request.user.id, classId) }; });
  app.get("/students/me/dashboard", { preHandler: requireRole("student") }, async (request) => ({ student: { id: request.user.id, name: request.user.name, initials: request.user.name.split(" ").map((part) => part[0]).join("") }, ...(await repository.studentDashboard(request.user.id)) }));
  app.get("/sessions/:id", async (request, reply) => { if (!request.user) return reply.code(401).send({ error: "authentication required" }); const session = request.user.role === "student" ? await repository.sessionForStudent(request.params.id, request.user.id) : request.user.role === "teacher" ? await repository.sessionForTeacher(request.params.id, request.user.id) : null; if (!session) return reply.code(404).send({ error: "not found" }); const ontology = session.ontologyRevisionId ? await repository.ontologyForId(session.ontologyRevisionId) : null, target = ontology?.concepts.find((concept) => concept.id === session.targetId); return { id: session.id, state: session.state, problem: session.item?.prompt, workZone: session.workZone, followUps: (session.followUps || []).map((followUp) => followUp.prompt), target: target ? { id: target.id, name: target.name, track: target.track, evidenceRequirements: (target.diagnosticMetadata?.evidenceCriteria || []).map(({ id, type, required, rubrics }) => ({ id, type, required, rubrics })), antiGamingCheck: target.diagnosticMetadata?.assessmentStrategy?.anti_gaming_check } : null }; });
  app.get("/sessions/:id/evidence", { preHandler: requireRole("teacher") }, async (request, reply) => { const session = await repository.sessionForTeacher(request.params.id, request.user.id); if (!session) return reply.code(404).send({ error: "not found" }); return await repository.evidenceDetails(session.id); });
  app.post("/sessions/:id/evidence", async (request, reply) => {
    if (!request.user || request.user.role !== "student") return reply.code(403).send({ error: "forbidden" });
    const session = await repository.sessionForStudent(request.params.id, request.user.id), body = request.body || {}; if (!session) return reply.code(404).send({ error: "not found" });
    if (!body.idempotencyKey || !body.traceFeatures || !body.atlasSnapshot) return reply.code(400).send({ error: "atlasSnapshot, traceFeatures, and idempotencyKey are required" });
    const ontology = session.ontologyRevisionId ? await repository.ontologyForId(session.ontologyRevisionId) : null, target = ontology?.concepts.find((concept) => concept.id === session.targetId);
    if (target?.diagnosticMetadata?.evidenceCriteria?.some((criterion) => criterion.type === "explanation" && criterion.required) && !String(body.explanation || "").trim()) return reply.code(400).send({ error: "A written explanation is required for this diagnostic" });
    const lockKey = `socrates:evidence:${session.id}:${body.idempotencyKey}`; let locked = false;
    if (redis) { locked = (await redis.set(lockKey, "1", { NX: true, EX: 15 })) === "OK"; if (!locked) for (let retry = 0; retry < 10; retry++) { const previous = await repository.idempotencyResponse(session.id, body.idempotencyKey); if (previous) return previous; await delay(20); } }
    try { const record = await repository.submitEvidence({ sessionId: session.id, key: body.idempotencyKey, atlasSnapshot: body.atlasSnapshot, traceFeatures: body.traceFeatures, explanation: body.explanation, submitted: body.submitted }); request.log.info({ event: "evidence.accepted", sessionId: session.id, studentId: session.studentId, submitted: !!body.submitted, featureGroups: ["edit_entropy", "erase_ratio", "pause_pattern", "spatial_progression", "process_order"].filter((key) => Object.hasOwn(body.traceFeatures, key)), atlasReceived: true, rawStrokesStored: false }, "Assessment evidence accepted"); return record; } finally { if (locked) await redis.del(lockKey); }
  });
  app.post("/sessions/:id/submit", async (request, reply) => {
    if (!request.user || request.user.role !== "student") return reply.code(403).send({ error: "forbidden" }); const session = await repository.sessionForStudent(request.params.id, request.user.id); if (!session) return reply.code(404).send({ error: "not found" });
    const evidence = (await repository.evidenceForSession(session.id))[0]; if (!evidence) return reply.code(400).send({ error: "Submit an evidence snapshot first" });
    const ontology = session.ontologyRevisionId ? await repository.ontologyForId(session.ontologyRevisionId) : null, target = ontology?.concepts.find((concept) => concept.id === session.targetId);
    if (target?.track && target.track !== "legacy") {
      const evaluation = await evaluateEvidence({ target, atlasSnapshot: evidence.atlasSnapshot, explanation: evidence.explanation, traceFeatures: evidence.traceFeatures, submitted: Boolean(evidence.traceFeatures?.submitted) });
      const result = await repository.completeDecisionGradeSession({ sessionId: session.id, target, ontology, snapshot: evidence, evaluation });
      if (result.state === "follow_up") { await publishStatus({ type: "session.follow_up", sessionId: session.id }); return { state: result.state, followUp: result.followUp, flags: result.flags }; }
      await publishStatus({ type: "session.complete", sessionId: session.id, flags: result.flags }); return { state: result.state, profile: result.profile, flags: result.flags, decision: result.decision };
    }
    const result = await repository.completeOrFollowUp({ sessionId: session.id, inference: defaultInference(evidence.traceFeatures, Boolean(evidence.traceFeatures?.submitted)), posterior, uncertaintyFlags });
    if (result.state === "follow_up") { request.log.info({ event: "session.follow_up", sessionId: session.id, studentId: session.studentId, targetId: session.targetId, confidence: defaultInference(evidence.traceFeatures, Boolean(evidence.traceFeatures?.submitted)).confidence }, "Follow-up probe requested"); await publishStatus({ type: "session.follow_up", sessionId: session.id }); return { state: result.state, followUp: result.followUp }; }
    request.log.info({ event: "session.complete", sessionId: session.id, studentId: session.studentId, targetId: session.targetId, posteriorMean: result.profile.alpha / (result.profile.alpha + result.profile.beta), flags: result.flags }, "Diagnostic session complete"); await publishStatus({ type: "session.complete", sessionId: session.id, flags: result.flags }); return { state: result.state, profile: result.profile, flags: result.flags };
  });
  app.get("/students/:id/profile", { preHandler: requireAuth }, async (request, reply) => { const own = request.user.id === request.params.id, sharedClass = request.user.role === "teacher" && await repository.teacherHasStudent(request.user.id, request.params.id); if (!own && !sharedClass) return reply.code(403).send({ error: "forbidden" }); const profile = await repository.studentProfile(request.params.id); if (!profile) return reply.code(404).send({ error: "student not found" }); return profile; });
  return app;
}

async function start() {
  loadLocalEnv();
  const stores = durableStores(), repository = new PostgresRepository(stores.db), app = createApp({ repository, redis: stores.redis });
  try { await stores.db.execute(require("drizzle-orm").sql`SELECT 1`); await Promise.all([stores.redis.connect(), stores.statusSubscriber.connect()]); await stores.statusSubscriber.subscribe("socrates:session-status", (payload) => app.broadcastStatus(JSON.parse(payload))); await syncSeed(stores.db); const address = await app.listen({ port: Number(process.env.SOCRATES_API_PORT || 4100), host: "localhost" }); app.log.info({ event: "api.started", address, persistence: "postgres-redis" }, "Socrates Assessment API started"); } catch (error) { app.log.fatal({ err: error, event: "api.start_failed" }, "Socrates Assessment API failed to start"); await Promise.all([stores.redis.disconnect().catch(() => {}), stores.statusSubscriber.disconnect().catch(() => {})]); await stores.sql.end({ timeout: 5 }); process.exitCode = 1; }
}
if (require.main === module) start();
module.exports = { createApp, start, loadLocalEnv };
