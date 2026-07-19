# Socrates local pilot

Socrates is a local supervised mechanics diagnostic pilot.
The student uses the canvas workbench, while the teacher uses the dashboard to assign diagnostics and review competency evidence.

Read [AGENT_HANDOFF.md](AGENT_HANDOFF.md) for the current implementation architecture, API contract, data model, workflows, test commands, and known limitations.

## Local services

Start local Postgres, Redis, the SymPy verifier, and an authenticated Codex CLI before a full pilot run.
Copy `.env.example` to `.env` and then run the API and dashboard in separate terminals.
Apply the database schema before starting the API with configured Postgres and Redis.

```bash
npm install
npm --workspace @socrates/api run db:migrate
npm run start:api
npm --workspace @socrates/canvas start
npm --workspace @socrates/dashboard run dev
```

Assign a diagnostic from `http://localhost:3000`.
Students can view and start their own assignments from `http://localhost:3000/student`.
Starting an assignment opens Canvas with `?session=<id>` to enter Assessment Mode.
The browser keeps raw event logs in local storage and sends only an atlas plus the four derived feature groups.

The API intentionally keeps raw stroke logs in the browser.
It accepts only a rendered atlas and derived trace features.
