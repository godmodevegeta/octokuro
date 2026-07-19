# Socrates implementation handoff

This document is the current implementation reference for coding agents working in this repository.
It describes the system that is present in the codebase as of 2026-07-19.
Prefer this document over the older architecture narratives when they disagree with the implementation.

## Product purpose

Socrates is a local supervised Physics diagnostic pilot.
Teachers assign focused diagnostics to students.
Students work through an assigned diagnostic in the Socrates Canvas.
The API stores an auditable evidence snapshot, updates a competency belief, and exposes the result in the teacher workspace.
Students also have a dedicated dashboard at `/student` where they can review and start their own assignments.
The assessment engine is backed by a curated, versioned decision-grade Mechanics ontology.
The published `physics-mechanics-2026-2` revision has 20 observable competencies across conceptual, procedural, representational, and mathematical-prerequisite tracks.
The prior AP/A-level topic catalog remains durable historical data under `physics-ap-al-2026-1`.

The product is designed to represent uncertainty and evidence rather than a simple correct or incorrect score.

## Repository map

| Path | Responsibility |
| --- | --- |
| `apps/api` | Fastify assessment API, Postgres repository, migrations, seed data, and API tests. |
| `apps/dashboard` | Next.js teacher dashboard at `/` and student dashboard at `/student`. |
| `apps/canvas` | Socrates Canvas workbench and browser-side assessment mode. |
| `apps/verifier` | Standalone FastAPI and SymPy helper service. |
| `apps/api/drizzle` | SQL migrations. |
| `.env.example` | Required local-service configuration template. |
| `README.md` | Short local pilot setup guide. |
| `TECH_ARCHITECTURE.md` | Earlier, mostly aspirational architecture document. |
| `USER_FLOWS.md` | Current end-to-end product, assessment, and maintenance flows. |

## Current system boundaries

```text
Teacher dashboard                 Student dashboard
Next.js at localhost:3000         Next.js at localhost:3000/student
        |                                    |
        +------------ cookies + JSON --------+
                             |
                    Assessment API
                 Fastify at localhost:4100
                    |                 |
              Postgres             Redis
             durable truth      ephemeral locks
                    |
           Socrates Canvas at localhost:3888
           opens /?session=<sessionId>
```

Postgres is the sole durable source of truth for application data.
Redis is used only for ephemeral coordination.
The API fails normal startup unless both `DATABASE_URL` and `REDIS_URL` are configured and reachable.

## Local startup

Copy `.env.example` to `.env` and supply valid local service values.

```sh
npm install
npm --workspace @socrates/api run db:migrate
npm --workspace @socrates/api run ontology:validate
npm --workspace @socrates/api run ontology:publish -- physics-mechanics-2026-2
npm run start:api
npm --workspace @socrates/canvas start
npm --workspace @socrates/dashboard run dev
```

The API loads `.env` automatically when it starts.
The API seeds missing demo data idempotently after Postgres and Redis connect.
The API does not have a development-memory fallback.

Useful local URLs are listed below.

| URL | Purpose |
| --- | --- |
| `http://localhost:3000` | Teacher dashboard. |
| `http://localhost:3000/student` | Student dashboard. |
| `http://localhost:4100/health` | API dependency health response. |
| `http://localhost:3888` | Canvas. |
| `http://localhost:8001/health` | Optional SymPy verifier health response. |

Do not run `next build` while an existing `next dev` process is serving the dashboard.
Doing so can replace the active `.next` assets and cause stylesheet 404 responses.
Restart the dashboard dev process if that happens.

## Configuration

The current environment contract is in `.env.example`.

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Required Postgres connection string. |
| `REDIS_URL` | Required Redis connection string. |
| `SYMPY_VERIFIER_URL` | Health-check target for the optional verifier. |
| `CODEX_CLI_PATH` | Codex executable path, defaulting to `codex`. |
| `CODEX_CLI_MODEL` | Optional model label saved with generated-item metadata. |
| `SOCRATES_API_PORT` | API listener port, defaulting to `4100`. |
| `SOCRATES_DEV_MAGIC_LINKS` | Legacy setting that is no longer used by the password-based local login flow. |
| `NEXT_PUBLIC_SOCRATES_API` | Optional public dashboard API origin, defaulting to `http://localhost:4100`. |
| `NEXT_PUBLIC_SOCRATES_CANVAS` | Optional student dashboard Canvas origin, defaulting to `http://localhost:3888`. |

## Durable data model

The Drizzle schema is in `apps/api/src/schema.js`.
The initial schema migration is `apps/api/drizzle/0000_initial.sql`.
The durable-repository migration is `apps/api/drizzle/0001_durable_repository.sql`.

| Table | Durable responsibility |
| --- | --- |
| `users` | Teacher and student identities. |
| `classes` | Teacher-owned classrooms. |
| `memberships` | Student membership in classes. |
| `competency_nodes` | The 20-node Mechanics prerequisite graph. |
| `student_profiles` | Per-student competency beta posterior, flags, and decision evidence. |
| `ontology_revisions` | Immutable curated ontology versions and their publication state. |
| `ontology_concepts` | Revision-scoped Physics concepts with topic, level, and diagnostic metadata. |
| `ontology_relations` | Typed prerequisite, related, part-of, and misconception relationships. |
| `student_ontology_beliefs` | Revision-scoped student beta beliefs for decision-grade competencies. |
| `evidence_evaluations` | Criterion-level evaluator output linked to a trace snapshot and ontology target. |
| `competency_belief_updates` | Immutable prior, next, and instructional-decision audit records. |
| `assignments` | Teacher-created diagnostic assignment records. |
| `sessions` | One student diagnostic session with query-critical columns and flexible JSON payload. |
| `generated_items` | Prompt version, model metadata, verifier result, and structured generated item. |
| `trace_snapshots` | Atlas snapshot plus sanitized trace features. |
| `idempotency_keys` | Durable evidence-submission result keyed by session and idempotency key. |
| `auth_sessions` | Cookie-backed authentication sessions with expiry. |

`sessions.payload` holds flexible session-specific fields such as the target competency, item content, generation details, work-zone geometry, and follow-up prompts.
`sessions.state`, assignment IDs, class IDs, student IDs, and timestamps remain indexed columns for query access.

The seed routine is `apps/api/src/seed.js`.
It uses conflict-safe inserts and never overwrites existing rows.
It creates the demo teacher, 30 students, two classes, legacy profiles, the historical `physics-ap-al-2026-1` revision, and the draft `physics-mechanics-2026-2` revision only when corresponding rows are absent.
Publishing is explicit and structurally revalidates the reviewed YAML before retiring the previous Physics revision.

## Repository and persistence rules

`apps/api/src/repository.js` contains `PostgresRepository`.
Normal API startup always constructs this repository over Drizzle and Postgres.
The only in-memory repository is `apps/api/test/support/memory-repository.js`.
It is injected only into isolated Fastify tests.

Do not introduce runtime Maps as an authoritative store.
Do not add a normal-development in-memory fallback.
Do not persist raw stroke events.

Evidence writes whitelist only these trace-feature keys.

```text
edit_entropy
erase_ratio
pause_pattern
spatial_progression
submitted
```

The repository discards unrecognized trace-feature properties before writing Postgres.
This prevents raw event arrays from being stored even if a client sends an unexpected field.

## Authentication and authorization

Authentication uses a cookie named `socrates_session`.
The token is random and stored in `auth_sessions` with a 12-hour expiry.
Expired or revoked tokens are deleted from Postgres.

The local pilot uses an explicit email-and-password form at `POST /auth/login`.
Every local user, including all seeded teachers and students, has password `1234`.
Password hashes are persisted in `users.password_hash` and are never included in API responses.
The legacy magic-link routes return `410 Gone` and cannot authenticate a user.

The API derives the current user from the cookie on every authenticated request.
The dashboards clear any existing dashboard cookie on load so visiting either dashboard always requires an explicit sign-in.

Teacher-scoped repository queries join or filter by `classes.teacher_id`.
Student-scoped session queries filter by `sessions.student_id` at the SQL boundary.
The migration also enables row-level security policies for sessions and student profiles.

The previous `x-socrates-user` shortcut is accepted only when `NODE_ENV=test`.
Browser flows must use the cookie.

## API surface

All routes are defined in `apps/api/src/server.js`.

| Method and route | Role | Behavior |
| --- | --- | --- |
| `GET /health` | Public | Returns service reachability and durable persistence mode. |
| `POST /auth/login` | Public | Verifies the local email and password, then sets the auth cookie. |
| `POST /auth/magic-link` | Public | Legacy route that returns `410 Gone`. |
| `POST /auth/verify` | Public | Legacy route that returns `410 Gone`. |
| `GET /auth/me` | Authenticated | Returns the current user. |
| `POST /auth/logout` | Authenticated | Deletes the auth session and clears the cookie. |
| `GET /classes` | Teacher | Lists the teacher's class summaries. |
| `GET /classes/:id` | Teacher | Returns one teacher-owned class summary. |
| `GET /classes/:id/students` | Teacher | Returns a scoped class roster and current summaries. |
| `GET /activity` | Teacher | Returns recent activity across the teacher's classes. |
| `GET /ontology/physics` | Authenticated | Returns the published Physics ontology revision and concept catalog. |
| `GET /ontology/physics/concepts/:id` | Authenticated | Returns a concept with typed inbound and outbound relationships. |
| `GET /ontology/physics/learning-path?studentId=...` | Student owner or scoped teacher | Returns the ready frontier, recommendation, blocked concepts, remediation actions, and cross-track teaching plan. |
| `POST /assignments` | Teacher | Creates an assignment, all student sessions, and generated-item audits transactionally. |
| `GET /assignments` | Teacher | Lists assignments scoped to the teacher and optionally one class. |
| `GET /students/me/dashboard` | Student | Returns the authenticated student, their assignment sessions, and aggregate summary. |
| `GET /sessions/:id` | Student or teacher | Returns a session only when owned by the student or in the teacher's class. |
| `GET /sessions/:id/evidence` | Teacher | Returns evidence, decision, flags, and generated-item audit data. |
| `POST /sessions/:id/evidence` | Student owner | Atomically records evidence and its idempotent response. |
| `POST /sessions/:id/submit` | Student owner | Adds a follow-up or atomically completes the session and updates the profile. |
| `GET /students/:id/profile` | Student owner or scoped teacher | Returns a full competency profile. |
| `GET /session-status` | WebSocket | Receives session-status fan-out events. |

## Core workflows

### Teacher assignment

1. The teacher dashboard posts a class ID, the Mechanics domain, and selected student IDs to `POST /assignments`.
2. The API verifies the teacher owns the class and the selected students are class members.
3. The API loads the active published Physics ontology and each student's revision-scoped durable beliefs.
4. The API selects the most uncertain ready Mechanics competency at the student's prerequisite-aware frontier.
5. The API generates an item before opening the transaction.
6. The repository transaction validates the ontology target, creates missing neutral target beliefs, and creates the assignment, every student session, and every `generated_items` audit record together.
7. Each session and generated-item record stores the ontology revision used for its target.
8. Redis publishes a session-status event that is fanned out to WebSocket clients.

Generated item metadata contains the prompt version, model information, source, attempt count, verifier-shaped result, and structured item.

### Student dashboard and Canvas handoff

1. The student visits `/student`, which clears an existing dashboard session and displays explicit sign-in.
2. The student enters their student email and password `1234`.
3. The student dashboard fetches `GET /students/me/dashboard` after successful role-checked login.
4. The dashboard never sends a student ID to choose whose assignments are loaded.
5. The API derives the student from the auth cookie and returns only that student's sessions.
6. Clicking Start or Continue sends the browser to `${NEXT_PUBLIC_SOCRATES_CANVAS}/?session=<sessionId>`.
7. Canvas assessment mode fetches the session with `credentials: "include"`.
8. Canvas therefore uses the authenticated cookie rather than a hardcoded demo-student header.

The Canvas and API defaults use `localhost` and are same-site despite different ports.
The API CORS allowlist includes the Canvas origin on ports `3000` and `3888`.

### Evidence submission and idempotency

1. Canvas records raw interaction events in browser local storage only.
2. Canvas derives a feature summary, aggregate diagram-before-equation markers, an atlas PNG, and a typed explanation when required by the target node.
3. The client posts the atlas, sanitized feature summary, explanation, submission flag, and a UUID idempotency key.
4. Redis acquires a short-lived `SET NX` lock to avoid simultaneous duplicate processing.
5. Postgres transactionally checks `idempotency_keys`, writes the sanitized trace snapshot, and writes the response record.
6. Repeating the same key returns the original durable response.

The current Canvas sends a page-hide evidence snapshot as well as explicit submit evidence.

### Session completion

1. The API loads the latest durable trace snapshot for the student-owned session.
2. Decision-grade sessions evaluate only the criterion IDs declared by the target node's YAML contract.
3. The evaluator uses the atlas image, typed explanation, and sanitized process summaries, then persists structured criterion results and model metadata.
4. Completion locks the session and revision-scoped belief row inside one Postgres transaction.
5. The transaction writes the evaluation audit, posterior update, instructional decision, and uncertainty flags.
6. A temporally unstable update produces a transfer follow-up instead of changing the belief.
7. Redis publishes a session-status event for dashboard clients.

## Assessment logic

The reviewed ontology source is `apps/api/ontology/physics-mechanics-2026-2.yaml`.
It defines 20 intermediate-abstraction Mechanics competencies rather than broad topic labels.
Each node has typed evidence criteria, a target probe, transfer follow-ups, an anti-gaming check, and high-confidence, low-confidence, and uncertainty decisions.

The active graph selects a competency whose prerequisites are sufficiently supported and whose current belief is closest to the assessment boundary.

`apps/api/src/bayes.js` holds the legacy update and criterion-weighted beta-posterior logic.
Decision-grade flags include `temporal_unstable`, `human_review_required`, `track_divergence`, and `evaluator_low_confidence`.

`apps/api/src/executor.js` can call the local Codex CLI to generate an item with a strict JSON shape.
It retries generation up to three times and then uses the curated fallback item.

The decision-grade evaluator is a constrained vision-and-rubric adapter.
It can only return evidence for criteria declared by the target node.
If the model is unavailable, the API persists a low-confidence result and flags it rather than inventing semantic certainty.

The SymPy verifier exists as a standalone service in `apps/verifier/app.py`.
The API health check observes it, but the current item-generation and completion workflows do not call it yet.
Treat Codex critic orchestration, remote verifier enforcement, and learned semantic inference as planned work rather than shipped behavior.

## Redis behavior

Redis is non-authoritative.
Clearing Redis must not lose assignments, evidence, profiles, sessions, or authentication.

Current Redis responsibilities are listed below.

| Concern | Key or channel |
| --- | --- |
| Evidence concurrency lock | `socrates:evidence:<sessionId>:<idempotencyKey>` with 15-second expiry. |
| WebSocket status fan-out | `socrates:session-status` pub/sub channel. |

The repository's durable idempotency table is the correctness backstop if a Redis lock expires or Redis is cleared.

## Frontend behavior

The teacher dashboard is a single client page at `apps/dashboard/app/page.js`.
It supports local teacher sign-in, class selection, assignment creation, student profile review, activity, and evidence review.

The student dashboard is `apps/dashboard/app/student/page.js`.
It intentionally uses the same global design tokens, rail, panels, status pills, and responsive layouts as the teacher dashboard.

Each dashboard clears the prior dashboard session when it loads and requires an explicit role-specific sign-in.
Signing in with an account of the wrong role clears the new session and displays a route-specific instruction.
The API separately enforces these role boundaries even if a user bypasses a frontend route.

Student dashboard data comes from one student-scoped API request.
It displays total assignments, ready sessions, completions, aggregate belief, and one card per assignment session.
Completed sessions do not offer a Canvas start button.
Assigned, in-progress, and follow-up sessions expose Start or Continue.

Canvas assessment mode is in `apps/canvas/public/assessment.js`.
It activates only when a `session` query parameter is present.
It shows a problem banner, disables generic Canvas AI actions, collects local interaction events, and posts evidence to the API.

## Testing and verification

Run the regular API suite with the command below.

```sh
npm --workspace @socrates/api test
```

The regular suite uses an explicitly injected in-memory repository only for isolated route tests.

Run durable local integration coverage with the command below.

```sh
SOCRATES_INTEGRATION_TESTS=true npm --workspace @socrates/api test
```

The integration test requires local Postgres and Redis.
It verifies assignment persistence across repository recreation, generated durable records, idempotent evidence, raw-stroke exclusion, profile completion, auth-session persistence, revocation, and teacher class scoping.

Build the dashboard with the command below.

```sh
npm --workspace @socrates/dashboard run build
```

Run the Canvas suite with the command below.

```sh
npm --workspace @socrates/canvas test
```

Canvas tests open local listeners.
They may need an execution environment that permits localhost listeners.

The root test script runs the API and Canvas suites.

```sh
npm test
```

## Recent implementation status

The durable Postgres repository migration is implemented and the incremental `0001_durable_repository` migration has been applied to the local database used during development.

The student dashboard, student-scoped endpoint, cookie-based Canvas handoff, and student dashboard route coverage are implemented.

The current local API server on a developer machine may be an older process after code changes.
Restart it after migration or API changes.

The dashboard development process must also be restarted after a production build changes `.next` while development mode is already running.

## High-value next work

1. Replace the shared local password with production-grade password reset and identity-provider authentication.
2. Invoke the SymPy verifier in the generated-item transaction and persist its actual result.
3. Replace `defaultInference` with rubric-aware semantic and process inference.
4. Add a real bounded Redis work queue for generation jobs if generation is moved off the assignment request path.
5. Add browser end-to-end coverage for teacher assignment, student dashboard, Canvas start, evidence submit, completion, and teacher evidence refresh.
6. Add a production deployment configuration with secure cookies, TLS, strict CORS origins, and a database role that exercises row-level security directly.
7. Add student-facing follow-up presentation in Canvas beyond the current banner text.

## Constraints for future agents

Do not add runtime in-memory authority for durable data.
Do not write raw strokes to the API log or database.
Do not manually edit generated files or `CHANGELOG.md`.
Use `apply_patch` for local source edits.
Preserve existing user changes in this currently dirty worktree.
Use `rg` before slower text-search tools.
Keep long Markdown sentences on individual physical lines.
