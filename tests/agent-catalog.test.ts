import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	AgentCatalog,
	type AgentCatalogSource,
	type AgentConfigFile,
	type AgentDefinitionSourceGroup,
} from "../extension/agent-catalog.js";
import { discoverAgents } from "../extension/agent-discovery.js";

function agentMd(name: string, fields: Record<string, string | boolean | string[]> = {}): string {
	const lines = [
		"---",
		`name: ${name}`,
		`description: ${name} description`,
	];
	for (const [key, value] of Object.entries(fields)) {
		if (Array.isArray(value)) {
			lines.push(`${key}: [${value.join(", ")}]`);
		} else {
			lines.push(`${key}: ${value}`);
		}
	}
	lines.push("---", `${name} prompt`);
	return lines.join("\n");
}

class InMemorySource implements AgentCatalogSource {
	constructor(
		private readonly groups: AgentDefinitionSourceGroup[],
		private readonly configs: AgentConfigFile[] = [],
	) {}

	loadAgentDefinitionGroups(): AgentDefinitionSourceGroup[] {
		return this.groups;
	}

	loadConfigFiles(): AgentConfigFile[] {
		return this.configs;
	}
}

function discover(
	groups: AgentDefinitionSourceGroup[],
	configs: AgentConfigFile[] = [],
) {
	return new AgentCatalog(new InMemorySource(groups, configs)).discover("/repo");
}

describe("AgentCatalog", () => {
	it("keeps project/user/bundled priority", () => {
		const result = discover([
			{
				agentsDir: "/repo/.pi/agents",
				files: [{ filePath: "/repo/.pi/agents/scout.md", content: agentMd("scout", { thinking: "high" }) }],
			},
			{
				agentsDir: "/home/.pi/agent/agents",
				files: [{ filePath: "/home/.pi/agent/agents/scout.md", content: agentMd("scout", { thinking: "low" }) }],
			},
			{
				agentsDir: "/pkg/agents",
				files: [{ filePath: "/pkg/agents/scout.md", content: agentMd("scout", { thinking: "minimal" }) }],
			},
		]);

		assert.equal(result.agents.length, 1);
		assert.equal(result.agents[0]?.filePath, "/repo/.pi/agents/scout.md");
		assert.equal(result.agents[0]?.thinking, "high");
		assert.equal(result.warnings.length, 0);
	});

	it("warns for duplicate names within the same source group", () => {
		const result = discover([
			{
				agentsDir: "/repo/.pi/agents",
				files: [
					{ filePath: "/repo/.pi/agents/one.md", content: agentMd("same") },
					{ filePath: "/repo/.pi/agents/two.md", content: agentMd("same") },
				],
			},
		]);

		assert.equal(result.agents.length, 1);
		assert.match(result.warnings[0]?.message ?? "", /Duplicate subagent name "same"/);
	});

	it("applies project override on top of global override", () => {
		const result = discover(
			[
				{
					agentsDir: "/pkg/agents",
					files: [{ filePath: "/pkg/agents/scout.md", content: agentMd("scout") }],
				},
			],
			[
				{
					filePath: "/home/.pi/agent/pi-crew.json",
					content: JSON.stringify({ agents: { scout: { thinking: "low", interactive: false } } }),
				},
				{
					filePath: "/repo/.pi/pi-crew.json",
					content: JSON.stringify({ agents: { scout: { thinking: "high" } } }),
				},
			],
		);

		assert.equal(result.agents[0]?.thinking, "high");
		assert.equal(result.agents[0]?.interactive, false);
	});

	it("warns when an override does not match any discovered subagent", () => {
		const result = discover(
			[],
			[
				{
					filePath: "/repo/.pi/pi-crew.json",
					content: JSON.stringify({ agents: { missing: { thinking: "high" } } }),
				},
			],
		);

		assert.match(result.warnings[0]?.message ?? "", /does not match any discovered subagent/);
	});

	it("ignores invalid override fields while applying valid fields", () => {
		const result = discover(
			[
				{
					agentsDir: "/pkg/agents",
					files: [{ filePath: "/pkg/agents/scout.md", content: agentMd("scout", { model: "provider/model" }) }],
				},
			],
			[
				{
					filePath: "/repo/.pi/pi-crew.json",
					content: JSON.stringify({ agents: { scout: { model: "bad-model", unknown: true, thinking: "high" } } }),
				},
			],
		);

		assert.equal(result.agents[0]?.thinking, "high");
		assert.equal(result.agents[0]?.model, "provider/model");
		assert.match(result.warnings.map((warning) => warning.message).join("\n"), /unknown field "unknown"/);
		assert.match(result.warnings.map((warning) => warning.message).join("\n"), /invalid model format "bad-model"/);
	});

	it("preserves explicit empty tools and skills", () => {
		const result = discover([
			{
				agentsDir: "/pkg/agents",
				files: [{ filePath: "/pkg/agents/scout.md", content: agentMd("scout", { tools: [], skills: [] }) }],
			},
		]);

		assert.deepEqual(result.agents[0]?.tools, []);
		assert.deepEqual(result.agents[0]?.skills, []);
	});

	it("keeps invalid definition model string without parsedModel", () => {
		const result = discover([
			{
				agentsDir: "/pkg/agents",
				files: [{ filePath: "/pkg/agents/scout.md", content: agentMd("scout", { model: "bad-model" }) }],
			},
		]);

		assert.equal(result.agents[0]?.model, "bad-model");
		assert.equal(result.agents[0]?.parsedModel, undefined);
		assert.match(result.warnings[0]?.message ?? "", /invalid model format "bad-model"/);
	});
});

describe("discoverAgents", () => {
	it("discovers project agents through the filesystem wrapper", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-crew-agent-discovery-"));
		const agentsDir = join(cwd, ".pi", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(join(agentsDir, "local-smoke.md"), agentMd("local-smoke"));

		const result = discoverAgents(cwd);

		assert.ok(result.agents.some((agent) => agent.name === "local-smoke"));
	});
});
