import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { runToolActionSideEffects, type CrewToolDeps } from "./tool-deps.js";

export function registerCrewListTool({
	pi,
	actions,
	notifyDiscoveryWarnings,
}: CrewToolDeps): void {
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
			const response = actions.list({
				cwd: ctx.cwd,
				callerSessionId: ctx.sessionManager.getSessionId(),
			});
			runToolActionSideEffects(
				pi,
				ctx,
				notifyDiscoveryWarnings,
				response.sideEffects,
			);
			return response.result;
		},

		renderCall(_args, theme, _context) {
			return new Text(theme.fg("toolTitle", theme.bold("crew_list")), 0, 0);
		},

		renderResult(result, _options, _theme, _context) {
			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
		},
	});
}