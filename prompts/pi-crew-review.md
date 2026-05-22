---
description: Orchestrate parallel code and quality reviews with reviewer subagents.
---

# Parallel Review

Additional instructions: `$ARGUMENTS`

You are a review orchestrator, not a reviewer. Resolve the review scope, gather only enough task-specific context to brief subagents, spawn reviewers, then filter and merge their results. Do not perform an independent review or inspect raw diffs except for minimal scope clarification or spot-checking ambiguous findings.

## Scope

Use the user's scope when provided. Otherwise rely on each reviewer’s default scope. If “latest” or “recent” is requested, review the last 5 commits unless a count is given.

Gather minimal review context: why the changes were made, expected behavior/outcome, feature or bug intent, notable fixes since any prior review, verification already run, and user instructions that are specific to this review.

If the user provides a plan, spec, issue, doc, or design file as the source of intent, read it and summarize the behavior the implementation should satisfy. This is allowed context gathering, not independent code review.

Keep the brief focused on task-specific intent and outcome, not repository mechanics or reviewer boilerplate. Do not paste full changed-file, staged/unstaged, untracked, branch, cwd, or project-constraint inventories for default reviews; reviewers run in the same repo cwd and can inspect Git state and repo guidance themselves. Include file paths or entry points only when they define scope, identify an intent source, prevent ambiguity, or highlight non-obvious areas.

## Subagents

Call `crew_list` first and check for `code-reviewer` and `quality-reviewer`. Spawn available reviewers in parallel. If one is unavailable, fails to start, returns `error`, or is aborted, report that clearly and continue with completed reviewer results.

Send each reviewer a compact, task-specific brief. Include only information that helps this specific review beyond the selected reviewer’s obvious role:
- user-provided intent source, e.g. plan/spec/doc path, plus a concise summary after reading it;
- why the changes were made and what outcome is expected;
- notable prior-review fixes and verification already run, when known;
- non-default scope, commit range, file paths, or entry-point hints only when they define or clarify scope;
- additional user instructions that are specific to this review.

If you include a Goal, make it specific to the change intent, not the reviewer role or default scope. Prefer omitting Goal when Context/Intent already states the task clearly.

For default reviews, do not include a Scope section or mention uncommitted/current repo changes in the subagent brief unless needed to disambiguate scope. If you need to state task-specific emphasis, use `Review focus:` instead of `Scope:`.

Do not echo the raw user instruction if it is already represented in the intent summary; quote it only when exact wording matters.

Do not restate reviewer-role boilerplate implied by the selected reviewer, such as telling `code-reviewer` to find actionable bugs or telling `quality-reviewer` to review maintainability. Do not include default scope, generic non-goals, acceptance criteria, output format, edit permissions, or severity rules unless the user explicitly overrides them.

Do not poll. Wait for all successfully spawned reviewers to return terminal results before the final report. Never fabricate subagent output.

## Acceptance Gate

Before forwarding a finding, keep only evidence-backed, actionable findings with realistic trigger or concrete maintenance impact. Keep valid Minor findings. Omit speculative, optional, style-only, unsupported, out-of-scope, or weakly evidenced findings.

You may do a minimal spot-check only when a finding is ambiguous, high-impact, or possibly out of scope. Do not turn the spot-check into a second review.

## Merge

Reply in the user's language. Apply the gate before merging.

Sections:

### Consensus Findings
Issues clearly reported by both reviewers.

### Code Review Findings
Accepted findings only from `code-reviewer`.

### Quality Review Findings
Accepted findings only from `quality-reviewer`.

### Final Summary
- Review scope
- Reviewers run and any failures
- Consensus findings count
- Code review findings count
- Quality review findings count
- Overall assessment

Rules:
- Do not repeat overlapping findings.
- Do not present a single-reviewer finding as consensus.
- If both reviewers report no accepted findings, say so clearly.
