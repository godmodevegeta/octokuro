# Socrates Local Pilot Implementation Plan

## Summary

Build Socrates as a supervised local pilot using the local Codex CLI, locally running Postgres, Redis, and SymPy.
Use a separate Next.js teacher dashboard and the Socrates Canvas as the student workbench.
The pilot delivers one complete loop: a teacher assigns Mechanics, a student completes a canvas diagnostic with up to two Socratic probes, Socrates updates a 20-node competency profile, and the teacher reviews evidence, uncertainty, and can reassign.

## Implementation

- Organize the repository into `apps/canvas`, `apps/api`, `apps/dashboard`, and `apps/verifier`.
- Preserve the canvas sparse-tile renderer, local IndexedDB history, freeform ink, and movable drafts.
- Add Assessment Mode that loads a server-assigned session, displays locked problem content, limits editing to the work zone, disables generic canvas AI actions, and emits evidence on pauses, submissions, and follow-up responses.
- Aggregate `edit_entropy`, `erase_ratio`, `pause_pattern`, and `spatial_progression` in the browser.
- Keep raw event logs local and send only feature snapshots and rendered atlas images to the API.
- Implement the Fastify Assessment API with magic-link authentication, teacher and student roles, class membership, session orchestration, and WebSocket session-status updates.
- Use local Postgres through Drizzle and local Redis for active-session state, idempotency, and bounded work queues.
- Run startup health checks for Postgres, Redis, SymPy, and the Codex CLI.
- Build a local FastAPI SymPy verifier for dimensional consistency, intended solutions, alternate paths, and physical plausibility.
- Reject invalid generated items after three attempts and then use a curated fallback item.
- Use a dedicated Codex assessment executor with separate Generator, Critic, Inference, and Follow-up prompts and strict JSON schemas.
- Persist prompt version, model metadata, verifier result, and structured evidence for every assessment decision.
- Maintain a prerequisite-aware 20-node K-12 mechanics graph.
- Update each student-node belief as an auditable beta-binomial posterior.
- Select the highest-value boundary competency for a domain-only assignment.
- Persist uncertainty flags alongside profile updates instead of blocking updates.
- Bound sessions to one initial item and at most two validated follow-ups.
- Build a teacher dashboard with magic-link access, class selection, Mechanics assignment, live completion status, competency heatmap, flags, evidence snapshots, and diagnostic reassignment.
- Exclude manual profile overrides and central stroke-level replay from v1.

## Mechanics Competency Graph

1. Scalars, vectors, and units.
2. Dimensional analysis.
3. Coordinate systems.
4. Motion graphs.
5. One-dimensional kinematics.
6. Two-dimensional kinematics.
7. Calculus-based motion.
8. Free-body diagrams.
9. Newton's first law.
10. Newton's second law.
11. Newton's third law.
12. Friction and normal force.
13. Tension and connected bodies.
14. Inclined planes.
15. Uniform circular motion.
16. Work and work-energy.
17. Conservative energy.
18. Impulse and momentum.
19. Collisions.
20. Rotational and differential-equation mechanics.

## Interfaces

- `POST /auth/magic-link`
- `POST /auth/verify`
- `POST /assignments`
- `GET /sessions/:id`
- `POST /sessions/:id/evidence`
- `POST /sessions/:id/submit`
- `GET /students/:id/profile`

Persist users, classes, memberships, competency graphs, student profiles, session states, generated items, trace snapshots, idempotency keys, and uncertainty flags.
Apply Postgres row-level security so teacher queries are restricted to their own classes.

## Test Plan

- Unit-test trace feature calculations, prerequisite selection, Bayesian updates, idempotency, permissions, and verifier outcomes.
- Contract-test structured Codex outputs for each assessment role, malformed output, verifier rejection, and fallback behavior.
- Integration-test local Postgres, Redis, SymPy, health checks, and the full API session lifecycle.
- End-to-end test teacher assignment, locked student problem, evidence submission, optional probe, completion, and teacher heatmap update.
- Test privacy boundaries so raw stroke logs never enter API requests or Postgres.
- Test teacher class scoping.
- Run a local 30-student concurrency simulation with bounded Codex work and recoverable failures.

## Assumptions

- Version one runs on one machine with local Postgres, Redis, SymPy/FastAPI, and an authenticated Codex CLI.
- Magic-link delivery uses local development mail transport or configurable SMTP.
- Teachers act on uncertainty through evidence review and reassignment only.
- Managed cloud deployment, multi-provider model abstraction, manual profile editing, and centrally uploaded stroke replay are deferred.
