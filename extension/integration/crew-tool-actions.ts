import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type {
	AgentConfig,
	AgentDiscoveryResult,
	AgentDiscoveryWarning,
} from "../agent-discovery.js";
import type {
	AbortOwnedResult,
	ActiveAgentSummary,
	CrewRuntime,
} from "../runtime/crew-runtime.js";
import { STATUS_ICON } from "../subagent-messages.js";

export type CrewToolResult = AgentToolResult<unknown> & {
	isError?: boolean;
	terminate?: boolean;
};

export type CrewToolActionSideEffect =
	| { type: "discovery-warnings"; warnings: AgentDiscoveryWarning[] }
	| { type: "active-list-warning" };

export interface CrewToolActionResponse {
	result: CrewToolResult;
	sideEffects: CrewToolActionSideEffect[];
}

export interface CrewToolActionContext {
	cwd: string;
	callerSessionId: string;
}

export interface CrewSpawnActionContext extends CrewToolActionContext {
	model: Model<Api> | undefined;
	modelRegistry: ModelRegistry;
	agentDir: string;
	parentSessionFile?: string;
	onWarning?: (message: string) => void;
}

interface CrewToolRuntime {
	spawn: CrewRuntime["spawn"];
	abortAllOwned: CrewRuntime["abortAllOwned"];
	abortOwned: CrewRuntime["abortOwned"];
	respond: CrewRuntime["respond"];
	done: CrewRuntime["done"];
	getActiveSummariesForOwner: CrewRuntime["getActiveSummariesForOwner"];
}

interface CreateCrewToolActionsDeps {
	crew: CrewToolRuntime;
	discoverAgents: (cwd: string) => AgentDiscoveryResult;
	extensionDir: string;
}

function toolError(text: string): CrewToolResult {
	return {
		content: [{ type: "text", text }],
		isError: true,
		details: { error: true },
	};
}

function toolSuccess(
	text: string,
	details: Record<string, unknown> = {},
	options: { terminate?: boolean } = {},
): CrewToolResult {
	return {
		content: [{ type: "text", text }],
		details,
		...(options.terminate ? { terminate: true } : {}),
	};
}

function response(
	result: CrewToolResult,
	sideEffects: CrewToolActionSideEffect[] = [],
): CrewToolActionResponse {
	return { result, sideEffects };
}

function discoveryWarningSideEffect(
	warnings: AgentDiscoveryWarning[],
): CrewToolActionSideEffect[] {
	return warnings.length > 0 ? [{ type: "discovery-warnings", warnings }] : [];
}

function formatAbortToolMessage(result: AbortOwnedResult): string {
	const parts: string[] = [];

	if (result.abortedIds.length > 0) {
		parts.push(`Aborted ${result.abortedIds.length} subagent(s): ${result.abortedIds.join(", ")}`);
	}
	if (result.missingIds.length > 0) {
		parts.push(`Not found or already finished: ${result.missingIds.join(", ")}`);
	}
	if (result.foreignIds.length > 0) {
		parts.push(`Belong to a different session: ${result.foreignIds.join(", ")}`);
	}

	return parts.join("\n");
}

function formatAvailableAgents(agents: AgentConfig[]): string[] {
	if (agents.length === 0) {
		return [
			"No valid subagent definitions found. Add `.md` files to `<cwd>/.pi/agents/` or `~/.pi/agent/agents/`.",
		];
	}

	return agents.flatMap((agent) => [
		"",
		`name: ${agent.name}`,
		`description: ${agent.description}`,
		`interactive: ${agent.interactive ? "true" : "false"}`,
	]);
}

function formatWarnings(warnings: AgentDiscoveryWarning[]): string[] {
	if (warnings.length === 0) return [];

	return [
		"",
		"## Ignored subagent definitions",
		...warnings.map((warning) => `- ${warning.message} (${warning.filePath})`),
	];
}

function formatActiveAgents(running: ActiveAgentSummary[]): string[] {
	if (running.length === 0) return ["No subagents currently active."];

	return running.flatMap((agent) => {
		const icon = STATUS_ICON[agent.status] ?? "❓";
		return [
			"",
			`id: ${agent.id}`,
			`name: ${agent.agentName}`,
			`status: ${icon} ${agent.status}`,
		];
	});
}

export type CrewToolActions = ReturnType<typeof createCrewToolActions>;

export function createCrewToolActions({
	crew,
	discoverAgents,
	extensionDir,
}: CreateCrewToolActionsDeps) {
	return {
		list(ctx: CrewToolActionContext): CrewToolActionResponse {
			const { agents, warnings } = discoverAgents(ctx.cwd);
			const running = crew.getActiveSummariesForOwner(ctx.callerSessionId);
			const lines = [
				"## Available Subagents",
				...formatAvailableAgents(agents),
				...formatWarnings(warnings),
				"",
				"## Active Subagents",
				...formatActiveAgents(running),
			];

			return response(
				{ content: [{ type: "text", text: lines.join("\n") }], details: {} },
				[
					...discoveryWarningSideEffect(warnings),
					...(running.length > 0 ? [{ type: "active-list-warning" } as const] : []),
				],
			);
		},

		spawn(
			params: { subagent: string; task: string },
			ctx: CrewSpawnActionContext,
		): CrewToolActionResponse {
			const { agents, warnings } = discoverAgents(ctx.cwd);
			const sideEffects = discoveryWarningSideEffect(warnings);
			const subagent = agents.find(
				(candidate) => candidate.name === params.subagent,
			);

			if (!subagent) {
				const available =
					agents.map((candidate) => candidate.name).join(", ") || "none";
				return response(
					toolError(
						`Unknown subagent: "${params.subagent}". Available: ${available}`,
					),
					sideEffects,
				);
			}

			const id = crew.spawn(
				subagent,
				params.task,
				ctx.cwd,
				ctx.callerSessionId,
				{
					model: ctx.model,
					modelRegistry: ctx.modelRegistry,
					agentDir: ctx.agentDir,
					parentSessionFile: ctx.parentSessionFile,
					onWarning: ctx.onWarning,
				},
				extensionDir,
			);

			return response(
				toolSuccess(
					`Subagent '${subagent.name}' spawned as ${id}. Result will be delivered as a steering message when done.`,
					{ id, agentName: subagent.name, task: params.task },
				),
				sideEffects,
			);
		},

		abort(
			params: {
				subagent_id?: string;
				subagent_ids?: string[];
				all?: boolean;
			},
			ctx: CrewToolActionContext,
		): CrewToolActionResponse {
			const modeCount = Number(Boolean(params.subagent_id))
				+ Number(Boolean(params.subagent_ids?.length))
				+ Number(params.all === true);

			if (modeCount !== 1) {
				return response(toolError(
					"Provide exactly one of: subagent_id, subagent_ids, or all=true.",
				));
			}

			if (params.all) {
				const abortedIds = crew.abortAllOwned(ctx.callerSessionId, {
					reason: "Aborted by tool request",
				});
				if (abortedIds.length === 0) {
					return response(toolError("No active subagents in the current session."));
				}

				return response(toolSuccess(
					`Aborted ${abortedIds.length} subagent(s): ${abortedIds.join(", ")}`,
					{ ids: abortedIds },
					{ terminate: true },
				));
			}

			const ids = params.subagent_id
				? [params.subagent_id]
				: (params.subagent_ids ?? []);
			const result = crew.abortOwned(ids, ctx.callerSessionId, {
				reason: "Aborted by tool request",
			});
			const message = formatAbortToolMessage(result);

			if (result.abortedIds.length === 0) {
				return response(toolError(message || "No subagents were aborted."));
			}

			return response(toolSuccess(
				message,
				{
					ids: result.abortedIds,
					missing_ids: result.missingIds,
					foreign_ids: result.foreignIds,
				},
				{ terminate: true },
			));
		},

		respond(
			params: { subagent_id: string; message: string },
			ctx: CrewToolActionContext,
		): CrewToolActionResponse {
			const { error } = crew.respond(
				params.subagent_id,
				params.message,
				ctx.callerSessionId,
			);
			if (error) return response(toolError(error));

			return response(toolSuccess(
				`Message sent to subagent ${params.subagent_id}. Response will be delivered as a steering message.`,
				{ id: params.subagent_id, message: params.message },
			));
		},

		done(
			params: { subagent_id: string },
			ctx: CrewToolActionContext,
		): CrewToolActionResponse {
			const { error } = crew.done(params.subagent_id, ctx.callerSessionId);
			if (error) return response(toolError(error));

			return response(toolSuccess(
				`Subagent ${params.subagent_id} closed.`,
				{ id: params.subagent_id },
			));
		},
	};
}
