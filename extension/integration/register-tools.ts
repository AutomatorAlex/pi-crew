import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { discoverAgents, type AgentDiscoveryWarning } from "../agent-discovery.js";
import type { CrewRuntime } from "../runtime/crew-runtime.js";
import { createCrewToolActions } from "./crew-tool-actions.js";
import { registerCrewAbortTool } from "./tools/crew-abort.js";
import { registerCrewDoneTool } from "./tools/crew-done.js";
import { registerCrewListTool } from "./tools/crew-list.js";
import { registerCrewRespondTool } from "./tools/crew-respond.js";
import { registerCrewSpawnTool } from "./tools/crew-spawn.js";

export function registerCrewTools(
	pi: ExtensionAPI,
	crew: CrewRuntime,
	extensionDir: string,
): void {
	const shownDiscoveryWarnings = new Set<string>();

	const notifyDiscoveryWarnings = (
		ctx: ExtensionContext,
		warnings: AgentDiscoveryWarning[],
	) => {
		if (!ctx.hasUI) return;
		for (const warning of warnings) {
			const key = `${warning.filePath}:${warning.message}`;
			if (shownDiscoveryWarnings.has(key)) continue;
			shownDiscoveryWarnings.add(key);
			ctx.ui.notify(`${warning.message} (${warning.filePath})`, "error");
		}
	};

	const actions = createCrewToolActions({
		crew,
		discoverAgents,
		extensionDir,
	});
	const deps = { pi, actions, notifyDiscoveryWarnings };
	registerCrewListTool(deps);
	registerCrewSpawnTool(deps);
	registerCrewAbortTool(deps);
	registerCrewRespondTool(deps);
	registerCrewDoneTool(deps);
}
