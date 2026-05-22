import { Type } from "typebox";
import {
	renderCrewCall,
	renderCrewResult,
} from "../tool-presentation.js";
import type { CrewToolDeps } from "../crew-tool-executor.js";

export function registerCrewRespondTool({ pi, actions, executor }: CrewToolDeps): void {
	pi.registerTool({
		name: "crew_respond",
		label: "Respond to Crew",
		description:
			"Send a follow-up message to an interactive subagent that is waiting for a response.",
		parameters: Type.Object({
			subagent_id: Type.String({
				description:
					"ID of the waiting subagent (from crew_list or crew_spawn result)",
			}),
			message: Type.String({ description: "Message to send to the subagent" }),
		}),
		promptSnippet:
			"Send a follow-up message to a waiting interactive subagent.",
		promptGuidelines: [
			"crew_respond: Send a complete follow-up message to a waiting interactive subagent.",
			"crew_respond: Use the waiting subagent ID from crew_spawn results or crew_list.",
			"crew_respond: The response arrives as a steering message; do not poll crew_list.",
		],

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return executor.execute(ctx, (actionCtx) =>
				actions.respond(params, actionCtx),
			);
		},

		renderCall(args, theme, _context) {
			return renderCrewCall(
				theme,
				"crew_respond",
				args.subagent_id || "...",
				args.message,
			);
		},

		renderResult(result, _options, theme, _context) {
			return renderCrewResult(result, theme);
		},
	});
}