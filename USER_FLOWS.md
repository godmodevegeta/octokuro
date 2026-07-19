# Socrates user-flow reference

This document describes the currently implemented user and system flows in the local Socrates pilot.
It is a product reference for future contributors.

## Authentication

### Teacher sign-in

1. A teacher visits `http://localhost:3000`.
2. The dashboard clears any existing cookie and presents explicit sign-in.
3. The teacher submits email and password.
4. The API creates a durable `auth_sessions` record and returns an HTTP-only `socrates_session` cookie.
5. The teacher workspace loads only teacher-scoped classes, rosters, assignments, and activity.

### Student sign-in

1. A student visits `http://localhost:3000/student`.
2. The dashboard clears any existing cookie and presents explicit sign-in.
3. The student submits email and password.
4. The API creates a durable session and returns the cookie.
5. The student workspace loads only the signed-in student's assignments and ontology learning plan.

### Role mismatch and sign-out

- A teacher signing into the student workspace, or a student signing into the teacher workspace, is signed out and given the correct workspace instruction.
- API role checks independently block cross-role requests.
- Sign-out revokes the durable auth-session record and clears the browser cookie.

## Teacher workspace

### Classroom and roster review

1. The teacher selects a class.
2. The workspace shows class summary metrics, the class roster, diagnostic states, mastery estimates, and uncertainty flags.
3. The teacher can open a student profile only when that student belongs to one of the teacher's classes.

### Student-profile review

1. The teacher opens a student from the roster.
2. The API returns the active ontology revision and revision-scoped beliefs.
3. The teacher sees node beliefs and uncertainty flags rather than a simple grade.

### Adaptive assignment

1. The teacher opens Assign diagnostic and selects one or more students in the active class.
2. The API loads each student's active-revision beliefs.
3. The API selects the most uncertain ready competency at that student's prerequisite-aware frontier.
4. The generator creates an item for that competency and the critic verifies the target contract.
5. One assignment, one session per student, and generated-item audit records are written transactionally.
6. Redis publishes a status event for connected dashboards.

### Evidence review

1. The teacher opens a session from activity or the Evidence view.
2. The workspace displays the atlas image, student explanation, sanitized process summary, criterion-level evaluator results, flags, and instructional decision.
3. Raw stroke data is never returned or persisted.

## Student workspace

### Assignment and learning-plan review

1. The dashboard returns only the signed-in student's sessions.
2. The dashboard also requests the ontology learning path for that student.
3. The student sees assignment states, current belief summary, next diagnostic probe, its track, and a transfer prompt.
4. The plan can include remediation actions and cross-track uncertainty flags.

### Canvas handoff

1. The student clicks Start or Continue.
2. The dashboard opens Canvas with both the session ID and configured API origin.
3. Canvas and API use `localhost`, so the authenticated cookie is sent consistently.
4. Canvas loads the session only if the student owns it.

## Canvas assessment

### Evidence collection

1. Canvas loads the item, work zone, target track, evidence requirements, and anti-gaming check.
2. The student draws their representation or solution.
3. Canvas retains raw interaction events only in local browser storage.
4. Canvas derives safe aggregate process features and process-order markers.
5. Canvas presents a typed reasoning response when the target node requires or accepts explanation evidence.

### Evidence submission

1. Canvas sends an atlas image, explanation, sanitized features, submitted status, and idempotency key.
2. Redis takes a short-lived duplicate-processing lock.
3. Postgres atomically writes the trace snapshot and idempotent response.
4. Canvas can save a non-submitted snapshot on page exit.

### Completion and follow-up

1. The API evaluates only criteria declared by the target node.
2. The evaluator returns criterion support, confidence, rationale, prompt version, and model metadata.
3. The API persists evaluator output separately from the revision-scoped belief update.
4. A criterion-weighted Beta update produces a belief, flags, and instructional action.
5. A temporally unstable result creates a transfer follow-up instead of changing the belief.
6. Evaluator unavailability is persisted as low-confidence evidence, never treated as mastery.

## Ontology and adaptive teaching

### Active revision

- `physics-mechanics-2026-2` is the published decision-grade Mechanics ontology.
- It contains 20 intermediate-abstraction competencies across conceptual, procedural, representational, and mathematical-prerequisite tracks.
- Every node defines prerequisites, typed evidence, a target probe, transfer follow-ups, anti-gaming checks, and decision-map actions.

### Learning path

1. The API identifies ready nodes from prerequisite beliefs.
2. It recommends the most uncertain ready node as the next diagnostic probe.
3. It lists blocked nodes with unmet prerequisites.
4. It summarizes observed beliefs by track.
5. It identifies weak observed competencies as remediation actions.

### Revision history

- Historical sessions remain attached to `physics-ap-al-2026-1`.
- New beliefs are keyed by student, ontology revision, and competency.
- The system does not reuse legacy broad-topic beliefs for narrower decision-grade competencies.

## System and maintenance flows

### Live status

- Assignment, follow-up, and completion events publish through Redis.
- Connected clients may consume them through the `/session-status` WebSocket.

### Health

- `GET /health` reports Postgres, Redis, SymPy, and Codex reachability.
- Normal API startup fails if Postgres or Redis is unavailable.

### Ontology lifecycle

```sh
npm --workspace @socrates/api run ontology:validate
npm --workspace @socrates/api run ontology:publish -- physics-mechanics-2026-2
```

- Validation checks the reviewed YAML's node contract and prerequisite DAG.
- Publishing retires the previous published Physics revision and activates the reviewed revision transactionally.

## Deliberately not implemented

- Student self-registration.
- Teacher class or roster editing.
- Parent and administrator workspaces.
- Student-facing remediation lessons or videos.
- Teacher manual grading or belief overrides.
- Additional subject domains such as introductory Python.
