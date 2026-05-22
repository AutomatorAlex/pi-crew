import { randomBytes } from "node:crypto";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../agent-discovery.js";
import type { SubagentStatus } from "../subagent-messages.js";
import { isAbortableStatus } from "./subagent-transitions.js";

export interface SubagentState {
	id: string;
	agentConfig: AgentConfig;
	task: string;
	status: SubagentStatus;
	ownerSessionId: string;
	session: AgentSession | null;
	turns: number;
	contextTokens: number;
	model: string | undefined;
	error?: string;
	result?: string;
	promptAbortController?: AbortController;
	unsubscribe?: () => void;
}

export interface ActiveAgentSummary {
	id: string;
	agentName: string;
	status: SubagentStatus;
	turns: number;
	contextTokens: number;
	model: string | undefined;
}

function generateId(name: string, existingIds: Set<string>): string {
	for (let i = 0; i < 10; i++) {
		const id = `${name}-${randomBytes(4).toString("hex")}`;
		if (!existingIds.has(id)) return id;
	}
	return `${name}-${randomBytes(8).toString("hex")}`;
}

function buildActiveAgentSummary(
	state: SubagentState,
): ActiveAgentSummary {
	return {
		id: state.id,
		agentName: state.agentConfig.name,
		status: state.status,
		turns: state.turns,
		contextTokens: state.contextTokens,
		model: state.model,
	};
}

export class SubagentRegistry {
	private activeAgents = new Map<string, SubagentState>();

	create(agentConfig: AgentConfig, task: string, ownerSessionId: string): SubagentState {
		const id = generateId(agentConfig.name, new Set(this.activeAgents.keys()));
		const state: SubagentState = {
			id,
			agentConfig,
			task,
			status: "running",
			ownerSessionId,
			session: null,
			turns: 0,
			contextTokens: 0,
			model: undefined,
		};

		this.activeAgents.set(id, state);
		return state;
	}

	get(id: string): SubagentState | undefined {
		return this.activeAgents.get(id);
	}

	hasState(state: SubagentState): boolean {
		return this.activeAgents.get(state.id) === state;
	}

	delete(id: string): void {
		this.activeAgents.delete(id);
	}

	countRunningForOwner(ownerSessionId: string, excludeId: string): number {
		let count = 0;
		for (const state of this.activeAgents.values()) {
			if (
				state.id !== excludeId &&
				state.ownerSessionId === ownerSessionId &&
				state.status === "running"
			) {
				count++;
			}
		}
		return count;
	}

	getActiveSummariesForOwner(ownerSessionId: string): ActiveAgentSummary[] {
		return Array.from(this.activeAgents.values())
			.filter(
				(state) => isAbortableStatus(state.status) && state.ownerSessionId === ownerSessionId,
			)
			.map(buildActiveAgentSummary);
	}

	getOwnedAbortableIds(ownerSessionId: string): string[] {
		return Array.from(this.activeAgents.values())
			.filter(
				(state) =>
					state.ownerSessionId === ownerSessionId && isAbortableStatus(state.status),
			)
			.map((state) => state.id);
	}

	getAllAbortable(): SubagentState[] {
		return Array.from(this.activeAgents.values()).filter((state) =>
			isAbortableStatus(state.status),
		);
	}
}
