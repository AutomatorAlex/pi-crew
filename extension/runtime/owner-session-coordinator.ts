import type { SendMessageFn } from "../message-delivery-policy.js";
import {
	type SteeringPayload,
	sendRemainingNote,
	sendSteeringMessage,
} from "../subagent-messages.js";

export interface ActiveRuntimeBinding {
	sessionId: string;
	isIdle: () => boolean;
	sendMessage: SendMessageFn;
}

interface PendingMessage {
	ownerSessionId: string;
	payload: SteeringPayload;
	queuedAt: number;
}

interface OwnerSessionCoordinatorDeps {
	countRunningForOwner: (ownerSessionId: string, excludeId: string) => number;
	onRefreshOwnerSession: (ownerSessionId: string) => void;
	now?: () => number;
	scheduleFlush?: (callback: () => void) => void;
}

const PENDING_MESSAGE_TTL_MS = 86_400_000;

export class OwnerSessionCoordinator {
	private binding: ActiveRuntimeBinding | undefined;
	private pendingMessages: PendingMessage[] = [];
	private flushScheduled = false;
	private readonly countRunningForOwner: (ownerSessionId: string, excludeId: string) => number;
	private readonly onRefreshOwnerSession: (ownerSessionId: string) => void;
	private readonly now: () => number;
	private readonly scheduleFlush: (callback: () => void) => void;

	constructor(deps: OwnerSessionCoordinatorDeps) {
		this.countRunningForOwner = deps.countRunningForOwner;
		this.onRefreshOwnerSession = deps.onRefreshOwnerSession;
		this.now = deps.now ?? Date.now;
		this.scheduleFlush = deps.scheduleFlush ?? ((callback) => setTimeout(callback, 0));
	}

	activateSession(binding: ActiveRuntimeBinding): void {
		this.binding = binding;

		// Delay flush to next macrotask. session_start fires before pi-core
		// calls _reconnectToAgent(), so synchronous delivery would emit agent
		// events while the session listener is disconnected, losing JSONL persistence.
		if (this.pendingMessages.some((entry) => entry.ownerSessionId === binding.sessionId)) {
			this.flushScheduled = true;
			this.scheduleFlush(() => {
				this.flushScheduled = false;
				this.flushPending();
			});
		}
	}

	deactivateSession(sessionId: string): void {
		if (this.binding?.sessionId === sessionId) {
			this.binding = undefined;
		}
	}

	refresh(ownerSessionId: string): void {
		this.onRefreshOwnerSession(ownerSessionId);
	}

	deliver(ownerSessionId: string, payload: SteeringPayload): void {
		if (!this.binding || ownerSessionId !== this.binding.sessionId || this.flushScheduled) {
			this.queue(ownerSessionId, payload);
			return;
		}

		this.send(ownerSessionId, payload);
	}

	private queue(ownerSessionId: string, payload: SteeringPayload): void {
		this.pendingMessages.push({ ownerSessionId, payload, queuedAt: this.now() });
	}

	private cleanStaleMessages(): void {
		const cutoff = this.now() - PENDING_MESSAGE_TTL_MS;
		this.pendingMessages = this.pendingMessages.filter(
			(entry) => entry.queuedAt >= cutoff,
		);
	}

	private flushPending(): void {
		if (!this.binding) return;
		const targetSessionId = this.binding.sessionId;

		this.cleanStaleMessages();

		const toDeliver: PendingMessage[] = [];
		const remaining: PendingMessage[] = [];

		for (const entry of this.pendingMessages) {
			if (entry.ownerSessionId === targetSessionId) {
				toDeliver.push(entry);
			} else {
				remaining.push(entry);
			}
		}

		this.pendingMessages = remaining;

		for (const entry of toDeliver) {
			this.send(entry.ownerSessionId, entry.payload);
		}
	}

	/**
	 * Result messages always go first. If more subagents are still running and the
	 * owner is idle, queue the result without triggering, then queue the separate
	 * remaining note with triggerTurn so the next turn sees both in order.
	 */
	private send(ownerSessionId: string, payload: SteeringPayload): void {
		if (!this.binding || this.binding.sessionId !== ownerSessionId) {
			this.queue(ownerSessionId, payload);
			return;
		}

		const remaining = this.countRunningForOwner(ownerSessionId, payload.id);
		const isIdle = this.binding.isIdle();
		const triggerResultTurn = !(isIdle && remaining > 0);

		sendSteeringMessage(payload, this.binding.sendMessage, {
			isIdle,
			triggerTurn: triggerResultTurn,
		});
		sendRemainingNote(remaining, this.binding.sendMessage, {
			isIdle,
			triggerTurn: isIdle && remaining > 0,
		});
	}
}
