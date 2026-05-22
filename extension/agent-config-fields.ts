import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { type SupportedToolName, isSupportedToolName } from "./tool-registry.js";

export interface ParsedModel {
	provider: string;
	modelId: string;
}

export interface AgentConfigFields {
	model?: string;
	parsedModel?: ParsedModel;
	thinking?: ThinkingLevel;
	tools?: SupportedToolName[];
	skills?: string[];
	compaction?: boolean;
	interactive?: boolean;
}

export interface AgentConfigFieldParseWarning {
	filePath: string;
	message: string;
}

export interface AgentConfigFieldParseResult {
	fields: AgentConfigFields;
	warnings: AgentConfigFieldParseWarning[];
}

const VALID_THINKING_LEVELS: readonly string[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
];

const ALLOWED_OVERRIDE_FIELDS = new Set([
	"model",
	"thinking",
	"tools",
	"skills",
	"compaction",
	"interactive",
]);

type ParsedFieldName = "model" | "thinking" | "tools" | "skills" | "compaction" | "interactive";
type ParsedListFieldName = "tools" | "skills";
type ParsedBooleanFieldName = "compaction" | "interactive";
type WarningSubject = "subagent" | "subagent override";

type ParsedFieldWarning =
	| {
			code: "invalid-list-format";
			fieldName: ParsedListFieldName;
		}
	| {
			code: "invalid-type";
			fieldName: ParsedFieldName;
			expected: "string" | "boolean";
		}
	| {
			code: "invalid-model-format";
			model: string;
		}
	| {
			code: "invalid-thinking-level";
			thinking: string;
		}
	| {
			code: "unknown-tools";
			tools: string[];
		};

interface ParseFieldOptions {
	warnOnInvalidType: boolean;
	setValueOnInvalidType: boolean;
}

interface ParsedFieldSet extends AgentConfigFields {
	warnings: ParsedFieldWarning[];
}

function createParseWarning(filePath: string, message: string): AgentConfigFieldParseWarning {
	return { filePath, message };
}

/**
 * Converts a comma-separated string or YAML array to string[].
 * Returns undefined for null/undefined input.
 */
function parseCommaSeparated(value: unknown): string[] | undefined {
	if (value == null) return undefined;

	if (Array.isArray(value)) {
		return value.map((v) => String(v).trim()).filter(Boolean);
	}

	if (typeof value === "string") {
		return value
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	}

	return undefined;
}

function formatFieldWarning(subject: WarningSubject, name: string, warning: ParsedFieldWarning): string {
	const prefix = `${subject === "subagent" ? "Subagent" : "Subagent override"} "${name}"`;

	switch (warning.code) {
		case "invalid-list-format":
			return `${prefix}: invalid ${warning.fieldName} field, expected a comma-separated string or YAML array`;
		case "invalid-type":
			return `${prefix}: field "${warning.fieldName}" must be a ${warning.expected}, ignoring`;
		case "invalid-model-format":
			return `${prefix}: invalid model format "${warning.model}" (expected "provider/model-id"), ignoring model field`;
		case "invalid-thinking-level":
			return `${prefix}: invalid thinking level "${warning.thinking}", ignoring`;
		case "unknown-tools":
			return `${prefix}: unknown tools ${warning.tools.map((toolName) => `"${toolName}"`).join(", ")}, ignoring`;
	}
}

function toParseWarnings(
	filePath: string,
	subject: WarningSubject,
	name: string,
	warnings: ParsedFieldWarning[],
): AgentConfigFieldParseWarning[] {
	return warnings.map((warning) => createParseWarning(filePath, formatFieldWarning(subject, name, warning)));
}

function parseListField(value: unknown, fieldName: ParsedListFieldName): { values: string[]; warnings: ParsedFieldWarning[] } {
	if (value == null) return { values: [], warnings: [] };

	const parsed = parseCommaSeparated(value);
	if (parsed !== undefined) return { values: parsed, warnings: [] };

	return {
		values: [],
		warnings: [{ code: "invalid-list-format", fieldName }],
	};
}

/**
 * Parses "provider/model-id" format.
 * Returns null if "/" is missing.
 */
function parseModel(value: unknown): ParsedModel | null {
	if (typeof value !== "string" || !value.includes("/")) {
		return null;
	}

	const slashIndex = value.indexOf("/");
	const provider = value.slice(0, slashIndex).trim();
	const modelId = value.slice(slashIndex + 1).trim();

	if (!provider || !modelId) return null;

	return { provider, modelId };
}

function validateThinkingLevel(value: string | undefined): ThinkingLevel | undefined {
	if (!value) return undefined;
	if (VALID_THINKING_LEVELS.includes(value)) return value as ThinkingLevel;
	return undefined;
}

function parseModelField(value: unknown, options: ParseFieldOptions): Pick<ParsedFieldSet, "model" | "parsedModel" | "warnings"> {
	if (typeof value === "string") {
		const parsedModel = parseModel(value);
		if (!parsedModel) {
			return {
				...(options.setValueOnInvalidType ? { model: value } : {}),
				warnings: [{ code: "invalid-model-format", model: value }],
			};
		}

		return {
			model: value,
			parsedModel,
			warnings: [],
		};
	}

	if (value !== undefined && options.warnOnInvalidType) {
		return {
			warnings: [{ code: "invalid-type", fieldName: "model", expected: "string" }],
		};
	}

	return { warnings: [] };
}

function parseThinkingField(value: unknown, options: ParseFieldOptions): Pick<ParsedFieldSet, "thinking" | "warnings"> {
	if (typeof value === "string") {
		const thinking = validateThinkingLevel(value);
		if (!thinking) {
			return {
				warnings: [{ code: "invalid-thinking-level", thinking: value }],
			};
		}

		return { thinking, warnings: [] };
	}

	if (value !== undefined && options.warnOnInvalidType) {
		return {
			warnings: [{ code: "invalid-type", fieldName: "thinking", expected: "string" }],
		};
	}

	return { warnings: [] };
}

function parseToolsField(value: unknown, options: ParseFieldOptions): Pick<ParsedFieldSet, "tools" | "warnings"> {
	const parsedTools = parseListField(value, "tools");
	const validTools = parsedTools.values.filter(isSupportedToolName);
	const invalidTools = parsedTools.values.filter((toolName) => !isSupportedToolName(toolName));
	const warnings: ParsedFieldWarning[] = [...parsedTools.warnings];

	if (invalidTools.length > 0) {
		warnings.push({ code: "unknown-tools", tools: invalidTools });
	}

	if (invalidTools.length > 0 && validTools.length === 0 && !options.setValueOnInvalidType) {
		return { warnings };
	}

	if (parsedTools.warnings.length > 0 && !options.setValueOnInvalidType) {
		return { warnings };
	}

	return {
		tools: validTools,
		warnings,
	};
}

function parseSkillsField(value: unknown, options: ParseFieldOptions): Pick<ParsedFieldSet, "skills" | "warnings"> {
	const parsedSkills = parseListField(value, "skills");
	if (parsedSkills.warnings.length > 0 && !options.setValueOnInvalidType) {
		return { warnings: parsedSkills.warnings };
	}

	return {
		skills: parsedSkills.values,
		warnings: parsedSkills.warnings,
	};
}

function parseBooleanField(
	fieldName: ParsedBooleanFieldName,
	value: unknown,
	options: ParseFieldOptions,
): Pick<ParsedFieldSet, ParsedBooleanFieldName | "warnings"> {
	if (typeof value === "boolean") {
		return {
			[fieldName]: value,
			warnings: [],
		};
	}

	if (value !== undefined && options.warnOnInvalidType) {
		return {
			warnings: [{ code: "invalid-type", fieldName, expected: "boolean" }],
		};
	}

	return { warnings: [] };
}

function parseSharedFields(record: Record<string, unknown>, options: ParseFieldOptions): ParsedFieldSet {
	const model = parseModelField(record.model, options);
	const thinking = parseThinkingField(record.thinking, options);
	const tools = Object.prototype.hasOwnProperty.call(record, "tools")
		? parseToolsField(record.tools, options)
		: { warnings: [] };
	const skills = Object.prototype.hasOwnProperty.call(record, "skills")
		? parseSkillsField(record.skills, options)
		: { warnings: [] };
	const compaction = parseBooleanField("compaction", record.compaction, options);
	const interactive = parseBooleanField("interactive", record.interactive, options);

	return {
		...("model" in model ? { model: model.model } : {}),
		...("parsedModel" in model ? { parsedModel: model.parsedModel } : {}),
		...(thinking.thinking !== undefined ? { thinking: thinking.thinking } : {}),
		...(tools.tools !== undefined ? { tools: tools.tools } : {}),
		...(skills.skills !== undefined ? { skills: skills.skills } : {}),
		...(compaction.compaction !== undefined ? { compaction: compaction.compaction } : {}),
		...(interactive.interactive !== undefined ? { interactive: interactive.interactive } : {}),
		warnings: [
			...model.warnings,
			...thinking.warnings,
			...tools.warnings,
			...skills.warnings,
			...compaction.warnings,
			...interactive.warnings,
		],
	};
}

export function parseDefinitionFields(
	record: Record<string, unknown>,
	filePath: string,
	agentName: string,
): AgentConfigFieldParseResult {
	const parsed = parseSharedFields(record, {
		warnOnInvalidType: false,
		setValueOnInvalidType: true,
	});
	const { warnings, ...fields } = parsed;

	return {
		fields,
		warnings: toParseWarnings(filePath, "subagent", agentName, warnings),
	};
}

export function parseOverrideFields(
	record: Record<string, unknown>,
	filePath: string,
	agentName: string,
): AgentConfigFieldParseResult {
	const warnings: AgentConfigFieldParseWarning[] = [];

	for (const fieldName of Object.keys(record)) {
		if (fieldName === "name" || fieldName === "description") {
			warnings.push(
				createParseWarning(
					filePath,
					`Subagent override "${agentName}": field "${fieldName}" is not overridable, ignoring`,
				),
			);
			continue;
		}

		if (!ALLOWED_OVERRIDE_FIELDS.has(fieldName)) {
			warnings.push(
				createParseWarning(
					filePath,
					`Subagent override "${agentName}": unknown field "${fieldName}", ignoring`,
				),
			);
		}
	}

	const parsed = parseSharedFields(record, {
		warnOnInvalidType: true,
		setValueOnInvalidType: false,
	});
	const { warnings: fieldWarnings, ...fields } = parsed;
	warnings.push(...toParseWarnings(filePath, "subagent override", agentName, fieldWarnings));

	return { fields, warnings };
}
