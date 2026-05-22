import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CrewToolExecutor } from "../extension/integration/crew-tool-executor.js";
import type { AgentDiscoveryWarning } from "../extension/agent-discovery.js";
import type { CrewToolResult } from "../extension/integration/crew-tool-actions.js";

function toolResult(text = "ok"): CrewToolResult {
	return {
		content: [{ type: "text", text }],
		details: {},
	};
}

function fakeContext(overrides: Record<string, unknown> = {}) {
	return {
		cwd: "/repo",
		sessionManager: {
			getSessionId: () => "owner-1",
		},
		isIdle: () => true,
		...overrides,
	} as never;
}

function fakePi(sent: Array<{ message: unknown; options: unknown }> = []) {
	return {
		sendMessage(message: unknown, options: unknown) {
			sent.push({ message, options });
		},
	} as never;
}

describe("CrewToolExecutor", () => {
	it("builds the shared action context and returns the action result", () => {
		const executor = new CrewToolExecutor({
			pi: fakePi(),
			notifyDiscoveryWarnings: () => {},
		});
		let captured: unknown;

		const result = executor.execute(fakeContext(), (actionCtx) => {
			captured = actionCtx;
			return { result: toolResult("done"), sideEffects: [] };
		});

		assert.deepEqual(captured, {
			cwd: "/repo",
			callerSessionId: "owner-1",
		});
		assert.equal(result.content[0]?.type, "text");
		assert.equal(result.content[0]?.text, "done");
	});

	it("runs discovery warning side effects", () => {
		const warnings: AgentDiscoveryWarning[] = [
			{ filePath: "/bad.md", message: "bad definition" },
		];
		const notified: AgentDiscoveryWarning[][] = [];
		const executor = new CrewToolExecutor({
			pi: fakePi(),
			notifyDiscoveryWarnings: (_ctx, warningBatch) => {
				notified.push(warningBatch);
			},
		});

		executor.execute(fakeContext(), () => ({
			result: toolResult(),
			sideEffects: [{ type: "discovery-warnings", warnings }],
		}));

		assert.deepEqual(notified, [warnings]);
	});

	it("sends active list warnings through the owner session delivery options", async () => {
		const sent: Array<{ message: unknown; options: unknown }> = [];
		const executor = new CrewToolExecutor({
			pi: fakePi(sent),
			notifyDiscoveryWarnings: () => {},
		});

		executor.execute(fakeContext({ isIdle: () => false }), () => ({
			result: toolResult(),
			sideEffects: [{ type: "active-list-warning" }],
		}));
		await Promise.resolve();

		assert.equal(sent.length, 1);
		assert.deepEqual(sent[0]?.options, { deliverAs: "steer", triggerTurn: true });
		assert.match(String((sent[0]?.message as { content?: unknown } | undefined)?.content), /Do not poll crew_list/);
	});
});
