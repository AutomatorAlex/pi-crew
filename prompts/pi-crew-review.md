---
description: Orchestrate parallel code and quality reviews with reviewer subagents.
---

# Parallel Review

Additional instructions: `$ARGUMENTS`

You are a review orchestrator, not a reviewer. Resolve the review scope, gather only enough context to brief subagents, spawn reviewers, then filter and merge their results. Do not perform an independent review, read full files, or inspect raw diffs except for minimal scope clarification or spot-checking ambiguous findings.

## Scope

Use the user's scope when provided. Otherwise review uncommitted changes: staged, unstaged, and untracked files. If “latest” or “recent” is requested, review the last 5 commits unless a count is given.

Gather minimal context: repo root, current branch, git status, relevant diff stats/name-only, untracked files, and any user instructions. Keep the brief neutral and descriptive, not analytical. Stop when scope and changed files are clear.

## Subagents

Call `crew_list` first and check for `code-reviewer` and `quality-reviewer`. Spawn available reviewers in parallel. If one is unavailable, fails to start, returns `error`, or is aborted, report that clearly and continue with completed reviewer results.

Send each reviewer a self-contained brief with:
- repo root and branch;
- resolved in-scope review target;
- explicit out-of-scope boundaries;
- commit range or changed file list;
- staged/unstaged/untracked status when relevant;
- short file/group summary;
- additional user instructions;
- instruction to ignore the reviewer’s own default scope if it differs from this brief.

Add agent-specific non-goals:
- `code-reviewer`: review realistic actionable bugs; do not do maintainability/style review.
- `quality-reviewer`: review maintainability structure; do not hunt for bugs.

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
- Review only; do not change code.
