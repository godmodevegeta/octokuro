"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/server");
const { createMemoryRepository } = require("./support/memory-repository");
const app = createApp({ repository: createMemoryRepository() });
const workspaceHeaders = (workspace, cookie) => ({ "x-socrates-workspace": workspace, ...(cookie ? { cookie } : {}) });
const cookieFrom = (response) => String(response.headers["set-cookie"]).split(";", 1)[0];
const cookiesFrom = (response) => (Array.isArray(response.headers["set-cookie"]) ? response.headers["set-cookie"] : [response.headers["set-cookie"]]).map((cookie) => String(cookie).split(";", 1)[0]);

async function teacherCookie() {
  const login = await app.inject({ method: "POST", url: "/auth/login", headers: workspaceHeaders("teacher"), payload: { email: "teacher@socrates.local", password: "1234" } });
  assert.equal(login.statusCode, 200);
  assert.equal("passwordHash" in login.json().user, false);
  assert.match(login.headers["set-cookie"], /^socrates_teacher_session=/);
  return cookieFrom(login);
}
async function studentCookie() {
  const login = await app.inject({ method: "POST", url: "/auth/login", headers: workspaceHeaders("student"), payload: { email: "aarav.shah@socrates.local", password: "1234" } });
  assert.equal(login.statusCode, 200);
  assert.match(login.headers["set-cookie"], /^socrates_student_session=/);
  return cookieFrom(login);
}
async function studentTwoCookie() {
  const login = await app.inject({ method: "POST", url: "/auth/login", headers: workspaceHeaders("student"), payload: { email: "aditi.rao@socrates.local", password: "1234" } });
  assert.equal(login.statusCode, 200);
  return cookieFrom(login);
}

test("teacher session exposes only its seeded workspace", async () => {
  await app.ready();
  const cookie = await teacherCookie();
  const classes = await app.inject({ method: "GET", url: "/classes", headers: workspaceHeaders("teacher", cookie) });
  assert.equal(classes.statusCode, 200);
  assert.equal(classes.json().classes[0].studentCount, 30);

  const students = await app.inject({ method: "GET", url: "/classes/class_mechanics/students", headers: workspaceHeaders("teacher", cookie) });
  assert.equal(students.statusCode, 200);
  assert.equal(students.json().students.length, 30);

  const noCookie = await app.inject({ method: "GET", url: "/classes", headers: workspaceHeaders("teacher") });
  assert.equal(noCookie.statusCode, 401);
});

test("teachers cannot request a class outside their membership", async () => {
  const cookie = await teacherCookie();
  const response = await app.inject({ method: "GET", url: "/classes/not-a-class/students", headers: workspaceHeaders("teacher", cookie) });
  assert.equal(response.statusCode, 404);
});

test("student dashboard exposes only the signed-in student's assignment sessions", async () => {
  const cookie = await studentCookie();
  const teacherWorkspace = await app.inject({ method: "GET", url: "/classes", headers: workspaceHeaders("student", cookie) });
  assert.equal(teacherWorkspace.statusCode, 403);
  const response = await app.inject({ method: "GET", url: "/students/me/dashboard", headers: workspaceHeaders("student", cookie) });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().student.id, "student_demo");
  assert.ok(response.json().assignments.every((assignment) => assignment.id === "seed_session_0"));

  const teacher = await teacherCookie();
  const teacherResponse = await app.inject({ method: "GET", url: "/students/me/dashboard", headers: workspaceHeaders("teacher", teacher) });
  assert.equal(teacherResponse.statusCode, 403);
});

test("assigned diagnostics require the owning student session", async () => {
  const noSession = await app.inject({ method: "GET", url: "/sessions/seed_session_0", headers: workspaceHeaders("student") });
  assert.equal(noSession.statusCode, 401);
  const owner = await studentCookie();
  const owned = await app.inject({ method: "GET", url: "/sessions/seed_session_0", headers: workspaceHeaders("student", owner) });
  assert.equal(owned.statusCode, 200);
  const otherStudent = await studentTwoCookie();
  const unavailable = await app.inject({ method: "GET", url: "/sessions/seed_session_0", headers: workspaceHeaders("student", otherStudent) });
  assert.equal(unavailable.statusCode, 404);
});

test("authenticated users can read the published ontology, while learning paths remain student-scoped", async () => {
  const student = await studentCookie();
  const catalog = await app.inject({ method: "GET", url: "/ontology/physics", headers: workspaceHeaders("student", student) });
  assert.equal(catalog.statusCode, 200);
  assert.equal(catalog.json().revision.id, "physics-ap-al-2026-1");
  assert.ok(catalog.json().concepts.some((concept) => concept.id === "electromagnetic-induction"));

  const concept = await app.inject({ method: "GET", url: "/ontology/physics/concepts/newtons-second-law", headers: workspaceHeaders("student", student) });
  assert.equal(concept.statusCode, 200);
  assert.ok(concept.json().concept.relations.outbound.some((relation) => relation.type === "prerequisite"));

  const ownPath = await app.inject({ method: "GET", url: "/ontology/physics/learning-path?studentId=student_demo", headers: workspaceHeaders("student", student) });
  assert.equal(ownPath.statusCode, 200);
  assert.ok(ownPath.json().recommended);

  const otherPath = await app.inject({ method: "GET", url: "/ontology/physics/learning-path?studentId=student_02", headers: workspaceHeaders("student", student) });
  assert.equal(otherPath.statusCode, 403);

  const teacher = await teacherCookie();
  const teacherPath = await app.inject({ method: "GET", url: "/ontology/physics/learning-path?studentId=student_demo", headers: workspaceHeaders("teacher", teacher) });
  assert.equal(teacherPath.statusCode, 200);
});

test("teacher and student sessions persist independently until their own explicit logout", async () => {
  const teacher = await teacherCookie(), student = await studentCookie(), browserCookies = `${teacher}; ${student}`;
  const teacherMe = await app.inject({ method: "GET", url: "/auth/me", headers: workspaceHeaders("teacher", browserCookies) });
  const studentMe = await app.inject({ method: "GET", url: "/auth/me", headers: workspaceHeaders("student", browserCookies) });
  assert.equal(teacherMe.statusCode, 200);
  assert.equal(teacherMe.json().user.role, "teacher");
  assert.equal(teacherMe.headers["cache-control"], "no-store");
  assert.match(teacherMe.headers["set-cookie"], /^socrates_teacher_session=.*Max-Age=2592000$/);
  assert.equal(studentMe.statusCode, 200);
  assert.equal(studentMe.json().user.role, "student");

  const signOutTeacher = await app.inject({ method: "POST", url: "/auth/logout", headers: workspaceHeaders("teacher", browserCookies) });
  assert.equal(signOutTeacher.statusCode, 200);
  assert.equal(signOutTeacher.headers["cache-control"], "no-store");
  assert.match(signOutTeacher.headers["set-cookie"], /^socrates_teacher_session=;.*Max-Age=0$/);
  const studentStillSignedIn = await app.inject({ method: "GET", url: "/students/me/dashboard", headers: workspaceHeaders("student", browserCookies) });
  assert.equal(studentStillSignedIn.statusCode, 200);
  const teacherSignedOut = await app.inject({ method: "GET", url: "/classes", headers: workspaceHeaders("teacher", browserCookies) });
  assert.equal(teacherSignedOut.statusCode, 401);
});

test("a workspace accepts only its matching role and requires explicit selection", async () => {
  const teacherInStudent = await app.inject({ method: "POST", url: "/auth/login", headers: workspaceHeaders("student"), payload: { email: "teacher@socrates.local", password: "1234" } });
  assert.equal(teacherInStudent.statusCode, 403);
  const studentInTeacher = await app.inject({ method: "POST", url: "/auth/login", headers: workspaceHeaders("teacher"), payload: { email: "aarav.shah@socrates.local", password: "1234" } });
  assert.equal(studentInTeacher.statusCode, 403);
  const missingWorkspace = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "teacher@socrates.local", password: "1234" } });
  assert.equal(missingWorkspace.statusCode, 400);
});

test("a legacy session upgrades once and cannot restore a workspace after explicit logout", async () => {
  const teacher = await teacherCookie(), legacyTeacher = teacher.replace("socrates_teacher_session", "socrates_session");
  const upgraded = await app.inject({ method: "GET", url: "/auth/me", headers: workspaceHeaders("teacher", legacyTeacher) });
  assert.equal(upgraded.statusCode, 200);
  assert.deepEqual(cookiesFrom(upgraded).map((cookie) => cookie.split("=", 1)[0]).sort(), ["socrates_session", "socrates_teacher_session"]);
  assert.match(cookiesFrom(upgraded).find((cookie) => cookie.startsWith("socrates_session=")), /^socrates_session=$/);
  const namedTeacher = cookiesFrom(upgraded).find((cookie) => cookie.startsWith("socrates_teacher_session="));

  const logout = await app.inject({ method: "POST", url: "/auth/logout", headers: workspaceHeaders("teacher", `${namedTeacher}; ${legacyTeacher}`) });
  assert.equal(logout.statusCode, 200);
  assert.deepEqual(cookiesFrom(logout).map((cookie) => cookie.split("=", 1)[0]).sort(), ["socrates_session", "socrates_teacher_session"]);
  const refreshed = await app.inject({ method: "GET", url: "/auth/me", headers: workspaceHeaders("teacher", legacyTeacher) });
  assert.equal(refreshed.statusCode, 401);
});

test.after(async () => { await app.close(); });
