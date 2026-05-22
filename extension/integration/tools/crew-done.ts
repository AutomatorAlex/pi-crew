import { Type } from "typebox";
import {
	renderCrewCall,
	renderCrewResult,
} from "../tool-presentation.js";
import type { CrewToolDeps } from "../crew-tool-executor.js";

export function registerCrewDoneTool({ pi, actions, executor }: CrewToolDeps): void {
	pi.registerTool({
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

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return executor.execute(ctx, (actionCtx) =>
				actions.done(params, actionCtx),
			);
		},

		renderCall(args, theme, _context) {
			return renderCrewCall(theme, "crew_done", args.subagent_id || "...");
		},

		renderResult(result, _options, theme, _context) {
			return renderCrewResult(result, theme);
		},
	});
}
