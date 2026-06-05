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

Every `crew_spawn` requires both `brief` and `task`:

- `brief`: concise human-readable task label for session lists, ideally under 80 characters. Write the intent/outcome in a few words; do not include the full task, acceptance criteria, long paths, secrets, or mechanical repo state.
- `task`: self-contained delegated work body with the context the subagent needs.

Send a self-contained task, but do not fill a template mechanically. Use only sections that add task-specific value, for example:

```md
Intent / context:
Relevant inputs / entry points:
Constraints / decisions:
Deliverable / expected outcome:
Verification / checks:
```

Omit sections that would only restate the selected subagent’s role, default scope, edit permissions, output format, or obvious next steps.

Include only information that helps this specific subagent do this specific task: intent, expected outcome, relevant decisions, exact errors/output, unusual constraints, and file paths or entry points that genuinely clarify the task. Use short Markdown sections and bullets when they improve scanability, especially for multi-part intent, constraints, observations, requirements, or acceptance criteria; avoid dense paragraphs.

For repeated workflows, make each task independent. Do not assume a new subagent knows earlier loop results, owner-session discussion, or what another subagent saw. If prior findings, fixes, decisions, or verification matter, summarize the concrete facts or point to durable artifacts the subagent can inspect. Avoid vague references like “we fixed the first review findings” unless you also state what those findings/fixes were or define the current review target without relying on that history.

Do not restate boilerplate implied by the selected subagent’s role, name, or description. Avoid repeating default scope, output format, edit permissions, or repo guidance. Subagents run in the same cwd as the orchestrator, so do not include mechanical Git state they can inspect themselves, such as full changed-file lists, staged/unstaged/untracked inventories, branch/cwd details, or generic project constraints, unless those details define a non-default scope or prevent ambiguity.

If the user points to a plan, spec, issue, design, or doc as task intent, read it when practical and summarize the relevant intent instead of merely passing the path. Prefer explaining why the work matters and what outcome is expected over restating repository state.

## Result Handling

- Wait for subagent results before using them. Never invent or predict results.
- Evaluate each result against the task acceptance criteria.
- If results conflict, are incomplete, or miss criteria, state that clearly and use a follow-up or new spawn only when needed.
- After spawning, do not work on the delegated task; wait for results, continue only with unrelated work, or end the turn.

## Interactive Subagents

- Use `crew_respond` only for a waiting interactive subagent when another answer is needed.
- `crew_respond` is fire-and-forget; wait for the next steering result and do not poll.
- Use `crew_done` only when a waiting interactive subagent is complete.
- Do not call `crew_done` if you still need another answer.

## Abort

Use `crew_abort` only for active subagents owned by this session when the task is obsolete, wrong, or cancelled.
