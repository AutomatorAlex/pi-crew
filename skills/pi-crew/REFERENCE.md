# Pi Crew Reference

## Delegation Checklist

Before `crew_spawn`, ensure the brief includes:

- User goal and agreed decisions.
- Relevant files, symbols, entry points, commands, errors, or logs.
- Scope, constraints, and non-goals.
- Whether the subagent may edit files or must only report.
- Whether the task is exploratory, implementation, review, planning, or verification.
- Expected output format.
- Acceptance criteria.
- Verification command, if known.

Do not rely on hidden active-session context. If the subagent needs it, include it.

## Good Brief

```md
Goal: Investigate why `crew_done` emits duplicate result messages.
Context: Closing an interactive subagent should dispose the session without sending another result.
Relevant files / entry points: `extension/runtime/crew-runtime.ts`, `extension/integration/tools/crew-done.ts`, `AGENTS.md`.
Constraints: Do not change tool schemas. Do not edit unrelated lifecycle behavior.
Non-goals: Do not refactor session ownership or delivery routing.
Acceptance criteria: Identify root cause and minimal fix direction.
Expected output: Root cause, minimal fix proposal, and verification command. Do not edit files.
Verification: `npm run typecheck` if implementation is later requested.
```

## Bad Briefs

```md
Fix this.
```

```md
Investigate the bug we discussed.
```

```md
Implement the plan.
```

These depend on hidden conversation state and produce inconsistent results.

## Parallel Delegation

Use parallel subagents only when tasks are independent:

- Good: one reviewer checks correctness while another checks maintainability.
- Good: scouts inspect separate modules with non-overlapping files.
- Bad: two workers edit the same file or feature area simultaneously.

If ownership overlaps, serialize the work.

## Failure and Conflict Handling

- If a subagent errors or aborts, report that status clearly and continue only if remaining results are sufficient.
- If a result misses acceptance criteria, ask a focused follow-up or spawn a new subagent with a corrected brief.
- If results conflict, do not average them or pick silently. State the conflict, compare evidence, and resolve only with available facts or a targeted follow-up.
- If a task becomes obsolete, abort the relevant active subagent.

## Tool Notes

- `crew_list`: discovery before a new spawn decision or requested status snapshot; never completion polling.
- `crew_spawn`: self-contained delegation; ownership transfers after spawn.
- `crew_respond`: send a follow-up to a waiting interactive subagent; fire-and-forget.
- `crew_done`: close a waiting interactive subagent when complete.
- `crew_abort`: abort active owned subagents only when obsolete, wrong, or cancelled.
