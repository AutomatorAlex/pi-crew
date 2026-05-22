import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SteeringPayload } from "../extension/subagent-messages.js";
import { OwnerSessionCoordinator } from "../extension/runtime/owner-session-coordinator.js";

interface SentMessage {
	message: {
		customType?: string;
		content?: string;
		details?: unknown;
	};
	options: Record<string, unknown> | undefined;
}

function payload(id = "scout-1"): SteeringPayload {
	return {
		id,
		agentName: "scout",
		status: "done",
		result: "result body",
	};
}

function setup(opts: {
	isIdle?: boolean;
	remaining?: number;
	now?: () => number;
	scheduleFlush?: (callback: () => void) => void;
} = {}) {
	const sent: SentMessage[] = [];
	const refreshed: string[] = [];
	const coordinator = new OwnerSessionCoordinator({
		countRunningForOwner: () => opts.remaining ?? 0,
		onRefreshOwnerSession: (ownerSessionId) => refreshed.push(ownerSessionId),
		now: opts.now,
		scheduleFlush: opts.scheduleFlush,
	});

	const binding = {
		sessionId: "owner-1",
		isIdle: () => opts.isIdle ?? true,
		sendMessage: ((message: SentMessage["message"], options?: Record<string, unknown>) => {
			sent.push({ message, options });
		}) as never,
	};

	return { coordinator, binding, sent, refreshed };
}

describe("OwnerSessionCoordinator", () => {
	it("delivers immediately to the active owner session", () => {
		const { coordinator, binding, sent } = setup();
		coordinator.activateSession(binding);

		coordinator.deliver("owner-1", payload());

		assert.equal(sent.length, 1);
		assert.equal(sent[0]?.message.customType, "crew-result");
		assert.match(sent[0]?.message.content ?? "", /result body/);
		assert.deepEqual(sent[0]?.options, { triggerTurn: true });
	});

	it("queues inactive owner messages and flushes them after activation", () => {
		let flush: (() => void) | undefined;
		const { coordinator, binding, sent } = setup({
			scheduleFlush: (callback) => {
				flush = callback;
			},
		});

		coordinator.deliver("owner-1", payload());
		assert.equal(sent.length, 0);

		coordinator.activateSession(binding);
		assert.equal(sent.length, 0);
		flush?.();

		assert.equal(sent.length, 1);
		assert.equal(sent[0]?.message.customType, "crew-result");
	});

	it("when idle with remaining subagents, triggers only the remaining note", () => {
		const { coordinator, binding, sent } = setup({ isIdle: true, remaining: 2 });
		coordinator.activateSession(binding);

		coordinator.deliver("owner-1", payload());

		assert.equal(sent.length, 2);
		assert.equal(sent[0]?.message.customType, "crew-result");
		assert.deepEqual(sent[0]?.options, { triggerTurn: false });
		assert.equal(sent[1]?.message.customType, "crew-remaining");
		assert.deepEqual(sent[1]?.options, { triggerTurn: true });
	});

	it("uses steer delivery while the owner session is streaming", () => {
		const { coordinator, binding, sent } = setup({ isIdle: false });
		coordinator.activateSession(binding);

		coordinator.deliver("owner-1", payload());

		assert.equal(sent.length, 1);
		assert.deepEqual(sent[0]?.options, { deliverAs: "steer", triggerTurn: true });
	});

	it("refreshes owner sessions through the configured callback", () => {
		const { coordinator, refreshed } = setup();

		coordinator.refresh("owner-1");
		coordinator.refresh("owner-2");

		assert.deepEqual(refreshed, ["owner-1", "owner-2"]);
	});

	it("deactivation clears the active binding", () => {
		const { coordinator, binding, sent } = setup();
		coordinator.activateSession(binding);
		coordinator.deactivateSession("owner-1");

		coordinator.deliver("owner-1", payload());

		assert.equal(sent.length, 0);
	});
});
