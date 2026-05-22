import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../agent-discovery.js";
import type { BootstrapContext } from "../bootstrap-session.js";
import { type ActiveRuntimeBinding, OwnerSessionCoordinator } from "./owner-session-coordinator.js";
import { SubagentRegistry } from "./subagent-registry.js";
import { SubagentLifecycle } from "./subagent-lifecycle.js";
import type {
	ActiveAgentSummary,
	SubagentState,
} from "./subagent-state.js";
import {
	type SettledSubagentStatus,
	canAbortSubagent,
	settleSubagent,
	startSubagentResponse,
	validateSubagentDone,
} from "./subagent-transitions.js";

export type {
	ActiveAgentSummary,
} from "./subagent-state.js";

export interface AbortOwnedResult {
	abortedIds: string[];
	missingIds: string[];
	foreignIds: string[];
}

interface AbortOptions {
	reason: string;
}

export interface SpawnContext {
	model: Model<Api> | undefined;
	modelRegistry: ModelRegistry;
	agentDir: string;
	parentSessionFile?: string;
	onWarning?: (message: string) => void;
}

function toBootstrapContext(ctx: SpawnContext): BootstrapContext {
	return {
		model: ctx.model,
		modelRegistry: ctx.modelRegistry,
		agentDir: ctx.agentDir,
		parentSessionFile: ctx.parentSessionFile,
	};
}

/**
 * Process-level singleton that owns all durable subagent state.
 *
 * This survives extension instance replacement caused by runtime
 * teardown/recreation on /resume, /new, /fork (pi 0.65.0+).
 * Each new extension instance rebinds delivery and widget hooks
 * via activateSession/deactivateSession.
 */
class CrewRuntime {
	private readonly registry = new SubagentRegistry();
	private readonly ownerSessions: OwnerSessionCoordinator;
	private readonly lifecycle: SubagentLifecycle;

	// Per-session refresh callbacks, keyed by ownerSessionId
	private readonly refreshCallbacks = new Map<string, () => void>();

	constructor() {
		this.ownerSessions = new OwnerSessionCoordinator({
			countRunningForOwner: (ownerSessionId, excludeId) =>
				this.registry.countRunningForOwner(ownerSessionId, excludeId),
			onRefreshOwnerSession: (ownerSessionId) => this.refreshWidgetFor(ownerSessionId),
		});
		this.lifecycle = new SubagentLifecycle({
			isCurrent: (state) => this.registry.hasState(state),
			onProgress: (ownerSessionId) => this.ownerSessions.refresh(ownerSessionId),
			onSettled: (state, status, outcome) =>
				this.settleAgent(state, status, outcome),
		});
	}

	private refreshWidgetFor(sessionId: string): void {
		this.refreshCallbacks.get(sessionId)?.();
	}

	activateSession(
		binding: ActiveRuntimeBinding,
		refreshWidget?: () => void,
	): void {
		if (refreshWidget) {
			this.refreshCallbacks.set(binding.sessionId, refreshWidget);
		}
		this.ownerSessions.activateSession(binding);
		refreshWidget?.();
	}

	deactivateSession(sessionId: string): void {
		this.ownerSessions.deactivateSession(sessionId);
		this.refreshCallbacks.delete(sessionId);
	}

	spawn(
		agentConfig: AgentConfig,
		task: string,
		cwd: string,
		ownerSessionId: string,
		ctx: SpawnContext,
		extensionResolvedPath: string,
	): string {
		const state = this.registry.create(agentConfig, task, ownerSessionId);
		this.ownerSessions.refresh(ownerSessionId);
		this.lifecycle.start(state, {
			cwd,
			ctx: toBootstrapContext(ctx),
			extensionResolvedPath,
			onWarning: ctx.onWarning,
		});
		return state.id;
	}

	private settleAgent(
		state: SubagentState,
		nextStatus: SettledSubagentStatus,
		opts: { result?: string; error?: string },
	): void {
		settleSubagent(state, nextStatus, opts);

		this.ownerSessions.deliver(
			state.ownerSessionId,
			{
				id: state.id,
				agentName: state.agentConfig.name,
				sessionFile: state.session?.sessionFile,
				status: state.status,
				result: state.result,
				error: state.error,
			},
		);

		if (state.status !== "waiting") {
			this.disposeAgent(state);
		} else {
			this.ownerSessions.refresh(state.ownerSessionId);
		}
	}

	private disposeAgent(state: SubagentState): void {
		state.unsubscribe?.();
		state.promptAbortController = undefined;
		state.session?.dispose();
		this.registry.delete(state.id);
		this.ownerSessions.refresh(state.ownerSessionId);
	}


	respond(
		id: string,
		message: string,
		callerSessionId: string,
	): { error?: string } {
		const transition = startSubagentResponse(
			this.registry.get(id),
			id,
			callerSessionId,
		);
		if (!transition.ok) return { error: transition.error };

		this.ownerSessions.refresh(transition.state.ownerSessionId);
		this.lifecycle.respond(transition.state, message);
		return {};
	}

	done(id: string, callerSessionId: string): { error?: string } {
		const transition = validateSubagentDone(
			this.registry.get(id),
			id,
			callerSessionId,
		);
		if (!transition.ok) return { error: transition.error };

		this.disposeAgent(transition.state);
		return {};
	}

	abort(id: string, opts: AbortOptions): boolean {
		const state = this.registry.get(id);
		if (!canAbortSubagent(state)) return false;

		this.lifecycle.abortPrompt(state);
		this.settleAgent(state, "aborted", { error: opts.reason });
		return true;
	}

	abortOwned(
		ids: string[],
		callerSessionId: string,
		opts: AbortOptions,
	): AbortOwnedResult {
		const uniqueIds = Array.from(
			new Set(ids.map((id) => id.trim()).filter(Boolean)),
		);
		const result: AbortOwnedResult = {
			abortedIds: [],
			missingIds: [],
			foreignIds: [],
		};

		for (const id of uniqueIds) {
			const state = this.registry.get(id);
			if (!canAbortSubagent(state)) {
				result.missingIds.push(id);
				continue;
			}
			if (state.ownerSessionId !== callerSessionId) {
				result.foreignIds.push(id);
				continue;
			}
			if (this.abort(id, opts)) {
				result.abortedIds.push(id);
			} else {
				result.missingIds.push(id);
			}
		}

		return result;
	}

	abortAllOwned(
		callerSessionId: string,
		opts: AbortOptions,
	): string[] {
		const ids = this.registry.getOwnedAbortableIds(callerSessionId);

		for (const id of ids) {
			this.abort(id, opts);
		}

		return ids;
	}

	/**
	 * Abort all abortable subagents during shutdown cleanup.
	 * Called from SIGINT, session_shutdown(reason="quit"), and beforeExit fallback paths.
	 */
	abortAll(): void {
		const allAgents = this.registry.getAllAbortable();
		for (const state of allAgents) {
			this.abort(state.id, { reason: "Aborted during shutdown" });
		}
	}

	getActiveSummariesForOwner(ownerSessionId: string): ActiveAgentSummary[] {
		return this.registry.getActiveSummariesForOwner(ownerSessionId);
	}
}

const crewRuntimeKey = Symbol.for("pi-crew.runtime");
const globalWithCrewRuntime = globalThis as typeof globalThis & Record<
	symbol,
	CrewRuntime | undefined
>;

export const crewRuntime = globalWithCrewRuntime[crewRuntimeKey] ??= new CrewRuntime();
export type { CrewRuntime };
