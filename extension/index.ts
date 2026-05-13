import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { crewRuntime } from "./runtime/crew-runtime.js";
import { registerCrewIntegration } from "./integration.js";
import { updateWidget } from "./status-widget.js";

const extensionDir = dirname(fileURLToPath(import.meta.url));

// Process-level cleanup for subagents on exit
const processHooksSetupKey = Symbol.for("pi-crew.processHooksSetup");
const globalWithProcessHooks = globalThis as typeof globalThis & Record<
	symbol,
	boolean | undefined
>;

function setupProcessHooks() {
	if (globalWithProcessHooks[processHooksSetupKey]) return;
	globalWithProcessHooks[processHooksSetupKey] = true;

	process.once('SIGINT', () => {
		crewRuntime.abortAll();
		process.exit(130);
	});
	process.on('beforeExit', () => crewRuntime.abortAll());
}

export default function (pi: ExtensionAPI) {
	let currentCtx: ExtensionContext | undefined;

	setupProcessHooks();

	const refreshWidget = () => {
		if (currentCtx) updateWidget(currentCtx, crewRuntime);
	};

	const activateSession = (ctx: ExtensionContext) => {
		currentCtx = ctx;
		crewRuntime.activateSession(
			{
				sessionId: ctx.sessionManager.getSessionId(),
				isIdle: () => ctx.isIdle(),
				sendMessage: pi.sendMessage.bind(pi),
			},
			refreshWidget,
		);
	};

	pi.on("session_start", (_event, ctx) => {
		activateSession(ctx);
	});

	pi.on("session_shutdown", (event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		crewRuntime.deactivateSession(sessionId);

		if (event.reason === "quit") {
			crewRuntime.abortAll();
		}
	});

	registerCrewIntegration(pi, crewRuntime, extensionDir);
}
