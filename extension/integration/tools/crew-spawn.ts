import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { renderCrewCall } from "../tool-presentation.js";
import {
	registerCrewActionTool,
	type CrewToolDeps,
} from "../crew-tool-executor.js";

export function registerCrewSpawnTool(deps: CrewToolDeps): void {
	registerCrewActionTool<{ subagent: string; task: string }>(deps, {
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
		action: (params, actionCtx, ctx) =>
			deps.actions.spawn(params, {
				...actionCtx,
				model: ctx.model,
				modelRegistry: ctx.modelRegistry,
				agentDir: getAgentDir(),
				parentSessionFile: ctx.sessionManager.getSessionFile(),
				onWarning: (msg) => ctx.ui.notify(msg, "warning"),
			}),
		renderCall(args, theme, _context) {
			return renderCrewCall(
				theme,
				"crew_spawn",
				args.subagent || "...",
				args.task,
			);
		},
	});
}
