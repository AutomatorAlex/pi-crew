# AGENTS.md

## Project Overview

pi-crew is a pi coding agent extension for non-blocking subagent orchestration. It spawns isolated SDK-backed subagent sessions while the owner session stays interactive, then delivers results back to the session that spawned them. Interactive subagents can remain alive across turns through `crew_respond` and `crew_done`.

## Behavior Rules

- Do not reintroduce shallow pass-through modules for registry, transitions, delivery policy, action/executor layers, per-tool files, message formatting, or widget-only wrappers unless behavior genuinely varies across a real seam.
- Do not allow subagent sessions to load the pi-crew extension; keep the `extensionsOverride` filter.
- Do not replace `SessionManager.newSession({ parentSession })` with `AgentSession.newSession()` for subagents.
- Do not add automatic cleanup for subagent session files.
- Do not use `getSessionFile()` as owner identity; ownership must use `sessionManager.getSessionId()`.
- Do not add custom overflow-recovery wrappers around prompt cycles; rely on `AgentSession.prompt()` to run pi-core compaction/retry to completion.
- Do not make `crew_respond` block the caller session while the subagent runs.
- Do not make `crew_done` emit a steering message.
- Do not send idle owner-session messages with `deliverAs: "steer"`.
- Do not collapse tool-triggered aborts and shutdown cleanup into the same abort reason.
- Ask before adding dependencies, CI checks, baselines, ratchets, or broad enforcement.

## Invariants & Decisions

- Context: Extension module shape.
  Rule: Keep orchestration concentrated in `crew.ts`, SDK session mechanics in `subagent-session.ts`, discovery/config in `catalog.ts`, tools in `tools.ts`, UI/message/widget behavior in `ui.ts`, and pi hook wiring in `index.ts`.
  Reason: The minimal architecture keeps lifecycle, ownership, delivery, and testing local without recreating shallow wrapper layers.

- Context: Process lifetime.
  Rule: `CrewRuntime` must remain process-global, and session-bound delivery/widget bindings must be rebound per active session.
  Reason: Subagent orchestration state must survive extension reloads and session replacement.

- Context: Subagent session isolation.
  Rule: Subagent sessions must filter out the pi-crew extension via `extensionsOverride` and must link to the owner session with `SessionManager.newSession({ parentSession })`.
  Reason: Loading pi-crew inside a subagent enables recursive spawning, while the wrong session creation path disconnects or resets the subagent.

- Context: Subagent session files.
  Rule: Subagent session files must be left on disk after completion.
  Reason: They support post-hoc inspection and resume workflows.

- Context: Prompt cycles.
  Rule: Run subagent prompt cycles with `AgentSession.prompt()` directly; pi-core handles context overflow compaction and retry before `prompt()` resolves.
  Reason: A custom event-tracking recovery wrapper duplicates pi-core behavior and can add unnecessary waiting, timeouts, and failure modes.

- Context: Subagent states.
  Rule: The only states are `running`, `waiting`, `done`, `error`, and `aborted`; only `running` and `waiting` are abortable and visible in active summaries.
  Reason: Expanding abortability or active summaries causes finished/error jobs to become targetable again.

- Context: Prompt completion.
  Rule: `stopReason: "error"` settles as `error`, `stopReason: "aborted"` settles as `aborted`, normal completion with `interactive: true` settles as `waiting`, and normal non-interactive completion settles as `done`.
  Reason: Tool behavior, delivery, cleanup, and interactive lifecycle all depend on these transitions.

- Context: `crew_respond` implementation.
  Rule: `crew_respond` must validate caller ownership, require `waiting` state with an active session, set the subagent back to `running`, start the next prompt cycle, and return immediately.
  Reason: Blocking the caller session defeats non-blocking orchestration, and responding to invalid states corrupts lifecycle state.

- Context: `crew_done` implementation.
  Rule: `crew_done` must only close `waiting` subagents owned by the caller session, must reject missing/foreign/non-waiting subagents, and must only dispose/remove state without sending a steering message.
  Reason: Closing other states can duplicate cleanup, hide state errors, or create duplicate result turns.

- Context: Abort implementation.
  Rule: Abort tools must only abort subagents owned by the caller session and in abortable states; single-id, multi-id, and all-owned modes must preserve missing and foreign-id reporting.
  Reason: Cross-session aborts or ambiguous abort results cause session interference and make tool output unreliable.

- Context: Owner-session identity.
  Rule: Ownership checks, `crew_list`, `crew_abort`, `crew_respond`, `crew_done`, `session_shutdown`, delivery, and the status widget must key by `sessionManager.getSessionId()`.
  Reason: `getSessionFile()` can be `undefined` for in-memory sessions, which would collapse distinct owners together.

- Context: Owner-session delivery.
  Rule: Results must route to the session that spawned the subagent, queue while that owner is inactive, and flush when the owner becomes active again.
  Reason: Sending results to the currently active session causes cross-session interference.

- Context: Pending flush after session activation.
  Rule: Pending message flush in `activateSession` must be deferred to the next macrotask.
  Reason: Runtime resume testing showed synchronous delivery can trigger a turn before the resumed TUI renders the queued `crew-result`; deferral preserves visible delivery across session switches.

- Context: Idle versus streaming delivery.
  Rule: Idle sessions receive `{ triggerTurn }`; streaming sessions receive `{ deliverAs: "steer", triggerTurn }`.
  Reason: Sending `deliverAs: "steer"` to an idle session can leave the message unprocessed.

- Context: Remaining subagents.
  Rule: When other subagents for the same owner are still running, deliver completed subagents' `crew-result` messages without triggering an idle owner turn; `waiting` interactive subagents must still trigger a turn.
  Reason: The owner session should not be prompted to respond to intermediate status-only updates, but interactive subagents that need input must wake the owner.

- Context: Session shutdown.
  Rule: `session_shutdown` always deactivates delivery; replacement paths (`reload`, `new`, `resume`, `fork`) stop there, while `quit` also aborts running subagents.
  Reason: Replacement should preserve background work, but real quit should clean it up.

- Context: Session replacement detection.
  Rule: Use `session_shutdown.reason` (`quit | reload | new | resume | fork`) and related event metadata directly; do not use timeout flags or pre-switch hacks to infer session transitions.
  Reason: Pi extension hooks can `await`, causing timeout-based transition flags to expire before `session_shutdown` fires.

- Context: Shutdown cleanup.
  Rule: `SIGINT`, `session_shutdown.reason === "quit"`, and `beforeExit` remain distinct cleanup paths.
  Reason: Abort result messages must reflect the actual source and still have a fallback.

- Context: Pending message memory.
  Rule: Pending messages for inactive owners are preserved but TTL-cleaned after 24 hours during flush.
  Reason: Results must survive session switches without unbounded memory growth.

- Context: Subagent definition discovery.
  Rule: Discover subagents in priority order: project `<cwd>/.pi/agents/`, user global `~/.pi/agent/agents/`, then bundled `agents/`; higher-priority duplicate names win silently, while duplicates within one source warn.
  Reason: Project/user definitions must be able to override bundled agents predictably.

- Context: Subagent config fields.
  Rule: `model` must use `provider/model-id`; invalid model values fall back to the spawning session model; omitted `tools`/`skills` means all built-ins, while explicit empty `tools`/`skills` means none.
  Reason: Model fallback and explicit capability removal are user-visible config semantics.

- Context: Interactive definitions.
  Rule: Interactive subagents must remain registered in `waiting` state after each successful response until `crew_done` disposes them.
  Reason: Follow-up turns require the SDK session to remain alive without leaking after explicit close.

- Context: Package resources.
  Rule: Bundled resources must be included in npm `files`; pi-registered resources must also appear in the `pi` manifest; bundled subagent definitions stay in `files`, not the `pi` manifest.
  Reason: Package installs must include extension, skills, prompts, and bundled agents without registering agent definitions as pi resources.

- Context: Tool guidance.
  Rule: Keep detailed orchestration guidance in the bundled `pi-crew` skill and keep tool `promptGuidelines` concise and tool-specific.
  Reason: Large tool prompts bloat every session while the skill can be loaded only when relevant.

- Context: Bundled prompts and skills.
  Rule: Orchestration prompts and skills must produce compact, task-specific subagent briefs that prioritize intent, expected outcome, decisions, and relevant entry points; avoid repeating subagent role boilerplate, default scope/output/edit permissions, cwd/branch/Git inventories, or generic repo guidance.
  Reason: Bloated briefs waste context and can obscure the specific delegated task.

- Context: Tests.
  Rule: Tests should target the minimal public behavior surfaces: `catalog`, `crew`, `tools`, `index` lifecycle wiring, and package metadata; use `CrewRuntime`'s runner seam for subagent lifecycle tests.
  Reason: Testing old internal helper seams or obvious pass-through registration recreates the architecture the refactor removed.

## Commands

- `npm run typecheck`: run after TypeScript changes; proves the extension and tests typecheck.
- `npm test`: run after behavior, tool, catalog, lifecycle, packaging, or test changes; proves the behavior suite passes.

## Maintaining This File

- Update sections only when their source of truth changes: project scope, durable rules, doc read gates, project commands, or repo-wide behavior rules.
- Add `Invariants & Decisions` entries only for non-obvious, durable, implementation-shaping rules that are costly or risky to violate.
- Create separate docs only when guidance is too noisy for `AGENTS.md`, applies to a specific task type, and has a clear read trigger. Put repo-wide docs under root `docs/`; in monorepos, put app/package-specific docs under that app/package root `docs`, not under arbitrary source folders.
- When user feedback reveals reusable guidance future agents would need, propose the smallest relevant update to this file; do not silently apply it.
- If a repo change conflicts with this file, report the conflict with affected paths instead of silently leaving stale guidance.
- Keep one source of truth for each piece of guidance; move or link instead of repeating the same rule across sections or docs.
- Do not add one-off preferences, task-specific corrections, temporary notes, obvious facts, file inventories, generic best practices, or drift-prone implementation details.
- Keep entries short. Prefer updating/removing clearly stale guidance over adding duplicates; when evidence conflicts, report the conflict and ask.
