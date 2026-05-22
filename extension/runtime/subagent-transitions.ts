import type { SubagentStatus } from "../subagent-messages.js";
import type { SubagentState } from "./subagent-state.js";

export type SettledSubagentStatus = Extract<
	SubagentStatus,
	"done" | "waiting" | "error" | "aborted"
>;

export interface SubagentTransitionOutcome {
	result?: string;
	error?: string;
}

type SubagentTransitionResult =
	| { ok: true; state: SubagentState }
	| { ok: false; error: string };

export function isAborted(state: SubagentState): boolean {
	return state.status === "aborted";
}

export function isAbortableStatus(status: SubagentStatus): boolean {
	return status === "running" || status === "waiting";
}

export function canAbortSubagent(
	state: SubagentState | undefined,
): state is SubagentState {
	return Boolean(state && isAbortableStatus(state.status));
}

function validateOwnedSubagent(
	state: SubagentState | undefined,
	id: string,
	callerSessionId: string,
	missingMessage: string,
): SubagentTransitionResult {
	if (!state) return { ok: false, error: missingMessage };
	if (state.ownerSessionId !== callerSessionId) {
		return { ok: false, error: `Subagent "${id}" belongs to a different session` };
	}
	return { ok: true, state };
}

export function startSubagentResponse(
	state: SubagentState | undefined,
	id: string,
	callerSessionId: string,
): SubagentTransitionResult {
	const owned = validateOwnedSubagent(
		state,
		id,
		callerSessionId,
		`No subagent with id "${id}"`,
	);
	if (!owned.ok) return owned;

	if (owned.state.status !== "waiting") {
		return {
			ok: false,
			error: `Subagent "${id}" is not waiting for a response (status: ${owned.state.status})`,
		};
	}
	if (!owned.state.session) {
		return { ok: false, error: `Subagent "${id}" has no active session` };
	}

	owned.state.status = "running";
	return owned;
}

export function validateSubagentDone(
	state: SubagentState | undefined,
	id: string,
	callerSessionId: string,
): SubagentTransitionResult {
	const owned = validateOwnedSubagent(
		state,
		id,
		callerSessionId,
		`No active subagent with id "${id}"`,
	);
	if (!owned.ok) return owned;

	if (owned.state.status !== "waiting") {
		return { ok: false, error: `Subagent "${id}" is not in waiting state` };
	}

	return owned;
}

export function settleSubagent(
	state: SubagentState,
	status: SettledSubagentStatus,
	outcome: SubagentTransitionOutcome,
): void {
	state.status = status;
	state.result = outcome.result;
	state.error = outcome.error;
}
