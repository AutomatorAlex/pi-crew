import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import {
	type AgentConfigFields,
	parseDefinitionFields,
	parseOverrideFields as parseConfigOverrideFields,
} from "./agent-config-fields.js";

export interface AgentConfig extends AgentConfigFields {
	name: string;
	description: string;
	systemPrompt: string;
	filePath: string;
}

type AgentConfigOverride = AgentConfigFields;

export interface AgentDiscoveryWarning {
	filePath: string;
	message: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	warnings: AgentDiscoveryWarning[];
}

interface ParseResult {
	agent: AgentConfig | null;
	warnings: AgentDiscoveryWarning[];
}

export interface AgentDefinitionFile {
	filePath: string;
	content: string | null;
	warnings?: AgentDiscoveryWarning[];
}

export interface AgentDefinitionSourceGroup {
	agentsDir: string;
	files: AgentDefinitionFile[];
	warnings?: AgentDiscoveryWarning[];
}

export interface AgentConfigFile {
	filePath: string;
	content: string | null;
	warnings?: AgentDiscoveryWarning[];
}

export interface AgentCatalogSource {
	loadAgentDefinitionGroups(cwd: string): AgentDefinitionSourceGroup[];
	loadConfigFiles(cwd: string): AgentConfigFile[];
}

interface ConfigParseResult {
	overrides: Record<string, AgentConfigOverride>;
	overrideSources: Record<string, string>;
	warnings: AgentDiscoveryWarning[];
}

function createDiscoveryWarning(filePath: string, message: string): AgentDiscoveryWarning {
	return { filePath, message };
}

function parseAgentDefinition(content: string, filePath: string): ParseResult {
	const warnings: AgentDiscoveryWarning[] = [];

	let frontmatter: Record<string, unknown>;
	let body: string;
	try {
		const parsed = parseFrontmatter<Record<string, unknown>>(content);
		frontmatter = parsed.frontmatter;
		body = parsed.body;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			agent: null,
			warnings: [
				createDiscoveryWarning(
					filePath,
					`Ignored invalid subagent definition. Frontmatter could not be parsed: ${reason}`,
				),
			],
		};
	}

	const name = typeof frontmatter.name === "string" ? frontmatter.name.trim() : undefined;
	const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : undefined;

	if (!name || !description) {
		return {
			agent: null,
			warnings: [
				createDiscoveryWarning(
					filePath,
					'Ignored invalid subagent definition. Required frontmatter fields "name" and "description" must be non-empty strings.',
				),
			],
		};
	}

	if (/\s/.test(name)) {
		return {
			agent: null,
			warnings: [
				createDiscoveryWarning(
					filePath,
					`Ignored subagent definition "${name}". Subagent names cannot contain whitespace. Use "-" instead.`,
				),
			],
		};
	}

	const parsedFields = parseDefinitionFields(frontmatter, filePath, name);
	warnings.push(...parsedFields.warnings);

	return {
		agent: {
			name,
			description,
			...parsedFields.fields,
			systemPrompt: body,
			filePath,
		},
		warnings,
	};
}

function parseAgentOverride(
	agentName: string,
	value: unknown,
	filePath: string,
): { override: AgentConfigOverride | null; warnings: AgentDiscoveryWarning[] } {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {
			override: null,
			warnings: [
				createDiscoveryWarning(
					filePath,
					`Subagent override "${agentName}" must be a JSON object, ignoring`,
				),
			],
		};
	}

	const parsedFields = parseConfigOverrideFields(value as Record<string, unknown>, filePath, agentName);
	return { override: parsedFields.fields, warnings: parsedFields.warnings };
}

function parseConfigFile(content: string, filePath: string): ConfigParseResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			overrides: {},
			overrideSources: {},
			warnings: [
				createDiscoveryWarning(
					filePath,
					`Ignored pi-crew config. JSON could not be parsed: ${reason}`,
				),
			],
		};
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return {
			overrides: {},
			overrideSources: {},
			warnings: [
				createDiscoveryWarning(
					filePath,
					"Ignored pi-crew config. Root value must be a JSON object.",
				),
			],
		};
	}

	const root = parsed as Record<string, unknown>;
	if (root.agents === undefined) {
		return { overrides: {}, overrideSources: {}, warnings: [] };
	}

	if (!root.agents || typeof root.agents !== "object" || Array.isArray(root.agents)) {
		return {
			overrides: {},
			overrideSources: {},
			warnings: [
				createDiscoveryWarning(
					filePath,
					'Ignored pi-crew config. Field "agents" must be a JSON object.',
				),
			],
		};
	}

	const overrides: Record<string, AgentConfigOverride> = {};
	const overrideSources: Record<string, string> = {};
	const warnings: AgentDiscoveryWarning[] = [];

	for (const [agentName, value] of Object.entries(root.agents)) {
		if (!agentName.trim()) {
			warnings.push(
				createDiscoveryWarning(
					filePath,
					"Ignored pi-crew config entry with empty subagent name.",
				),
			);
			continue;
		}

		const parsedOverride = parseAgentOverride(agentName, value, filePath);
		warnings.push(...parsedOverride.warnings);
		if (parsedOverride.override) {
			overrides[agentName] = parsedOverride.override;
			overrideSources[agentName] = filePath;
		}
	}

	return { overrides, overrideSources, warnings };
}

function mergeConfigOverrides(
	base: Record<string, AgentConfigOverride>,
	override: Record<string, AgentConfigOverride>,
): Record<string, AgentConfigOverride> {
	const merged: Record<string, AgentConfigOverride> = { ...base };

	for (const [agentName, agentOverride] of Object.entries(override)) {
		merged[agentName] = {
			...(merged[agentName] ?? {}),
			...agentOverride,
		};
	}

	return merged;
}

function mergeOverrideSources(
	base: Record<string, string>,
	override: Record<string, string>,
): Record<string, string> {
	return {
		...base,
		...override,
	};
}

function applyAgentOverride(agent: AgentConfig, override: AgentConfigOverride): AgentConfig {
	return {
		...agent,
		...(override.model !== undefined ? { model: override.model, parsedModel: override.parsedModel } : {}),
		...(override.thinking !== undefined ? { thinking: override.thinking } : {}),
		...(override.tools !== undefined ? { tools: override.tools } : {}),
		...(override.skills !== undefined ? { skills: override.skills } : {}),
		...(override.compaction !== undefined ? { compaction: override.compaction } : {}),
		...(override.interactive !== undefined ? { interactive: override.interactive } : {}),
	};
}

function loadAgentDefinitionFromFile(file: AgentDefinitionFile): ParseResult {
	if (!file.content) {
		return { agent: null, warnings: file.warnings ?? [] };
	}

	const parsed = parseAgentDefinition(file.content, file.filePath);
	return {
		agent: parsed.agent,
		warnings: [...(file.warnings ?? []), ...parsed.warnings],
	};
}

function mergeConfigFiles(configFiles: AgentConfigFile[]): ConfigParseResult {
	let overrides: Record<string, AgentConfigOverride> = {};
	let overrideSources: Record<string, string> = {};
	const warnings: AgentDiscoveryWarning[] = [];

	for (const configFile of configFiles) {
		warnings.push(...(configFile.warnings ?? []));
		if (!configFile.content) continue;

		const parsed = parseConfigFile(configFile.content, configFile.filePath);
		overrides = mergeConfigOverrides(overrides, parsed.overrides);
		overrideSources = mergeOverrideSources(overrideSources, parsed.overrideSources);
		warnings.push(...parsed.warnings);
	}

	return { overrides, overrideSources, warnings };
}

export class AgentCatalog {
	constructor(private readonly source: AgentCatalogSource) {}

	discover(cwd: string = process.cwd()): AgentDiscoveryResult {
		const agents: AgentConfig[] = [];
		const warnings: AgentDiscoveryWarning[] = [];
		const seenNames = new Map<string, string>();

		for (const group of this.source.loadAgentDefinitionGroups(cwd)) {
			this.loadAgentsFromGroup(group, seenNames, agents, warnings);
		}

		const configOverrides = mergeConfigFiles(this.source.loadConfigFiles(cwd));
		warnings.push(...configOverrides.warnings);

		const finalAgents = agents.map((agent) => {
			const override = configOverrides.overrides[agent.name];
			return override ? applyAgentOverride(agent, override) : agent;
		});

		for (const agentName of Object.keys(configOverrides.overrides)) {
			if (!seenNames.has(agentName)) {
				warnings.push(
					createDiscoveryWarning(
						configOverrides.overrideSources[agentName] ?? "pi-crew.json",
						`Subagent override "${agentName}" does not match any discovered subagent, ignoring`,
					),
				);
			}
		}

		return { agents: finalAgents, warnings };
	}

	/**
	 * Loads agents from a single source group into the agents list.
	 * Skips agents whose name already exists in seenNames (higher-priority source wins).
	 * Within the same source group, duplicate names produce a warning.
	 */
	private loadAgentsFromGroup(
		group: AgentDefinitionSourceGroup,
		seenNames: Map<string, string>,
		agents: AgentConfig[],
		warnings: AgentDiscoveryWarning[],
	): void {
		warnings.push(...(group.warnings ?? []));

		const groupNames = new Set<string>();

		for (const file of group.files) {
			const loaded = loadAgentDefinitionFromFile(file);
			warnings.push(...loaded.warnings);
			if (!loaded.agent) continue;

			const { name } = loaded.agent;

			// Duplicate within the same source group
			if (groupNames.has(name)) {
				warnings.push(
					createDiscoveryWarning(
						file.filePath,
						`Duplicate subagent name "${name}" in ${group.agentsDir}, skipping`,
					),
				);
				continue;
			}

			groupNames.add(name);

			// Higher-priority source already registered this name
			if (seenNames.has(name)) continue;

			seenNames.set(name, file.filePath);
			agents.push(loaded.agent);
		}
	}
}
