import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { BootstrapContext } from "../bootstrap-session.js";
import { bootstrapSession } from "../bootstrap-session.js";
import type { SubagentStatus } from "../subagent-messages.js";
import { runPromptWithOverflowRecovery } from "./overflow-recovery.js";
import type { SubagentState } from "./subagent-state.js";
import { isAborted } from "./subagent-transitions.js";

interface PromptOutcome {
	status: Extract<SubagentStatus, "done" | "waiting" | "error" | "aborted">;
	result?: string;
	error?: string;
}

interface StartOptions {
	cwd: string;
	ctx: BootstrapContext;
	extensionResolvedPath: string;
	onWarning?: (message: string) => void;
}

interface SubagentLifecycleCallbacks {
	isCurrent: (state: SubagentState) => boolean;
	onProgress: (ownerSessionId: string) => void;
	onSettled: (
		state: SubagentState,
		status: Extract<SubagentStatus, "done" | "waiting" | "error" | "aborted">,
		outcome: { result?: string; error?: string },
	) => void;
}

function getLastAssistantMessage(
	messages: AgentMessage[],
): AssistantMessage | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			return msg as AssistantMessage;
		}
	}
	return undefined;
}

function getAssistantText(
	message: AssistantMessage | undefined,
): string | undefined {
	if (!message) return undefined;

	const texts: string[] = [];
	for (const part of message.content) {
		if (part.type === "text") {
			texts.push(part.text);
		}
	}

	return texts.length > 0 ? texts.join("\n") : undefined;
}

function getPromptOutcome(state: SubagentState): PromptOutcome {
	const lastAssistant = getLastAssistantMessage(state.session!.messages);
	const text = getAssistantText(lastAssistant);

	if (lastAssistant?.stopReason === "error") {
		return {
			status: "error",
			error: lastAssistant.errorMessage ?? text ?? "(no output)",
		};
	}

	if (lastAssistant?.stopReason === "aborted") {
		return {
			status: "aborted",
			error: lastAssistant.errorMessage ?? text ?? "(no output)",
		};
	}

	return {
		status: state.agentConfig.interactive ? "waiting" : "done",
		result: text ?? "(no output)",
	};
}

export class SubagentLifecycle {
	constructor(private readonly callbacks: SubagentLifecycleCallbacks) {}

	start(state: SubagentState, opts: StartOptions): void {
		void this.spawnSession(state, opts);
	}

	respond(state: SubagentState, message: string): void {
		void this.runPromptCycle(state, message);
	}

	abortPrompt(state: SubagentState): void {
		state.promptAbortController?.abort();
		state.promptAbortController = undefined;
		state.session?.abortCompaction();
		state.session?.abortRetry();
		state.session?.abort().catch(() => {});
	}

	private attachSessionListeners(
		state: SubagentState,
		session: AgentSession,
	): void {
		state.unsubscribe = session.subscribe((event) => {
			if (event.type !== "turn_end") return;

			state.turns++;
			const msg = event.message;
			if (msg.role === "assistant") {
				const assistantMsg = msg as AssistantMessage;
				state.contextTokens = assistantMsg.usage.totalTokens;
				state.model = assistantMsg.model;
			}
			this.callbacks.onProgress(state.ownerSessionId);
		});
	}

	private attachSpawnedSession(
		state: SubagentState,
		session: AgentSession,
	): boolean {
		if (!this.callbacks.isCurrent(state)) {
			session.dispose();
			return false;
		}

		state.session = session;
		return true;
	}

	private async runPromptCycle(
		state: SubagentState,
		prompt: string,
	): Promise<void> {
		if (isAborted(state)) return;

		const abortController = new AbortController();
		state.promptAbortController = abortController;

		try {
			const recovery = await runPromptWithOverflowRecovery(
				state.session!,
				prompt,
				abortController.signal,
			);
			if (isAborted(state)) return;

			const outcome = getPromptOutcome(state);

			if (recovery === "failed" && outcome.status !== "error") {
				this.callbacks.onSettled(state, "error", {
					error: "Context overflow recovery failed",
				});
				return;
			}

			this.callbacks.onSettled(state, outcome.status, outcome);
		} catch (err) {
			if (isAborted(state)) return;

			const error = err instanceof Error ? err.message : String(err);
			this.callbacks.onSettled(state, "error", { error });
		} finally {
			state.promptAbortController = undefined;
		}
	}

	private async spawnSession(
		state: SubagentState,
		opts: StartOptions,
	): Promise<void> {
		try {
			if (isAborted(state)) return;

			const { session, warnings } = await bootstrapSession({
				agentConfig: state.agentConfig,
				cwd: opts.cwd,
				ctx: opts.ctx,
				extensionResolvedPath: opts.extensionResolvedPath,
			});

			for (const warning of warnings) {
				opts.onWarning?.(warning);
			}

			if (!this.attachSpawnedSession(state, session)) return;

			this.attachSessionListeners(state, session);
			await this.runPromptCycle(state, state.task);
		} catch (err) {
			if (isAborted(state)) return;

			if (state.status === "running") {
				const error = err instanceof Error ? err.message : String(err);
				this.callbacks.onSettled(state, "error", { error });
			}
		}
	}
}
