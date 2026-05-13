import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { discoverAgents } from "../../agent-discovery.js";
import {
	renderCrewCall,
	renderCrewResult,
	toolError,
	toolSuccess,
} from "../tool-presentation.js";
import type { CrewToolDeps } from "./tool-deps.js";

export function registerCrewSpawnTool({
	pi,
	crew,
	extensionDir,
	notifyDiscoveryWarnings,
}: CrewToolDeps): void {
	pi.registerTool({
		name: "crew_spawn",
		label: "Spawn Crew",
		description:
			"Spawn a non-blocking subagent that runs in an isolated session. The subagent works independently while your session stays interactive. Results are delivered back to your session as steering messages.",
		parameters: Type.Object({
			subagent: Type.String({ description: "Subagent name from crew_list" }),
			task: Type.String({ description: "Task to delegate to the subagent" }),
		}),
		promptSnippet:
			"Spawn a non-blocking subagent. Use crew_list first to see available subagents.",
		promptGuidelines: [
			"crew_spawn: Spawn a discovered subagent for one clearly delegated, self-contained task.",
			"crew_spawn: Include only needed context: constraints, relevant files, acceptance criteria, and expected output.",
			"crew_spawn: After spawning, ownership transfers to the subagent; do not work on that task yourself.",
			"crew_spawn: Results arrive as steering messages; do not poll crew_list or fabricate results.",
			"crew_spawn: Use the bundled pi-crew skill for detailed delegation patterns.",
		],

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { agents, warnings } = discoverAgents(ctx.cwd);
			notifyDiscoveryWarnings(ctx, warnings);
			const subagent = agents.find(
				(candidate) => candidate.name === params.subagent,
			);

			if (!subagent) {
				const available =
					agents.map((candidate) => candidate.name).join(", ") || "none";
				return toolError(
					`Unknown subagent: "${params.subagent}". Available: ${available}`,
				);
			}

			const ownerSessionId = ctx.sessionManager.getSessionId();
			const id = crew.spawn(
				subagent,
				params.task,
				ctx.cwd,
				ownerSessionId,
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
			return renderCrewCall(
				theme,
				"crew_spawn",
				args.subagent || "...",
				args.task,
			);
		},

		renderResult(result, _options, theme, _context) {
			return renderCrewResult(result, theme);
		},
	});
}
