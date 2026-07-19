Here is the architecture document for Socrates.

---

# TECHNICAL_ARCHITECTURE.md — SOCRATES

_"Who actually knows this?" — not who copied it._

This document shows how the Socrates assessment engine connects to the Socrates canvas (rebranded as the Socrates student workbench), how data flows from a student's stroke on an infinite canvas into a probabilistic competency profile, and how a teacher sees what that student actually understands.

---

## 0. Architecture at a glance (submission diagram)

Render to PNG/SVG at **[mermaid.live](https://mermaid.live)** (paste → Export at 2–3× scale).  
Six boxes, two loops: solid arrows = **ingest** (1–4), dashed arrows = **assess** (A–D).

```mermaid
%%{init: {'theme':'base','themeVariables':{'fontSize':'22px','fontFamily':'Inter, Helvetica, sans-serif','lineColor':'#555'}, 'flowchart':{'nodeSpacing':55,'rankSpacing':90,'curve':'basis','htmlLabels':true}}}%%
flowchart LR
  CANVAS["<b>Socrates Canvas</b><br/>(Browser — Socrates core)<br/><br/>• Sparse 512×512 tiles<br/>• Handwriting · diagrams · equations<br/>• Assessment mode (locked ink zones)<br/>• Continuous trace stream<br/><i>stroke · pause · lasso · zoom · confirm</i>"]

  TRACE["<b>Trace Aggregator</b><br/>(Browser edge)<br/><br/>• edit_entropy · erase_ratio<br/>• pause_pattern · spatial_progression<br/>• Periodic atlas snapshots<br/><i>features only — raw strokes stay local</i>"]

  API["<b>Assessment API</b><br/>Node.js / Fastify<br/><br/>• Session orchestration<br/>• Trace ingestion<br/>• Competency graph hydration<br/>• Uncertainty calibration"]

  BRAIN["<b>Codex Brain</b><br/>OpenAI Codex / Claude Code<br/><br/>• Generator: novel problems + follow-ups<br/>• Critic: validity + solvability check<br/>• Inference: canvas atlas + trace analysis<br/>• Answer evaluation: semantic + behavioral"]

  SYM["<b>Symbolic Verifier</b><br/>SymPy · Wolfram<br/><br/>• Dimensional analysis<br/>• Alternative-path detection<br/>• Physical plausibility guard<br/>• Visual validity check"]

  STORE["<b>Profile Store</b><br/>Postgres (Drizzle)<br/><br/>competency_graphs · student_profiles<br/>session_states · trace_snapshots<br/>processed_items · uncertainty_flags"]

  DASH["<b>Teacher Dashboard</b><br/>Next.js<br/><br/>Class competency heatmap<br/>Uncertainty flag list<br/>Stroke-level session replay<br/>Diagnostic assignment builder"]

  CANVAS == "1 · stroke events" ==> TRACE
  TRACE  == "2 · feature vectors + atlas" ==> API
  API    == "3 · generate / critique / infer" ==> BRAIN
  API    == "3b · symbolic validation" ==> SYM
  BRAIN  == "4 · profile update" ==> STORE
  SYM    == "4b · reject or confirm item" ==> BRAIN

  DASH   == "E · load class profiles" ==> STORE
  DASH   == "F · assign diagnostic" ==> API

  API    -. "A · deliver problem" .-> CANVAS
  API    -. "B · deliver follow-up draft" .-> CANVAS
  CANVAS -. "C · submit work / accept draft" .-> API
  API    -. "D · update profile + uncertainty" .-> STORE

  classDef cCanvas fill:#4A154B,color:#fff,stroke:#000,stroke-width:2px;
  classDef cTrace fill:#36C5F0,color:#04222e,stroke:#04222e,stroke-width:2px;
  classDef cApi fill:#ECB22E,color:#3a2a00,stroke:#3a2a00,stroke-width:3px;
  classDef cBrain fill:#2EB67D,color:#00291b,stroke:#00291b,stroke-width:2px;
  classDef cSym fill:#f3f3f3,color:#111,stroke:#888,stroke-width:2px;
  classDef cStore fill:#111,color:#fff,stroke:#000,stroke-width:2px;
  classDef cDash fill:#666,color:#fff,stroke:#000,stroke-width:2px;

  class CANVAS cCanvas
  class TRACE cTrace
  class API cApi
  class BRAIN cBrain
  class SYM cSym
  class STORE cStore
  class DASH cDash
```

> **Reads in one breath:** The student draws on an infinite canvas; the browser aggregates behavioral features and sends them with periodic snapshots to the Assessment API, which orchestrates a Codex Brain that generates novel problems, validates them through a symbolic verifier, and infers competency states from the student's work. The Profile Store holds the evolving Bayesian graph for every student. The Teacher Dashboard assigns diagnostics and reads the profile state back out as a heatmap of understanding, not a grade.

### The two core behaviors (sequence view)

**Diagnostic Session — a novel problem becomes a Socratic interview**
```mermaid
sequenceDiagram
  autonumber
  participant T as Teacher Dashboard
  participant A as Assessment API
  participant S as Symbolic Verifier
  participant C as Codex Brain
  participant D as Profile Store
  participant B as Socrates Canvas

  T->>A: POST /session/assign {studentId, domain: mechanics}
  A->>D: hydrate student_profile + competency_graph
  A->>C: Generator: create novel problem targeting boundary competency
  C-->>A: {problem_text, intended_solution, target_competency, rubric}
  A->>S: validate: dimensionally consistent? physically plausible? non-gamable?
  S-->>A: {valid: true, alternative_path_risk: low}
  A->>D: save session_state, mark item as pending
  A->>B: deliver problem as locked ink (non-editable) + work zone bounds

  Note over B: Student draws FBD, writes equations, sketches graph

  B->>A: continuous trace aggregates + atlas snapshot (on submit or pause)
  A->>C: Inference: analyze canvas + traces + target_competency
  C-->>A: {semantic_assessment, process_validity, confidence, follow_up_needed}

  alt confidence < threshold or process anomaly detected
    A->>C: Generator: create Socratic follow-up (template-hybrid, domain-specific)
    C-->>A: {follow_up_prompt, expected_evidence, evaluation_rubric}
    A->>S: validate follow-up: solvable? targets same competency? not leading?
    S-->>A: {valid: true}
    A->>B: deliver follow-up as AI draft (movable, accept/discard)
    B->>A: student response (accepted draft + canvas delta)
    A->>C: evaluate response against rubric
    C-->>A: {semantic_score, evidence_coverage}
  end

  A->>A: Bayesian update: combine semantic_score + process_validity
  A->>D: persist profile_update {competency, posterior, uncertainty_flags}
  A->>T: webhook / poll: session complete, flags available
```

**Profile Evolution — from first session to longitudinal model**
```mermaid
sequenceDiagram
  autonumber
  participant B as Socrates Canvas
  participant T as Trace Aggregator
  participant A as Assessment API
  participant D as Profile Store
  participant C as Codex Brain

  B->>T: stroke_start / stroke_move / stroke_end / lasso / zoom
  T->>T: compute running aggregates (edit_entropy, pause_pattern, spatial_prog)
  T->>A: flush feature vector {sessionId, tile_id, aggregates, timestamp}
  A->>D: append to trace_snapshots (immutable log)

  loop Every diagnostic session
    A->>C: Inference: canvas atlas + trace narrative + follow-up responses
    C-->>A: {competency_deltas: [{node, likelihood, evidence_type}]}
    A->>A: temporal stability check: delta consistent with prior?
    A->>D: update student_profile (Bayesian merge, uncertainty propagation)
    D-->>A: current posterior + flags
  end

  Note over A: Uncertainty flags: semantic_low, process_anomaly, temporal_unstable, cross_task_untested
```

**Teacher assigns diagnostic — from dashboard to live canvas**
```mermaid
sequenceDiagram
  autonumber
  participant U as Teacher (browser)
  participant D as Next.js Dashboard
  participant A as Assessment API
  participant D2 as Profile Store
  participant B as Socrates Canvas

  U->>D: Select class → pick domain (mechanics) → pick students
  D->>A: POST /assignment/bulk {studentIds, domain, competency_targets}
  A->>D2: verify profiles exist, clone default graph if new student
  A->>D: 202 Accepted {assignmentId, status: pending}

  par per student
    A->>A: run Generator → Symbolic Verifier loop (max 3 attempts)
    A->>D2: save personalized problem + session_state
    A->>B: push assignment to student canvas (WebSocket / SSE)
    B->>U: student sees locked problem ink, begins work
  end

  U->>D: poll GET /assignment/{id}/progress
  D->>A: fetch completion + flag summary
  A->>D2: query session_states per student
  D2-->>A: {completed: 12, in_progress: 5, flagged: 3}
  A-->>D: progress response
  D-->>U: render progress bars + uncertainty alerts
```

### The ranking that makes it work (the differentiator)

```
posterior(competency) = α · prior(competency) + β · semantic_evidence + γ · process_evidence

  semantic_evidence  = evaluation of follow-up response against rubric (0–1)
  process_evidence   = f(edit_entropy, erase_ratio, pause_pattern, spatial_progression)
                       normalized against population baseline for this competency
  α, β, γ            = calibrated per domain; β + γ > α ensures the assessment
                       dominates the prior, but temporal stability prevents oscillation

  uncertainty_flag   = max(semantic_confidence, process_validity, temporal_stability) < τ
                       → human review required before acting on inference

⇒ The system does not score right/wrong. It updates a belief distribution over
  a fine-grained competency graph, and it knows when it does not know.
```

### ASCII fallback (if a renderer isn't available)

```
┌─────────────────────────────────────────────────────────────────────┐
│  STUDENT: Socrates Canvas (Browser)                                │
│  Infinite sparse tiles · handwriting · diagrams · equations       │
│  Assessment mode: locked problem ink · work zones · AI drafts     │
│  Continuous trace: stroke · pause · lasso · zoom · confirm        │
└──────────────────┬──────────────────────────────────▲─────────────┘
                   │ feature vectors + atlas           │ problem / follow-up
                   ▼ (periodic flush)                │ (delivered as draft)
┌─────────────────────────────────────────────────────────────────────┐
│  TRACE AGGREGATOR (Browser edge)                                     │
│  edit_entropy · erase_ratio · pause_pattern · spatial_progression   │
│  Raw strokes stay local for replay; only aggregates leave client    │
└──────────────────┬──────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  ASSESSMENT API (Node.js / Fastify) — Session Orchestrator          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐   │
│  │ Generator   │  │ Critic      │  │ Inference Engine        │   │
│  │ (Codex)     │──►│ (Codex +    │  │ (Codex: canvas + traces │   │
│  │ novel items │  │  Symbolic)   │  │  + follow-up eval)      │   │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘   │
│         │                ▲                      │                   │
│         │    validate    │              analyze │                   │
│         ▼                │                    ▼                    │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │ SYMBOLIC VERIFIER (SymPy / Wolfram)                     │     │
│  │ • Dimensional analysis · Alternative-path detection      │     │
│  │ • Physical plausibility · Visual validity              │     │
│  └─────────────────────────────────────────────────────────┘     │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │ PROFILE STORE (Postgres + Drizzle) — per student        │     │
│  │ competency_graphs · student_profiles · session_states     │     │
│  │ trace_snapshots · processed_items · uncertainty_flags   │     │
│  └─────────────────────────────────────────────────────────┘     │
│         ▲                                                        │
│         │ read / write                                           │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │ TEACHER DASHBOARD (Next.js)                              │     │
│  │ OAuth · class heatmap · uncertainty flags · replay        │     │
│  └─────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. System Architecture

This is the full picture: how a student's stroke on a canvas becomes a calibrated belief about what they understand.

```mermaid
flowchart TB
    subgraph Student["Socrates Canvas (Browser)"]
        SC[Infinite sparse tile canvas]
        AM[Assessment Mode UI]
        TR[Continuous trace capture]
        AG[Trace Aggregator<br/>edit_entropy · pause_pattern · spatial_progression]
    end

    subgraph Ingest["Assessment API (Node.js / Fastify)"]
        ORCH[Session Orchestrator]
        ING[Trace Ingestion Handler]
        GEN[Generator<br/>Codex: novel problem / follow-up]
        CRT[Critic<br/>Codex + Symbolic Verifier]
        INF[Inference Engine<br/>Codex: canvas atlas + trace narrative]
        UPD[Bayesian Profile Updater]
    end

    subgraph Verify["Symbolic Verifier (SymPy / Wolfram)"]
        DA[Dimensional Analysis]
        AP[Alternative Path Detection]
        PP[Physical Plausibility]
        VV[Visual Validity]
    end

    subgraph Store["Profile Store (Postgres + Drizzle)"]
        CG[(competency_graphs<br/>domain-scoped YAML)]
        SP[(student_profiles<br/>per-student posterior)]
        SS[(session_states<br/>active diagnostic sessions)]
        TS[(trace_snapshots<br/>immutable feature logs)]
        PF[(processed_items<br/>idempotency)]
        UF[(uncertainty_flags<br/>human_review queue)]
    end

    subgraph Dash["Teacher Dashboard (Next.js)"]
        OA[OAuth + Class Management]
        AS[Assignment Builder]
        HV[Heatmap Visualization]
        FL[Flag List + Alerting]
        RP[Session Replay<br/>stroke-level reconstruction]
    end

    SC --> AM
    AM --> TR
    TR --> AG
    AG --> ING
    ING --> TS

    ORCH --> GEN
    GEN --> CRT
    CRT --> DA
    CRT --> AP
    CRT --> PP
    CRT --> VV
    DA --> CRT
    AP --> CRT
    PP --> CRT
    VV --> CRT
    CRT -->|valid item| ORCH

    ORCH -->|deliver problem| SC
    ORCH -->|deliver follow-up| SC

    SC -->|submit work / accept draft| INF
    INF --> UPD
    UPD --> SP
    UPD --> UF
    UPD --> SS

    OA --> AS
    AS --> ORCH
    SP --> HV
    SP --> FL
    UF --> FL
    TS --> RP
    HV --> RP
    FL --> RP
```

**Key design point to keep visible in your head:** The `student_profile` is the only place "understanding" actually lives — a probability distribution over the competency graph, scoped per student, with explicit uncertainty flags. Everything else is plumbing to get evidence into that distribution and to surface it back out as a teacher-actionable heatmap. If you're ever unsure what to build next, ask: "does this get me closer to a valid, stable, decision-relevant posterior, or to surfacing uncertainty honestly?"

> **Implementation notes (current build).** The Socrates canvas runs as a **sparse tile renderer** in the browser — only 512×512 tiles where ink exists are allocated, so the 20,000×20,000 logical canvas never becomes a memory burden. In **Assessment Mode**, the canvas locks problem ink as non-editable confirmed tiles, while student work zones remain freeform. The AI does not auto-respond to pauses; it only delivers follow-ups as **draft tiles** (movable, resizable, accept/discard) when the Inference Engine triggers a probe. The Trace Aggregator runs entirely in the browser: it computes `edit_entropy`, `erase_ratio`, `pause_pattern`, and `spatial_progression` from raw stroke events, then flushes **feature vectors** (not raw biometrics) to the Assessment API. Raw stroke logs stay in IndexedDB for session replay and are never transmitted. The Assessment API maintains **session state** in memory (Redis-backed for horizontal scaling) and persists only profile updates and trace snapshots to Postgres. The Generator and Inference Engine call Codex over **Streamable HTTP** with distinct system prompts and temperature settings (Generator: creative, t=0.7; Critic: conservative, t=0.2; Inference: analytical, t=0.3). The **Symbolic Verifier** is a separate Python service (FastAPI) wrapping SymPy; it receives the intended solution and checks dimensional consistency, alternative solution paths, and physical plausibility. The Critic rejects up to 3 generations before escalating to a fallback pre-authored item pool. The Bayesian Updater uses a simple **conjugate beta-binomial model per competency node** for interpretability and auditability; uncertainty flags fire when the posterior variance exceeds a domain-tuned threshold. The Teacher Dashboard reads the same Postgres store over a **REST + WebSocket** layer, with row-level security ensuring teachers see only their class profiles. Session Replay reconstructs the canvas from local IndexedDB stroke logs (pulled via secure short-lived token) combined with server-side feature annotations, so teachers see *where* the student paused and *what* they erased, not just a video recording.

---

## 2. Step-by-Step Technical Roadmap

This is the literal build order — each step assumes the previous one is done and runnable.

```mermaid
graph TD
    A[1. Scaffold Socrates Canvas core<br/>sparse tiles · stroke capture · basic drawing] --> B[2. Add Assessment Mode<br/>locked ink zones · work boundaries · draft/confirm separation]
    B --> C[3. Build Trace Aggregator<br/>edit_entropy · pause_pattern · spatial_progression]
    C --> D[4. Scaffold Assessment API<br/>Fastify · session routes · trace ingestion]
    D --> E[5. Define Competency Graph schema<br/>K-12 Mechanics · 20 nodes · prerequisites · evidence criteria]
    E --> F[6. Build Profile Store<br/>Postgres · Drizzle · student_profiles · uncertainty_flags]
    F --> G[7. Write Generator prompt + Critic prompt<br/>test manually on 10 sample physics problems]
    G --> H[8. Wire Symbolic Verifier<br/>SymPy service · dimensional analysis · alt-path check]
    H --> I[9. Connect Generator → Critic → Canvas<br/>end-to-end: teacher assigns → student sees problem]
    I --> J[10. Add Inference Engine<br/>canvas atlas + trace analysis → competency evaluation]
    J --> K[11. Build Bayesian Updater<br/>posterior merge · temporal stability · uncertainty flags]
    K --> L[12. Wire Socratic Follow-up loop<br/>submit → infer → generate probe → deliver draft → evaluate]
    L --> M[13. Validate Phase 3 checkpoint<br/>diagnostic session completes · profile updates · flags surface]
    M --> N[14. Build Teacher Dashboard<br/>Next.js · OAuth · class picker · assignment builder]
    N --> O[15. Add Heatmap + Flag List views]
    O --> P[16. Add Session Replay<br/>stroke reconstruction from IndexedDB + feature overlay]
    P --> Q[17. Stress test: 30-student class · concurrent sessions · backfill replay]
    Q --> R[18. Demo video + architecture diagram + text description]
    R --> S[19. Submit]

    style A fill:#4A154B,color:#fff
    style M fill:#2EB67D,color:#000
    style S fill:#ECB22E,color:#000
```

**Read this as a checklist, not a suggestion** — steps 1–6 are pure infrastructure with no payoff until step 9, where a student first sees a generated physics problem on their canvas. Step 13 is the actual "does this project work" milestone. Everything after that is demoability and packaging.

---

## 3. Dependency Flowchart (what blocks what)

This shows which steps can happen in parallel and which strictly require something else first.

```mermaid
flowchart LR
    subgraph Track1["Can build in parallel early"]
        direction TB
        A1[Socrates Canvas core]
        A2[Assessment API scaffold]
        A3[Postgres + Drizzle schema]
    end

    subgraph Track2["Requires Assessment Mode + schema"]
        direction TB
        B1[Trace Aggregator]
        B2[Competency Graph definition]
    end

    subgraph Track3["Requires trace + graph + API"]
        direction TB
        C1[Generator + Critic prompts]
        C2[Symbolic Verifier service]
    end

    subgraph Track4["Requires valid item generation"]
        direction TB
        D1[End-to-end problem delivery]
        D2[Inference Engine]
    end

    subgraph Track5["Requires inference working"]
        direction TB
        E1[Bayesian Updater + Follow-up loop]
        E2[Teacher Dashboard scaffold]
    end

    subgraph Track6["Requires end-to-end loop"]
        direction TB
        F1[Heatmap + Flags + Replay]
        F2[Demo + Submit]
    end

    A1 --> B1
    A1 --> B2
    A2 --> B1
    A3 --> B2
    B1 --> C1
    B2 --> C1
    B2 --> C2
    C1 --> D1
    C2 --> D1
    C1 --> D2
    D1 --> E1
    D2 --> E1
    D2 --> E2
    E1 --> F1
    E2 --> F1
    F1 --> F2

    style Track4 fill:#2EB67D,color:#000
    style Track6 fill:#ECB22E,color:#000
```

---

**Key note:** The Socrates canvas preserves all Socrates properties — no npm runtime dependencies, sparse tile allocation, local snapshot storage, and AGPL licensing. The assessment engine adds only the trace aggregator (vanilla JS), the Assessment API (Node.js), and the Symbolic Verifier (Python/FastAPI). The Codex Brain is a prompt-orchestration layer, not a hosted model.
