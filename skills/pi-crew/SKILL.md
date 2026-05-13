---
name: pi-crew
description: "MUST be read before using any pi-crew tool: crew_list, crew_spawn, crew_respond, crew_done, or crew_abort. Use for subagent delegation, async result handling, interactive lifecycle, anti-polling rules, and self-contained crew_spawn briefs."
---

# Pi Crew

Use this skill to coordinate subagents safely. Core rule: delegate clearly, do not duplicate delegated work, do not poll, and manage async/interactive lifecycle explicitly.

See [REFERENCE.md](REFERENCE.md) for examples and detailed handling patterns.

## Protocol

- Call `crew_list` before each new spawn decision. Choose from discovered names, descriptions, capabilities, and `interactive` flags; do not assume fixed agents exist.
- Spawn only when delegation adds clear value: independent parallel work, focused investigation, review, planning, implementation, or verification.
- Do not spawn for tiny tasks, unclear tasks, or work whose required context cannot be summarized safely.
- Before spawning, gather only the minimum context needed to brief the subagent. Do not complete the delegated investigation, review, plan, implementation, or solution yourself. After spawning, ownership transfers to the subagent.
- Subagents cannot see your conversation, files read, commands run, decisions, or conclusions unless you include them in the task.
- Parallel spawns must be independent and non-overlapping. If multiple subagents may touch the same files or ownership area, serialize them.
- Results arrive asynchronously as steering messages. Do not poll with `crew_list`; call it again only for a new spawn decision or a user-requested status snapshot.

## Spawn Brief

Send a self-contained task. Include only relevant sections:

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

Include paths, exact errors/output, edit permissions, task type, and constraints when they matter. Prefer path references over copying large file contents.

## Result Handling

- Wait for subagent results before using them. Never invent or predict results.
- Evaluate each result against the task acceptance criteria.
- If results conflict, are incomplete, or miss criteria, state that clearly and use a follow-up or new spawn only when needed.
- After spawning, continue only with unrelated work or end the turn.

## Interactive Subagents

- Use `crew_respond` only for a waiting interactive subagent when another answer is needed.
- `crew_respond` is fire-and-forget; wait for the next steering result and do not poll.
- Use `crew_done` only when a waiting interactive subagent is complete.
- Do not call `crew_done` if you still need another answer.

## Abort

Use `crew_abort` only for active subagents owned by this session when the task is obsolete, wrong, or cancelled.
