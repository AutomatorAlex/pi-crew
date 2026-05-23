import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	type ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "./catalog.js";
import { SUPPORTED_TOOL_NAMES, type SupportedToolName } from "./catalog.js";
import type { SubagentState } from "./crew.js";
import type { SubagentStatus } from "./ui.js";
import { runPromptWithOverflowRecovery } from "./overflow-recovery.js";

export interface BootstrapContext {
	model: Model<Api> | undefined;
	modelRegistry: ModelRegistry;
	agentDir: string;
	parentSessionFile?: string;
}

interface BootstrapOptions {
	agentConfig: AgentConfig;
	cwd: string;
	ctx: BootstrapContext;
	extensionResolvedPath: string;
}

interface BootstrapResult {
	session: AgentSession;
	warnings: string[];
}

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

export interface SubagentRunnerCallbacks {
	isCurrent: (state: SubagentState) => boolean;
	onProgress: (ownerSessionId: string) => void;
	onSettled: (
		state: SubagentState,
		status: Extract<SubagentStatus, "done" | "waiting" | "error" | "aborted">,
		outcome: { result?: string; error?: string },
	) => void;
}

export interface SubagentRunner {
	start(state: SubagentState, opts: StartOptions): void;
	respond(state: SubagentState, message: string): void;
	abort(state: SubagentState): void;
}

function resolveTools(agentConfig: AgentConfig): SupportedToolName[] {
	return [...(agentConfig.tools ?? SUPPORTED_TOOL_NAMES)];
}

function resolveModel(agentConfig: AgentConfig, ctx: BootstrapContext): { model: Model<Api> | undefined; warnings: string[] } {
	const warnings: string[] = [];
	const model = ctx.model;
	if (!agentConfig.parsedModel) return { model, warnings };

	const found = ctx.modelRegistry.find(agentConfig.parsedModel.provider, agentConfig.parsedModel.modelId);
	if (found) return { model: found, warnings };

	warnings.push(`Model "${agentConfig.model}" not found, using current session model`);
	return { model, warnings };
}

function getSkillWarnings(agentConfig: AgentConfig, resourceLoader: DefaultResourceLoader): string[] {
	const warnings: string[] = [];
	if (!agentConfig.skills) return warnings;

	const availableSkillNames = new Set(resourceLoader.getSkills().skills.map((skill) => skill.name));
	for (const skillName of agentConfig.skills) {
		if (!availableSkillNames.has(skillName)) {
			warnings.push(`Unknown skill "${skillName}" in subagent config, skipping`);
		}
	}
	return warnings;
}

async function bootstrapSession(opts: BootstrapOptions): Promise<BootstrapResult> {
	const warnings: string[] = [];
	const { agentConfig, cwd, ctx, extensionResolvedPath } = opts;

	const authStorage = ctx.modelRegistry.authStorage;
	const modelRegistry = ctx.modelRegistry;
	const { model, warnings: modelWarnings } = resolveModel(agentConfig, ctx);
	warnings.push(...modelWarnings);
	const tools = resolveTools(agentConfig);

	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir: ctx.agentDir,
		extensionsOverride: (base) => ({
			...base,
			extensions: base.extensions.filter((ext) => !ext.resolvedPath.startsWith(extensionResolvedPath)),
		}),
		skillsOverride: agentConfig.skills
			? (base) => ({
				skills: base.skills.filter((skill) => agentConfig.skills!.includes(skill.name)),
				diagnostics: base.diagnostics,
			})
			: undefined,
		appendSystemPromptOverride: (base) => agentConfig.systemPrompt.trim() ? [...base, agentConfig.systemPrompt] : base,
	});
	await resourceLoader.reload();
	warnings.push(...getSkillWarnings(agentConfig, resourceLoader));

	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: agentConfig.compaction ?? true },
	});

	const sessionManager = SessionManager.create(cwd);
	sessionManager.newSession({ parentSession: ctx.parentSessionFile });

	const result = await createAgentSession({
		cwd,
		agentDir: ctx.agentDir,
		model,
		thinkingLevel: agentConfig.thinking,
		tools,
		resourceLoader,
		sessionManager,
		settingsManager,
		authStorage,
		modelRegistry,
	});

	return { session: result.session, warnings };
}

function getLastAssistantMessage(messages: AgentMessage[]): AssistantMessage | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") return msg as AssistantMessage;
	}
	return undefined;
}

function getAssistantText(message: AssistantMessage | undefined): string | undefined {
	if (!message) return undefined;
	const texts: string[] = [];
	for (const part of message.content) {
		if (part.type === "text") texts.push(part.text);
	}
	return texts.length > 0 ? texts.join("\n") : undefined;
}

function getPromptOutcome(state: SubagentState): PromptOutcome {
	const lastAssistant = getLastAssistantMessage(state.session!.messages);
	const text = getAssistantText(lastAssistant);

	if (lastAssistant?.stopReason === "error") {
		return { status: "error", error: lastAssistant.errorMessage ?? text ?? "(no output)" };
	}
	if (lastAssistant?.stopReason === "aborted") {
		return { status: "aborted", error: lastAssistant.errorMessage ?? text ?? "(no output)" };
	}
	return { status: state.agentConfig.interactive ? "waiting" : "done", result: text ?? "(no output)" };
}

function isAborted(state: SubagentState): boolean {
	return state.status === "aborted";
}

export class SubagentSessionRunner implements SubagentRunner {
	constructor(private readonly callbacks: SubagentRunnerCallbacks) {}

	start(state: SubagentState, opts: StartOptions): void {
		void this.spawnSession(state, opts);
	}

	respond(state: SubagentState, message: string): void {
		void this.runPromptCycle(state, message);
	}

	abort(state: SubagentState): void {
		state.promptAbortController?.abort();
		state.promptAbortController = undefined;
		state.session?.abortCompaction();
		state.session?.abortRetry();
		state.session?.abort().catch(() => {});
	}

	private attachSessionListeners(state: SubagentState, session: AgentSession): void {
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

	private attachSpawnedSession(state: SubagentState, session: AgentSession): boolean {
		if (!this.callbacks.isCurrent(state)) {
			session.dispose();
			return false;
		}
		state.session = session;
		return true;
	}

	private async runPromptCycle(state: SubagentState, prompt: string): Promise<void> {
		if (isAborted(state)) return;

		const abortController = new AbortController();
		state.promptAbortController = abortController;

		try {
			const recovery = await runPromptWithOverflowRecovery(state.session!, prompt, abortController.signal);
			if (isAborted(state)) return;

			const outcome = getPromptOutcome(state);
			if (recovery === "failed" && outcome.status !== "error") {
				this.callbacks.onSettled(state, "error", { error: "Context overflow recovery failed" });
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

	private async spawnSession(state: SubagentState, opts: StartOptions): Promise<void> {
		try {
			if (isAborted(state)) return;

			const { session, warnings } = await bootstrapSession({
				agentConfig: state.agentConfig,
				cwd: opts.cwd,
				ctx: opts.ctx,
				extensionResolvedPath: opts.extensionResolvedPath,
			});

			for (const warning of warnings) opts.onWarning?.(warning);
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
