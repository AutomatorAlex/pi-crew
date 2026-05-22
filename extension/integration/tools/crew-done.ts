import { Type } from "typebox";
import { renderCrewCall } from "../tool-presentation.js";
import {
	registerCrewActionTool,
	type CrewToolDeps,
} from "../crew-tool-executor.js";

export function registerCrewDoneTool(deps: CrewToolDeps): void {
	registerCrewActionTool<{ subagent_id: string }>(deps, {
		name: "crew_done",
		label: "Done with Crew",
		description:
			"Close an interactive subagent session. Use when you no longer need to interact with the subagent.",
		parameters: Type.Object({
			subagent_id: Type.String({ description: "ID of the subagent to close" }),
		}),
		promptSnippet: "Close an interactive subagent session when done.",
		promptGuidelines: [
			"crew_done: Close a waiting interactive subagent owned by this session.",
			"crew_done: Use only when no further follow-up is needed; otherwise use crew_respond.",
		],
		action: (params, actionCtx) => deps.actions.done(params, actionCtx),
		renderCall(args, theme, _context) {
			return renderCrewCall(theme, "crew_done", args.subagent_id || "...");
		},
	});
}
