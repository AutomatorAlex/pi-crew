import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AgentDiscoveryWarning } from "../agent-discovery.js";
import { sendCrewListActiveWarning } from "../subagent-messages.js";
import { renderCrewResult } from "./tool-presentation.js";
import type {
	CrewToolActionContext,
	CrewToolActionResponse,
	CrewToolActionSideEffect,
	CrewToolActions,
	CrewToolResult,
} from "./crew-tool-actions.js";

interface CrewToolExecutorDeps {
	pi: ExtensionAPI;
	notifyDiscoveryWarnings: (
		ctx: ExtensionContext,
		warnings: AgentDiscoveryWarning[],
	) => void;
}

export interface CrewToolDeps {
	pi: ExtensionAPI;
	actions: CrewToolActions;
	executor: CrewToolExecutor;
}

function getBaseActionContext(ctx: ExtensionContext): CrewToolActionContext {
	return {
		cwd: ctx.cwd,
		callerSessionId: ctx.sessionManager.getSessionId(),
	};
}

function runSideEffects(
	deps: CrewToolExecutorDeps,
	ctx: ExtensionContext,
	sideEffects: CrewToolActionSideEffect[],
): void {
	for (const sideEffect of sideEffects) {
		switch (sideEffect.type) {
			case "discovery-warnings":
				deps.notifyDiscoveryWarnings(ctx, sideEffect.warnings);
				break;
			case "active-list-warning":
				Promise.resolve().then(() => {
					sendCrewListActiveWarning(deps.pi.sendMessage.bind(deps.pi), {
						isIdle: ctx.isIdle(),
						triggerTurn: true,
					});
				});
				break;
		}
	}
}

export class CrewToolExecutor {
	constructor(private readonly deps: CrewToolExecutorDeps) {}

	execute(
		ctx: ExtensionContext,
		runAction: (actionCtx: CrewToolActionContext) => CrewToolActionResponse,
	): CrewToolResult {
		const response = runAction(getBaseActionContext(ctx));
		runSideEffects(this.deps, ctx, response.sideEffects);
		return response.result;
	}
}

type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];
type ToolRenderCall = Exclude<RegisteredTool["renderCall"], undefined>;

export function registerCrewActionTool<Params extends object>(
	{ pi, executor }: CrewToolDeps,
	options: Omit<RegisteredTool, "execute" | "renderResult" | "renderCall"> & {
		action: (
			params: Params,
			actionCtx: CrewToolActionContext,
			ctx: ExtensionContext,
		) => CrewToolActionResponse;
		renderCall?: (
			args: Partial<Params>,
			theme: Parameters<ToolRenderCall>[1],
			context: Parameters<ToolRenderCall>[2],
		) => ReturnType<ToolRenderCall>;
	},
): void {
	const { action, renderCall, ...tool } = options;

	pi.registerTool({
		...tool,
		...(renderCall
			? {
				renderCall: (args, theme, context) =>
					renderCall(args as Partial<Params>, theme, context),
			}
			: {}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return executor.execute(ctx, (actionCtx) =>
				action(params as Params, actionCtx, ctx),
			);
		},
		renderResult(result, _options, theme, _context) {
			return renderCrewResult(result, theme);
		},
	});
}
