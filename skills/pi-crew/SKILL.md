---
name: pi-crew
description: "MUST be read before using any pi-crew tool: crew_list, crew_spawn, crew_respond, crew_done, or crew_abort. Use for all subagent delegation, async result handling, interactive subagent lifecycle, anti-polling rules, and writing self-contained crew_spawn task briefs."
---

# Pi Crew

Use this skill whenever you coordinate work with `pi-crew` tools. Its primary purpose is to standardize orchestrator behavior while teaching safe use of `crew_*` tools.

## Core protocol

1. Use `crew_list` to discover available subagents before each new spawn decision.
2. Choose from the discovered subagents by their current names, descriptions, capabilities, and `interactive` flag. Do not assume any fixed subagent names exist.
3. Spawn only when delegation creates clear value: parallel independent work, focused investigation, review, planning, or implementation that can be handled independently by a subagent.
4. Do not spawn for tiny tasks, unclear tasks, or work whose required context cannot be summarized safely.
5. Do not do the delegated work yourself before spawning or after spawning. Before spawning, gather only the minimum context needed to delegate; you may read enough files or output to create a self-contained task, but do not complete the investigation, review, implementation, or solution yourself. After spawning, ownership transfers to the subagent.
6. Results arrive asynchronously as steering messages at any time. As the orchestrator, do not keep calling `crew_list` to check completion, and do not invent or predict subagent results.

## Before spawning

Gather only enough context to write a useful task:

- user goal and agreed decisions
- relevant files, symbols, commands, errors, or entry points
- constraints and non-goals
- expected output format
- acceptance criteria
- verification command, if known

Do not fully investigate, implement, review, or solve the delegated task before spawning. That duplicates the subagent's work and creates conflicting conclusions.

The subagent cannot access your active session. It cannot see user messages, decisions already made, files you discovered, commands you ran, or conclusions you reached unless you include the necessary information in the task.

## `crew_spawn` task template

Write the task as a self-contained brief. The subagent cannot see your current conversation or active session state unless you include the needed context.

```md
Goal:

Context:

Relevant files / entry points:

Constraints:

Non-goals:

Acceptance criteria:

Expected output:

Verification:
```

Omit sections only when they are genuinely irrelevant.

## Good delegation rules

- Include absolute or repo-relative file paths when known.
- If the finding is a file, reference it by path instead of copying the file contents into the task.
- Include exact error messages or command output when they matter.
- State whether the subagent may edit files or should only report findings.
- State whether the task is exploratory, implementation, review, or verification.
- For parallel spawns, make tasks independent and non-overlapping.
- If multiple subagents may touch the same files, serialize the work instead of spawning in parallel.

## Bad patterns

Avoid tasks like:

```md
Fix this.
```

```md
Investigate the bug we discussed.
```

```md
Implement the plan.
```

These rely on hidden active-session context and produce inconsistent results.

Prefer:

```md
Goal: Investigate why `crew_done` emits duplicate result messages.
Context: Closing an interactive subagent should dispose the session without sending another result.
Relevant files: `extension/runtime/crew-runtime.ts`, `extension/integration/tools/crew-done.ts`, `AGENTS.md`.
Constraints: Do not change tool schemas. Do not edit unrelated lifecycle behavior.
Expected output: Root cause, minimal fix proposal, and verification command. Do not edit files.
```

## Async result handling

- After spawning, continue only with unrelated work or end the turn.
- The subagent runs asynchronously and may answer at any time via a `crew-result` steering message.
- Wait for the `crew-result` steering message before using the result.
- If more subagents are still running, wait for each relevant result before combining conclusions.
- Evaluate results against the task acceptance criteria before using them.
- If results conflict, are incomplete, or miss acceptance criteria, state that explicitly and use a follow-up or new spawn only when needed.
- Do not repeatedly call `crew_list` as an orchestrator. Call it again only for a user-requested status snapshot or to discover subagents for a new spawn decision.

## Interactive subagents

Interactive subagents stay alive after responding.

- Use `crew_respond` to send a follow-up to a waiting interactive subagent.
- `crew_respond` is fire-and-forget: the next response arrives asynchronously as a steering message.
- Do not poll after `crew_respond`.
- Use `crew_done` when the interaction is complete.
- Do not call `crew_done` if you still need another answer from that subagent.

## Tool safety quick rules

- `crew_list`: do use for discovery before a new spawn decision or for a user-requested status snapshot; do not use it for polling completion.
- `crew_spawn`: do send a self-contained task with constraints, non-goals, expected output, and acceptance criteria; do not rely on hidden active-session context.
- `crew_respond`: do use only for a waiting interactive subagent when another answer is needed; do not poll afterward.
- `crew_done`: do use only when a waiting interactive subagent interaction is complete; do not call it if another answer is needed.
- `crew_abort`: do use only for active subagents owned by your active session when the task is obsolete, wrong, or cancelled; do not abort unrelated work.

## Aborting

Use `crew_abort` only for active subagents owned by your active session.

- Abort a specific subagent when its task is obsolete or wrong.
- Abort all owned subagents only when the user requests cancellation or your plan has changed so all delegated work is invalid.
