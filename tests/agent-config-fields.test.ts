import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	parseDefinitionFields,
	parseOverrideFields,
} from "../extension/agent-config-fields.js";

function warningText(result: { warnings: Array<{ message: string }> }): string {
	return result.warnings.map((warning) => warning.message).join("\n");
}

describe("agent config field parsing", () => {
	it("parses definition fields and keeps invalid model strings for reporting/fallback", () => {
		const result = parseDefinitionFields(
			{
				model: "bad-model",
				thinking: "high",
				tools: ["read", "missing"],
				skills: "pi-crew, ast-grep",
				compaction: false,
				interactive: true,
			},
			"/agents/scout.md",
			"scout",
		);

		assert.equal(result.fields.model, "bad-model");
		assert.equal(result.fields.parsedModel, undefined);
		assert.equal(result.fields.thinking, "high");
		assert.deepEqual(result.fields.tools, ["read"]);
		assert.deepEqual(result.fields.skills, ["pi-crew", "ast-grep"]);
		assert.equal(result.fields.compaction, false);
		assert.equal(result.fields.interactive, true);
		assert.match(warningText(result), /Subagent "scout": invalid model format "bad-model"/);
		assert.match(warningText(result), /Subagent "scout": unknown tools "missing"/);
	});

	it("ignores invalid override fields while keeping valid override fields", () => {
		const result = parseOverrideFields(
			{
				name: "renamed",
				unknown: true,
				model: "bad-model",
				thinking: "low",
				tools: ["grep", "nope"],
				interactive: "yes",
			},
			"/repo/.pi/pi-crew.json",
			"scout",
		);

		assert.equal(result.fields.model, undefined);
		assert.equal(result.fields.parsedModel, undefined);
		assert.equal(result.fields.thinking, "low");
		assert.deepEqual(result.fields.tools, ["grep"]);
		assert.equal(result.fields.interactive, undefined);
		assert.match(warningText(result), /field "name" is not overridable/);
		assert.match(warningText(result), /unknown field "unknown"/);
		assert.match(warningText(result), /invalid model format "bad-model"/);
		assert.match(warningText(result), /unknown tools "nope"/);
		assert.match(warningText(result), /field "interactive" must be a boolean/);
	});

	it("preserves explicit empty tools and skills", () => {
		const definition = parseDefinitionFields(
			{ tools: [], skills: [] },
			"/agents/scout.md",
			"scout",
		);
		const override = parseOverrideFields(
			{ tools: [], skills: [] },
			"/repo/.pi/pi-crew.json",
			"scout",
		);

		assert.deepEqual(definition.fields.tools, []);
		assert.deepEqual(definition.fields.skills, []);
		assert.deepEqual(override.fields.tools, []);
		assert.deepEqual(override.fields.skills, []);
	});
});
