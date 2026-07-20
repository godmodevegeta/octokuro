# Socrates Canvas feature reference

This document is the implementation-accurate inventory of Canvas capabilities as of 2026-07-20.
It describes only behavior present in the repository.
It does not describe proposed semantic-ink, physics-solver, counterfactual, or collaborative features.

## Product modes

Canvas has two mutually exclusive modes.

- The normal workspace is a general AI-assisted whiteboard for handwriting, equations, diagrams, and spatial questions.
- Assessment mode opens when Canvas receives a `session` query parameter from the student dashboard.
- Assessment mode presents an assigned diagnostic, gathers evidence, and intentionally hides Auto AI and every Answer, Hint, Continue, Explain, and Plot control.
- Assessment mode otherwise retains the student drawing surface so the student can make a freehand representation and solution.

## Canvas workspace

- The logical workspace is 20,000 by 20,000 coordinates.
- Canvas allocates 512 by 512 bitmap tiles only where confirmed content exists.
- Rendering composites only visible tiles, so the full logical workspace is never allocated as one giant browser bitmap.
- Confirmed content consists of student ink and AI output that the user has explicitly accepted.
- Unconfirmed AI drafts remain separate from confirmed content until acceptance.
- The coordinate readout shows the current logical pointer position and zoom percentage.
- The optional grid can be shown or hidden.
- The Arcane and Sci-fi themes show the grid by default, while Research uses an independently remembered grid preference that defaults to hidden.
- The workspace supports Arcane, Sci-fi, and Research visual themes.
- Each theme also supplies different model persona guidance for normal AI requests.
- English is the default interface language and the interface includes Chinese localization.
- Theme, language, grid visibility, Auto AI preference, and Auto AI delay are retained in browser local storage.
- Fullscreen mode uses the browser Fullscreen API when supported.

## Input, navigation, and editing

- Pen mode accepts stylus and mouse input.
- Stylus pressure changes pen width within the configured pen-width bounds.
- The pen-size control ranges from 2 to 16 CSS pixels and defaults to 4 pixels.
- Eraser mode removes confirmed pixels and uses a larger fixed eraser width.
- Touch input pans the workspace rather than drawing.
- Two-touch input supports pinch zooming and panning.
- The pointer wheel zooms around the pointer position.
- Middle-button dragging and Alt-dragging pan the workspace.
- Zoom is bounded between 3 percent and 200 percent.
- The context menu is suppressed inside the drawing surface to keep pointer gestures predictable.
- Ink color can be selected from blue, black, red, orange, gold, green, cyan, and purple.
- AI output color can be selected independently from the same palette.
- AI text can use rounded, handwritten, classic-serif, or sans-serif fonts.
- Clear removes confirmed tiles only after an explicit confirmation prompt.
- Undo and redo operate on confirmed-tile changes and retain up to 30 history entries.
- A new pen stroke, erasure, selection commit, accepted AI item, and clear operation can create undoable canvas history.

## Lasso selection

- Lasso mode uses a freehand closed path to select confirmed ink.
- Selection clips pixels to the lasso path instead of selecting the full bounding rectangle.
- Ink outside the lasso remains untouched even when it shares a tile with selected ink.
- A selected region can be moved within logical canvas bounds.
- A selected region can be proportionally resized within logical canvas bounds.
- A selected region can be recolored with the current ink color.
- Selection controls let the user accept the local edit or cancel it and restore the source pixels.
- Escape cancels an active selection.
- Enter accepts an active selection when focus is not in a form control.
- Lasso capture, move, resize, recolor, acceptance, cancellation, undo, and redo are local operations that never invoke AI.
- A selection or canvas edit invalidates stale AI recognition so an answer cannot be applied to obsolete work.

## AI assistance

- Auto AI is enabled by default in the normal workspace.
- Auto AI waits after a completed pen stroke before requesting recognition.
- The delay is configurable from 0 to 10 seconds in 0.1-second increments and persists locally.
- Turning Auto AI off switches the normal workspace to manual AI actions.
- The AI orb opens a radial menu through click, hover, or a drag gesture.
- The radial menu exposes Answer, Hint, Continue, Explain, and Plot actions.
- A manual action captures the current relevant canvas state rather than requiring a text chat box.
- The client builds a cropped white-background atlas from visible, confirmed ink and the most recent input region.
- Atlas capture includes global geometry, the latest-input rectangle, an 8 by 8 hotspot trail, and capture metadata for spatially grounded model placement.
- The atlas is capped at 2048 by 1536 pixels before it is sent to the server.
- The request includes the selected theme persona and the full 20,000 by 20,000 logical coordinate system.
- A new user edit cancels or defers stale automatic requests and restores their unconsumed input for later recognition.
- Manual and automatic requests use the same validated command protocol.
- The server can execute requests through an OpenAI-compatible or Anthropic-compatible API provider.
- The server can instead execute through a locally installed Codex CLI using an isolated child-process environment.
- API credentials and Codex authentication data never enter browser JavaScript.

## AI output and drafts

- The model can return text, LaTeX formulas, function plots, mixed vector drawings, and erase operations.
- Text output supports explicit location, wrapping width, font size, line height, and the selected AI color.
- Formula output is rendered through the pinned MathJax SVG runtime with a text fallback when rendering fails.
- Function plots support browser-evaluable single-variable expressions and render axes, ticks, and the evaluated curve.
- The server supplies a visual fallback for a Plot action when a valid model response lacks a visual command.
- Mixed drawing output supports lines, smooth paths, rectangles, ellipses, circles, arcs, closed paths, translucent fills, and arrowheads.
- A coherent mixed drawing is one draft item even when it contains multiple primitives.
- Drawing geometry is validated on both server and client before it is rendered.
- Client validation rejects malformed commands, invalid geometry, out-of-bounds output, and unsafe raster sizes.
- Model output is placed near relevant writing and adjusted away from invalid text layouts where possible.
- A single non-drawing draft can animate into the workspace.
- Multiple commands or drawing commands appear as an unconfirmed draft batch.
- Draft batches have a shared move handle that preserves relative item positions.
- Individual draft items can be moved, independently resized, accepted, or discarded.
- The whole draft batch can be accepted or discarded from the top bar.
- Accepting one item preserves that confirmed item while the remaining draft items stay editable.
- Continued handwriting can fade and discard a stale draft instead of merging it into the student's work.
- Draft acceptance writes to the sparse confirmed tiles and records an undoable change.
- Draft rejection leaves confirmed content unchanged.

## Local snapshots and history

- Local canvas history is stored in the browser IndexedDB database named `socrates-canvas-history`.
- Each snapshot contains metadata, a preview, the selected theme, the view transform, and a PNG blob for every populated tile.
- Snapshot previews let the history panel render without loading all tile blobs.
- A user can give a snapshot an optional name up to 48 characters.
- The history panel can save, load, and delete local snapshots.
- Loading a snapshot restores its confirmed tiles, theme, zoom, and pan position.
- Loading a snapshot clears active selection, unconfirmed drafts, pending recognition, and undo or redo history.
- The New Canvas dialog can discard current work, save it as a new snapshot, or overwrite the currently loaded snapshot before opening a blank canvas.
- Unconfirmed AI drafts are deliberately excluded from every local snapshot.
- Local snapshots are browser-local and are not part of the Postgres assessment record.

## Assessment mode

- Student dashboard launch links pass a session ID and an approved local dashboard return URL to Canvas.
- Canvas uses same-origin routes under `/api/assessment` instead of exposing the Assessment API origin to browser code.
- The Canvas server forwards the student cookie and the trusted `x-socrates-workspace: student` header to the Assessment API.
- Assessment mode loads the assigned prompt, work-zone metadata, target information, evidence requirements, and available follow-up prompts.
- The assigned prompt appears in a fixed bottom assessment banner.
- The banner exposes a one-time “I started calculations” phase marker.
- The banner submits the diagnostic only after the session successfully loads.
- An explanation panel appears when the target allows or requires written explanation evidence.
- The explanation label identifies whether the written explanation is optional or required.
- Assessment mode records pointer-down events in browser memory and saves a bounded copy of the latest 1,000 events in browser local storage.
- Assessment mode derives edit entropy, erase ratio, pause count, spatial progression, diagram-before-equations, representation-before-equations, diagram-started, and calculations-started features.
- Assessment mode captures the rendered Canvas surface as a PNG atlas when it saves evidence.
- Assessment mode sends an atlas, the written explanation, sanitized features, submitted state, and a fresh idempotency key to the Assessment API.
- Assessment mode sends a non-submitted evidence snapshot during page exit when the diagnostic has loaded.
- Assessment mode submits evidence before it requests diagnostic completion, follow-up, or profile updating.
- A completed assessment tells the student that the teacher can review the evidence.
- A follow-up result replaces the banner message with the next prompt and permits another submission.
- Authentication, authorization, unavailable-session, and service-connectivity failures show an appropriate recovery message.
- The recovery action returns the student to the local student dashboard.
- Auto AI, the AI orb, the radial AI menu, and every manual AI action are hidden and disabled only in assessment mode.
- Assessment mode does not remove normal workspace features outside an assigned diagnostic.

## Privacy and durable evidence boundaries

- Normal-workspace local snapshots persist only in the current browser profile.
- Assessment raw pointer-event arrays remain local browser data and are not accepted as durable API evidence.
- The API stores the PNG atlas and a whitelisted set of aggregate trace features for assessment audit.
- The API discards unexpected trace-feature properties before durable storage.
- Raw stroke coordinates, raw pressure streams, and raw event arrays are not written to Postgres.
- Postgres is the durable source of truth for submitted atlas evidence, explanations, evaluator results, session state, and ontology belief updates.
- Redis is used only for short-lived evidence-submission coordination and live status fan-out.
- Atlas snapshots are durable audit artifacts and are not database index keys.

## Server, security, and diagnostics

- The Canvas server statically serves the browser client and loads configuration only on the server.
- `GET /api/config` and `/api/config.js` expose only safe runtime configuration for Auto AI delay, request timeout, and provider label.
- `POST /api/ai/command` validates atlas data, geometry, request shape, action and trigger pairing, persona, and model commands before model execution.
- API mode supports OpenAI-compatible Chat Completions and Anthropic Messages transports.
- API mode can send WebP, PNG, or JPEG upstream and retries once with PNG after an explicit non-PNG image-format rejection.
- Codex CLI mode runs every request in an isolated temporary directory with a restricted environment and no Socrates API credentials.
- Codex CLI mode uses a process-lifetime HTTP-only same-site cookie, canonical Host and Origin checks, directly connected client checks, bounded concurrency, timeout handling, request cancellation, and guarded replacement requests.
- The assessment proxy accepts only session reads plus evidence and submit posts for valid session IDs.
- The assessment proxy forwards upstream status and cookies without letting the browser choose an arbitrary Assessment API origin.
- Debug endpoints, request traces, atlas artifacts, and model-exchange artifacts are disabled by default.
- When enabled, debug endpoints are restricted to loopback requests and request traces redact credentials.
- The debug panel shows client-side lifecycle events such as atlas capture, request response, validation, tool execution, and deferred or failed requests.

## Current exclusions

- Canvas does not currently recognize semantic ink entities such as force arrows, axes, labels, or equations as a durable reasoning graph.
- Canvas does not currently run deterministic physics constraints over an FBD or equation graph.
- Canvas does not currently provide a counterfactual sandbox, collaborative editing, voice explanation, confidence painting, or reasoning replay.
- Canvas does not currently synchronize normal-workspace snapshots between browsers or users.
- Assessment mode does not provide AI hints or answers during a diagnostic.

## Source map

- `public/index.html` defines the visible controls and accessibility structure.
- `public/app.js` owns sparse tiles, input, navigation, history, snapshots, AI requests, drafts, plots, formulas, and UI state.
- `public/selection.js` owns lasso geometry, bounds, hit testing, movement, and resize rules.
- `public/draw.js` validates and renders mixed drawing commands.
- `public/assessment.js` adds assessment mode and evidence collection.
- `server.js` validates AI requests, runs configured model executors, proxies assessment requests, and provides optional diagnostics.
- `docs/architecture.md` contains lower-level implementation and deployment details.
