import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AgentConfig, AgentDiscoveryResult } from "../extension/agent-discovery.js";
import { createCrewToolActions } from "../extension/integration/crew-tool-actions.js";
import type { AbortOwnedResult, ActiveAgentSummary } from "../extension/runtime/crew-runtime.js";

function agent(name: string): AgentConfig {
	return {
		name,
		description: `${name} description`,
		systemPrompt: `${name} prompt`,
		filePath: `/agents/${name}.md`,
	};
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
	const first = result.content[0];
	assert.equal(first?.type, "text");
	return first.text ?? "";
}

class FakeCrew {
	active: ActiveAgentSummary[] = [];
	spawnCalls: unknown[][] = [];
	abortAllOwnedResult: string[] = [];
	abortOwnedResult: AbortOwnedResult = {
		abortedIds: [],
		missingIds: [],
		foreignIds: [],
	};
	respondError: string | undefined;
	doneError: string | undefined;

	spawn(...args: unknown[]): string {
		this.spawnCalls.push(args);
		return "scout-1234";
	}

	abortAllOwned(): string[] {
		return this.abortAllOwnedResult;
	}

	abortOwned(): AbortOwnedResult {
		return this.abortOwnedResult;
	}

	respond(): { error?: string } {
		return { error: this.respondError };
	}

	done(): { error?: string } {
		return { error: this.doneError };
	}

	getActiveSummariesForOwner(): ActiveAgentSummary[] {
		return this.active;
	}
}

function setup(discovery: AgentDiscoveryResult = { agents: [], warnings: [] }) {
	const crew = new FakeCrew();
	const actions = createCrewToolActions({
		crew,
		discoverAgents: () => discovery,
		extensionDir: "/pkg/extension",
	});
	return { crew, actions };
}

const actionCtx = {
	cwd: "/repo",
	callerSessionId: "owner-1",
};

describe("CrewToolActions", () => {
	it("spawns a known subagent and returns stable tool result details", () => {
		const { crew, actions } = setup({ agents: [agent("scout")], warnings: [] });

		const response = actions.spawn(
			{ subagent: "scout", task: "inspect package name" },
			{
				...actionCtx,
				model: undefined,
				modelRegistry: {} as never,
				agentDir: "/home/.pi/agent",
				parentSessionFile: "/sessions/parent.jsonl",
			},
		);

		assert.equal(response.sideEffects.length, 0);
		assert.equal(text(response.result), "Subagent 'scout' spawned as scout-1234. Result will be delivered as a steering message when done.");
		assert.deepEqual(response.result.details, {
			id: "scout-1234",
			agentName: "scout",
			task: "inspect package name",
		});
		assert.equal(crew.spawnCalls.length, 1);
		assert.equal((crew.spawnCalls[0]?.[0] as AgentConfig | undefined)?.name, "scout");
	});

	it("returns unknown subagent errors with available names and forwards discovery warnings", () => {
		const warning = { filePath: "/bad.md", message: "bad definition" };
		const { actions } = setup({ agents: [agent("scout")], warnings: [warning] });

		const response = actions.spawn(
			{ subagent: "missing", task: "x" },
			{
				...actionCtx,
				model: undefined,
				modelRegistry: {} as never,
				agentDir: "/home/.pi/agent",
			},
		);

		assert.equal(response.result.isError, true);
		assert.equal(text(response.result), 'Unknown subagent: "missing". Available: scout');
		assert.deepEqual(response.sideEffects, [
			{ type: "discovery-warnings", warnings: [warning] },
		]);
	});

	it("lists available and active subagents and requests active warning only when active exists", () => {
		const { crew, actions } = setup({ agents: [agent("planner")], warnings: [] });
		crew.active = [{
			id: "planner-1",
			agentName: "planner",
			status: "waiting",
			turns: 2,
			contextTokens: 1200,
			model: "model-x",
		}];

		const response = actions.list(actionCtx);

		assert.match(text(response.result), /name: planner/);
		assert.match(text(response.result), /id: planner-1/);
		assert.match(text(response.result), /status: ⏳ waiting/);
		assert.deepEqual(response.sideEffects, [{ type: "active-list-warning" }]);
	});

	it("does not request active warning when no subagents are active", () => {
		const { actions } = setup({ agents: [agent("scout")], warnings: [] });

		const response = actions.list(actionCtx);

		assert.match(text(response.result), /No subagents currently active\./);
		assert.equal(response.sideEffects.length, 0);
	});

	it("validates abort mode and formats all-mode empty result", () => {
		const { actions } = setup();

		const invalid = actions.abort({ subagent_id: "a", all: true }, actionCtx);
		assert.equal(invalid.result.isError, true);
		assert.equal(text(invalid.result), "Provide exactly one of: subagent_id, subagent_ids, or all=true.");

		const empty = actions.abort({ all: true }, actionCtx);
		assert.equal(empty.result.isError, true);
		assert.equal(text(empty.result), "No active subagents in the current session.");
	});

	it("formats partial abort results with missing and foreign ids", () => {
		const { crew, actions } = setup();
		crew.abortOwnedResult = {
			abortedIds: ["a"],
			missingIds: ["b"],
			foreignIds: ["c"],
		};

		const response = actions.abort({ subagent_ids: ["a", "b", "c"] }, actionCtx);

		assert.equal(response.result.terminate, true);
		assert.equal(text(response.result), "Aborted 1 subagent(s): a\nNot found or already finished: b\nBelong to a different session: c");
		assert.deepEqual(response.result.details, {
			ids: ["a"],
			missing_ids: ["b"],
			foreign_ids: ["c"],
		});
	});

	it("passes respond and done runtime errors through and returns success details", () => {
		const { crew, actions } = setup();
		crew.respondError = "not waiting";
		crew.doneError = "not found";

		assert.equal(text(actions.respond({ subagent_id: "p", message: "hi" }, actionCtx).result), "not waiting");
		assert.equal(text(actions.done({ subagent_id: "p" }, actionCtx).result), "not found");

		crew.respondError = undefined;
		crew.doneError = undefined;

		const respond = actions.respond({ subagent_id: "p", message: "hi" }, actionCtx).result;
		assert.equal(text(respond), "Message sent to subagent p. Response will be delivered as a steering message.");
		assert.deepEqual(respond.details, { id: "p", message: "hi" });

		const done = actions.done({ subagent_id: "p" }, actionCtx).result;
		assert.equal(text(done), "Subagent p closed.");
		assert.deepEqual(done.details, { id: "p" });
	});
});
