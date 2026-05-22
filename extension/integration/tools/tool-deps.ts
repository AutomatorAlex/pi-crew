import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AgentDiscoveryWarning } from "../../agent-discovery.js";
import type { CrewToolActions, CrewToolActionSideEffect } from "../crew-tool-actions.js";
import { sendCrewListActiveWarning } from "../../subagent-messages.js";

export interface CrewToolDeps {
	pi: ExtensionAPI;
	actions: CrewToolActions;
	notifyDiscoveryWarnings: (
		ctx: ExtensionContext,
		warnings: AgentDiscoveryWarning[],
	) => void;
}

export function runToolActionSideEffects(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	notifyDiscoveryWarnings: CrewToolDeps["notifyDiscoveryWarnings"],
	sideEffects: CrewToolActionSideEffect[],
): void {
	for (const sideEffect of sideEffects) {
		switch (sideEffect.type) {
			case "discovery-warnings":
				notifyDiscoveryWarnings(ctx, sideEffect.warnings);
				break;
			case "active-list-warning":
				Promise.resolve().then(() => {
					sendCrewListActiveWarning(pi.sendMessage.bind(pi), {
						isIdle: ctx.isIdle(),
						triggerTurn: true,
					});
				});
				break;
		}
	}
}
