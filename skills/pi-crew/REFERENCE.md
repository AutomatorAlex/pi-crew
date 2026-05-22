# Pi Crew Reference

## Delegation Checklist

Before `crew_spawn`, ensure the brief is self-contained but not mechanically templated. Include only information that helps this specific subagent do this specific task:

- Intent, expected outcome, and relevant user decisions.
- User-provided references, plus a concise summary after reading them when practical.
- File paths, symbols, entry points, commands, errors, or logs only when they genuinely clarify the task.
- Non-default scope, constraints, assumptions, or verification context only when they matter.
- Gaps or unresolved questions the subagent should account for.

Do not restate boilerplate implied by the selected subagent’s role, name, or description. Avoid repeating default scope, edit permissions, output format, generic repo guidance, cwd/branch details, or mechanical Git state the subagent can inspect itself.

Do not rely on hidden active-session context. If the subagent needs a decision, conclusion, user intent, or prior result that is not discoverable from files/tools, include it.

## Good Brief

```md
Intent / context:
Interactive subagent close should dispose the session without emitting another result. The current behavior appears to duplicate the previous result after `crew_done`.

Relevant inputs / entry points:
- `extension/runtime/crew-runtime.ts`: interactive subagent lifecycle and result delivery.
- `extension/integration/tools/crew-done.ts`: close tool behavior.

Constraints / decisions:
- Keep ownership and delivery routing unchanged.
- Do not add cleanup of subagent session files.

Deliverable:
Identify the root cause and minimal fix direction.
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

```md
Goal: Review the current uncommitted changes for actionable bugs.
Scope: Current repo changes, staged/unstaged/untracked files.
Non-goals: Do not modify files.
Expected output: Findings with severity and fix direction.
```

These depend on hidden conversation state, restate subagent boilerplate, or carry mechanical repository state instead of task-specific intent.

## Parallel Delegation

Use parallel subagents only when tasks are independent:

- Good: one reviewer checks correctness while another checks maintainability.
- Good: scouts inspect separate modules with non-overlapping files.
- Bad: two workers edit the same file or feature area simultaneously.

If ownership overlaps, serialize the work.

## Failure and Conflict Handling

- If a subagent errors or aborts, report that status clearly and continue only if remaining results are sufficient.
- If a result misses the task-specific deliverable, ask a focused follow-up or spawn a new subagent with a corrected brief.
- If results conflict, do not average them or pick silently. State the conflict, compare evidence, and resolve only with available facts or a targeted follow-up.
- If a task becomes obsolete, abort the relevant active subagent.

## Tool Notes

- `crew_list`: discovery before a new spawn decision or requested status snapshot; never completion polling.
- `crew_spawn`: self-contained delegation; ownership transfers after spawn.
- `crew_respond`: send a follow-up to a waiting interactive subagent; fire-and-forget.
- `crew_done`: close a waiting interactive subagent when complete.
- `crew_abort`: abort active owned subagents only when obsolete, wrong, or cancelled.
