import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	discoverAgents,
	type AgentConfig,
	type AgentDiscoveryWarning,
} from "./catalog.js";
import type { AbortOwnedResult, ActiveAgentSummary, CrewRuntime } from "./crew.js";
import { STATUS_ICON, renderCrewCall, renderCrewResult, sendCrewListActiveWarning } from "./ui.js";

export type CrewToolResult = AgentToolResult<unknown> & {
	isError?: boolean;
	terminate?: boolean;
};

type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];
type ToolRenderCall = Exclude<RegisteredTool["renderCall"], undefined>;

interface ToolContext {
	cwd: string;
	callerSessionId: string;
}

function getToolContext(ctx: ExtensionContext): ToolContext {
	return {
		cwd: ctx.cwd,
		callerSessionId: ctx.sessionManager.getSessionId(),
	};
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

function formatAvailableAgents(agents: AgentConfig[]): string[] {
	if (agents.length === 0) {
		return ["No valid subagent definitions found. Add `.md` files to `<cwd>/.pi/agents/` or `~/.pi/agent/agents/`."];
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
		return ["", `id: ${agent.id}`, `name: ${agent.agentName}`, `status: ${icon} ${agent.status}`];
	});
}

function formatAbortToolMessage(result: AbortOwnedResult): string {
	const parts: string[] = [];
	if (result.abortedIds.length > 0) parts.push(`Aborted ${result.abortedIds.length} subagent(s): ${result.abortedIds.join(", ")}`);
	if (result.missingIds.length > 0) parts.push(`Not found or already finished: ${result.missingIds.join(", ")}`);
	if (result.foreignIds.length > 0) parts.push(`Belong to a different session: ${result.foreignIds.join(", ")}`);
	return parts.join("\n");
}

function notifyDiscoveryWarnings(
	ctx: ExtensionContext,
	shownDiscoveryWarnings: Set<string>,
	warnings: AgentDiscoveryWarning[],
): void {
	if (!ctx.hasUI) return;
	for (const warning of warnings) {
		const key = `${warning.filePath}:${warning.message}`;
		if (shownDiscoveryWarnings.has(key)) continue;
		shownDiscoveryWarnings.add(key);
		ctx.ui.notify(`${warning.message} (${warning.filePath})`, "error");
	}
}

function showActiveListWarning(pi: ExtensionAPI, ctx: ExtensionContext): void {
	Promise.resolve().then(() => {
		sendCrewListActiveWarning(pi.sendMessage.bind(pi), {
			isIdle: ctx.isIdle(),
			triggerTurn: true,
		});
	});
}

function registerActionTool<Params extends object>(
	pi: ExtensionAPI,
	options: Omit<RegisteredTool, "execute" | "renderResult" | "renderCall"> & {
		action: (params: Params, ctx: ExtensionContext) => CrewToolResult;
		renderCall?: (
			args: Partial<Params>,
			theme: Parameters<ToolRenderCall>[1],
			context: Parameters<ToolRenderCall>[2],
		) => ReturnType<ToolRenderCall>;
	},
): void {
	const { action, renderCall, ...tool } = options;
	pi.registerTool({
		...tool,
		...(renderCall ? { renderCall: (args, theme, context) => renderCall(args as Partial<Params>, theme, context) } : {}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return action(params as Params, ctx);
		},
		renderResult(result, _options, theme, _context) {
			return renderCrewResult(result, theme);
		},
	});
}

export function registerCrewTools(pi: ExtensionAPI, crew: CrewRuntime, extensionDir: string): void {
	const shownDiscoveryWarnings = new Set<string>();

	pi.registerTool({
		name: "crew_list",
		label: "List Crew",
		description:
			"List available subagent definitions and currently running subagents with their status. Use only to discover which subagents exist or to get a one-time status snapshot. Do NOT call this repeatedly to check if a subagent has finished — results are delivered automatically as steering messages.",
		parameters: Type.Object({}),
		promptSnippet: "List subagent definitions and active subagents",
		promptGuidelines: [
			"crew_list: List available subagents and active subagents owned by this session.",
			"crew_list: Use before crew_spawn to discover names, descriptions, and interactive status.",
			"crew_list: Use only for discovery or a requested status snapshot; do not poll for completion.",
		],
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const toolCtx = getToolContext(ctx);
			const { agents, warnings } = discoverAgents(toolCtx.cwd);
			const running = crew.getActiveSummariesForOwner(toolCtx.callerSessionId);
			const lines = [
				"## Available Subagents",
				...formatAvailableAgents(agents),
				...formatWarnings(warnings),
				"",
				"## Active Subagents",
				...formatActiveAgents(running),
			];
			notifyDiscoveryWarnings(ctx, shownDiscoveryWarnings, warnings);
			if (running.length > 0) showActiveListWarning(pi, ctx);
			return { content: [{ type: "text", text: lines.join("\n") }], details: {} };
		},
		renderCall(_args, theme, _context) {
			return new Text(theme.fg("toolTitle", theme.bold("crew_list")), 0, 0);
		},
		renderResult(result, _options, _theme, _context) {
			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
		},
	});

	registerActionTool<{ subagent: string; task: string }>(pi, {
		name: "crew_spawn",
		label: "Spawn Crew",
		description:
			"Spawn a non-blocking subagent that runs in an isolated session. The subagent works independently while your session stays interactive. Results are delivered back to your session as steering messages.",
		parameters: Type.Object({
			subagent: Type.String({ description: "Subagent name from crew_list" }),
			task: Type.String({ description: "Task to delegate to the subagent" }),
		}),
		promptSnippet: "Spawn a non-blocking subagent. Use crew_list first to see available subagents.",
		promptGuidelines: [
			"crew_spawn: Spawn a discovered subagent for one clearly delegated, self-contained task.",
			"crew_spawn: Include only needed context: constraints, relevant files, acceptance criteria, and expected output.",
			"crew_spawn: After spawning, ownership transfers to the subagent; do not work on that task yourself.",
			"crew_spawn: Results arrive as steering messages; do not poll crew_list or fabricate results.",
			"crew_spawn: Use the bundled pi-crew skill for detailed delegation patterns.",
		],
		action: (params, ctx) => {
			const toolCtx = getToolContext(ctx);
			const { agents, warnings } = discoverAgents(toolCtx.cwd);
			notifyDiscoveryWarnings(ctx, shownDiscoveryWarnings, warnings);
			const subagent = agents.find((candidate) => candidate.name === params.subagent);
			if (!subagent) {
				const available = agents.map((candidate) => candidate.name).join(", ") || "none";
				return toolError(`Unknown subagent: "${params.subagent}". Available: ${available}`);
			}

			const id = crew.spawn(
				subagent,
				params.task,
				toolCtx.cwd,
				toolCtx.callerSessionId,
				{
					model: ctx.model,
					modelRegistry: ctx.modelRegistry,
					agentDir: getAgentDir(),
					parentSessionFile: ctx.sessionManager.getSessionFile(),
					onWarning: (msg) => ctx.ui.notify(msg, "warning"),
				},
				extensionDir,
			);
			return toolSuccess(
				`Subagent '${subagent.name}' spawned as ${id}. Result will be delivered as a steering message when done.`,
				{ id, agentName: subagent.name, task: params.task },
			);
		},
		renderCall(args, theme, _context) {
			return renderCrewCall(theme, "crew_spawn", args.subagent || "...", args.task);
		},
	});

	registerActionTool<{ subagent_id?: string; subagent_ids?: string[]; all?: boolean }>(pi, {
		name: "crew_abort",
		label: "Abort Crew",
		description: "Abort one, many, or all active subagents owned by the current session.",
		parameters: Type.Object({
			subagent_id: Type.Optional(Type.String({ description: "Single subagent ID to abort" })),
			subagent_ids: Type.Optional(Type.Array(Type.String(), { minItems: 1, description: "Multiple subagent IDs to abort" })),
			all: Type.Optional(Type.Boolean({ description: "Abort all active subagents owned by the current session" })),
		}),
		promptSnippet: "Abort one, many, or all active subagents from this session.",
		promptGuidelines: [
			"crew_abort: Abort one, many, or all active subagents owned by this session.",
			"crew_abort: Provide exactly one mode: subagent_id, subagent_ids, or all=true.",
			"crew_abort: Use only when delegated work is obsolete, wrong, or explicitly cancelled.",
		],
		action: (params, ctx) => {
			const { callerSessionId } = getToolContext(ctx);
			const modeCount = Number(Boolean(params.subagent_id)) + Number(Boolean(params.subagent_ids?.length)) + Number(params.all === true);
			if (modeCount !== 1) return toolError("Provide exactly one of: subagent_id, subagent_ids, or all=true.");

			if (params.all) {
				const abortedIds = crew.abortAllOwned(callerSessionId, { reason: "Aborted by tool request" });
				if (abortedIds.length === 0) return toolError("No active subagents in the current session.");
				return toolSuccess(`Aborted ${abortedIds.length} subagent(s): ${abortedIds.join(", ")}`, { ids: abortedIds }, { terminate: true });
			}

			const ids = params.subagent_id ? [params.subagent_id] : (params.subagent_ids ?? []);
			const result = crew.abortOwned(ids, callerSessionId, { reason: "Aborted by tool request" });
			const message = formatAbortToolMessage(result);
			if (result.abortedIds.length === 0) return toolError(message || "No subagents were aborted.");
			return toolSuccess(
				message,
				{ ids: result.abortedIds, missing_ids: result.missingIds, foreign_ids: result.foreignIds },
				{ terminate: true },
			);
		},
		renderCall(args, theme, _context) {
			if (args.all) return renderCrewCall(theme, "crew_abort", "all");
			if (args.subagent_id) return renderCrewCall(theme, "crew_abort", args.subagent_id);
			const count = Array.isArray(args.subagent_ids) ? args.subagent_ids.length : 0;
			return renderCrewCall(theme, "crew_abort", `${count} ids`);
		},
	});

	registerActionTool<{ subagent_id: string; message: string }>(pi, {
		name: "crew_respond",
		label: "Respond to Crew",
		description: "Send a follow-up message to an interactive subagent that is waiting for a response.",
		parameters: Type.Object({
			subagent_id: Type.String({ description: "ID of the waiting subagent (from crew_list or crew_spawn result)" }),
			message: Type.String({ description: "Message to send to the subagent" }),
		}),
		promptSnippet: "Send a follow-up message to a waiting interactive subagent.",
		promptGuidelines: [
			"crew_respond: Send a complete follow-up message to a waiting interactive subagent.",
			"crew_respond: Use the waiting subagent ID from crew_spawn results or crew_list.",
			"crew_respond: The response arrives as a steering message; do not poll crew_list.",
		],
		action: (params, ctx) => {
			const { callerSessionId } = getToolContext(ctx);
			const { error } = crew.respond(params.subagent_id, params.message, callerSessionId);
			if (error) return toolError(error);
			return toolSuccess(
				`Message sent to subagent ${params.subagent_id}. Response will be delivered as a steering message.`,
				{ id: params.subagent_id, message: params.message },
			);
		},
		renderCall(args, theme, _context) {
			return renderCrewCall(theme, "crew_respond", args.subagent_id || "...", args.message);
		},
	});

	registerActionTool<{ subagent_id: string }>(pi, {
		name: "crew_done",
		label: "Done with Crew",
		description: "Close an interactive subagent session. Use when you no longer need to interact with the subagent.",
		parameters: Type.Object({
			subagent_id: Type.String({ description: "ID of the subagent to close" }),
		}),
		promptSnippet: "Close an interactive subagent session when done.",
		promptGuidelines: [
			"crew_done: Close a waiting interactive subagent owned by this session.",
			"crew_done: Use only when no further follow-up is needed; otherwise use crew_respond.",
		],
		action: (params, ctx) => {
			const { callerSessionId } = getToolContext(ctx);
			const { error } = crew.done(params.subagent_id, callerSessionId);
			if (error) return toolError(error);
			return toolSuccess(`Subagent ${params.subagent_id} closed.`, { id: params.subagent_id });
		},
		renderCall(args, theme, _context) {
			return renderCrewCall(theme, "crew_done", args.subagent_id || "...");
		},
	});
}
