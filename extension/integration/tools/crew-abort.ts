import { Type } from "typebox";
import {
	renderCrewCall,
	renderCrewResult,
} from "../tool-presentation.js";
import type { CrewToolDeps } from "./tool-deps.js";

export function registerCrewAbortTool({ pi, actions }: CrewToolDeps): void {
	pi.registerTool({
		name: "crew_abort",
		label: "Abort Crew",
		description:
			"Abort one, many, or all active subagents owned by the current session.",
		parameters: Type.Object({
			subagent_id: Type.Optional(
				Type.String({ description: "Single subagent ID to abort" }),
			),
			subagent_ids: Type.Optional(
				Type.Array(Type.String(), {
					minItems: 1,
					description: "Multiple subagent IDs to abort",
				}),
			),
			all: Type.Optional(
				Type.Boolean({
					description: "Abort all active subagents owned by the current session",
				}),
			),
		}),
		promptSnippet: "Abort one, many, or all active subagents from this session.",
		promptGuidelines: [
			"crew_abort: Abort one, many, or all active subagents owned by this session.",
			"crew_abort: Provide exactly one mode: subagent_id, subagent_ids, or all=true.",
			"crew_abort: Use only when delegated work is obsolete, wrong, or explicitly cancelled.",
		],

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return actions.abort(params, {
				cwd: ctx.cwd,
				callerSessionId: ctx.sessionManager.getSessionId(),
			}).result;
		},

		renderCall(args, theme, _context) {
			if (args.all) {
				return renderCrewCall(theme, "crew_abort", "all");
			}

			if (args.subagent_id) {
				return renderCrewCall(theme, "crew_abort", args.subagent_id);
			}

			const count = Array.isArray(args.subagent_ids) ? args.subagent_ids.length : 0;
			return renderCrewCall(theme, "crew_abort", `${count} ids`);
		},

		renderResult(result, _options, theme, _context) {
			return renderCrewResult(result, theme);
		},
	});
}
