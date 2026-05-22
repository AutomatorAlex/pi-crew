import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AgentConfig } from "../extension/agent-discovery.js";
import type { SubagentStatus } from "../extension/subagent-messages.js";
import type { SubagentState } from "../extension/runtime/subagent-state.js";
import {
	canAbortSubagent,
	isAbortableStatus,
	settleSubagent,
	startSubagentResponse,
	validateSubagentDone,
} from "../extension/runtime/subagent-transitions.js";

const agentConfig: AgentConfig = {
	name: "planner",
	description: "planner description",
	systemPrompt: "planner prompt",
	filePath: "/agents/planner.md",
};

function state(
	overrides: Partial<SubagentState> = {},
): SubagentState {
	return {
		id: "planner-1",
		agentConfig,
		task: "plan",
		status: "waiting",
		ownerSessionId: "owner-1",
		session: {} as never,
		turns: 0,
		contextTokens: 0,
		model: undefined,
		...overrides,
	};
}

describe("subagent transitions", () => {
	it("starts a waiting owned subagent response", () => {
		const subagent = state();

		const result = startSubagentResponse(subagent, subagent.id, "owner-1");

		assert.equal(result.ok, true);
		assert.equal(subagent.status, "running");
	});

	it("rejects invalid response transitions without mutating status", () => {
		const running = state({ status: "running" });
		const noSession = state({ session: null });

		assert.deepEqual(
			startSubagentResponse(undefined, "missing", "owner-1"),
			{ ok: false, error: 'No subagent with id "missing"' },
		);
		assert.deepEqual(
			startSubagentResponse(state(), "planner-1", "owner-2"),
			{ ok: false, error: 'Subagent "planner-1" belongs to a different session' },
		);
		assert.deepEqual(
			startSubagentResponse(running, "planner-1", "owner-1"),
			{ ok: false, error: 'Subagent "planner-1" is not waiting for a response (status: running)' },
		);
		assert.deepEqual(
			startSubagentResponse(noSession, "planner-1", "owner-1"),
			{ ok: false, error: 'Subagent "planner-1" has no active session' },
		);
		assert.equal(running.status, "running");
		assert.equal(noSession.status, "waiting");
	});

	it("validates done preconditions without changing status", () => {
		const waiting = state();
		const running = state({ status: "running" });

		assert.equal(validateSubagentDone(waiting, "planner-1", "owner-1").ok, true);
		assert.equal(waiting.status, "waiting");
		assert.deepEqual(
			validateSubagentDone(undefined, "missing", "owner-1"),
			{ ok: false, error: 'No active subagent with id "missing"' },
		);
		assert.deepEqual(
			validateSubagentDone(waiting, "planner-1", "owner-2"),
			{ ok: false, error: 'Subagent "planner-1" belongs to a different session' },
		);
		assert.deepEqual(
			validateSubagentDone(running, "planner-1", "owner-1"),
			{ ok: false, error: 'Subagent "planner-1" is not in waiting state' },
		);
	});

	it("settles subagent outcome in one transition", () => {
		const subagent = state({ status: "running" });

		settleSubagent(subagent, "error", { error: "failed" });

		assert.equal(subagent.status, "error");
		assert.equal(subagent.result, undefined);
		assert.equal(subagent.error, "failed");
	});

	it("owns abortable status rules", () => {
		const statuses: Record<SubagentStatus, boolean> = {
			running: true,
			waiting: true,
			done: false,
			error: false,
			aborted: false,
		};

		for (const [status, expected] of Object.entries(statuses) as [SubagentStatus, boolean][]) {
			assert.equal(isAbortableStatus(status), expected);
			assert.equal(canAbortSubagent(state({ status })), expected);
		}
		assert.equal(canAbortSubagent(undefined), false);
	});
});
