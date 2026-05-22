import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	AgentCatalog,
	type AgentCatalogSource,
	type AgentConfigFile,
	type AgentDefinitionFile,
	type AgentDefinitionSourceGroup,
	type AgentDiscoveryResult,
	type AgentDiscoveryWarning,
} from "./agent-catalog.js";

export type {
	AgentConfig,
	AgentDiscoveryResult,
	AgentDiscoveryWarning,
} from "./agent-catalog.js";

function createDiscoveryWarning(filePath: string, message: string): AgentDiscoveryWarning {
	return { filePath, message };
}

function loadAgentFile(filePath: string): AgentDefinitionFile {
	try {
		return {
			filePath,
			content: fs.readFileSync(filePath, "utf-8"),
		};
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			filePath,
			content: null,
			warnings: [
				createDiscoveryWarning(
					filePath,
					`Ignored subagent definition. File could not be read: ${reason}`,
				),
			],
		};
	}
}

function loadAgentDefinitionGroup(agentsDir: string): AgentDefinitionSourceGroup | null {
	if (!fs.existsSync(agentsDir)) return null;

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(agentsDir, { withFileTypes: true });
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			agentsDir,
			files: [],
			warnings: [
				createDiscoveryWarning(
					agentsDir,
					`Subagent directory could not be read: ${reason}`,
				),
			],
		};
	}

	return {
		agentsDir,
		files: entries
			.filter((entry) => entry.name.endsWith(".md"))
			.filter((entry) => entry.isFile() || entry.isSymbolicLink())
			.map((entry) => loadAgentFile(path.join(agentsDir, entry.name))),
	};
}

function loadConfigFile(filePath: string): AgentConfigFile | null {
	if (!fs.existsSync(filePath)) return null;

	try {
		return {
			filePath,
			content: fs.readFileSync(filePath, "utf-8"),
		};
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			filePath,
			content: null,
			warnings: [
				createDiscoveryWarning(
					filePath,
					`Ignored pi-crew config. File could not be read: ${reason}`,
				),
			],
		};
	}
}

const bundledAgentsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "agents");

class FilesystemAgentCatalogSource implements AgentCatalogSource {
	loadAgentDefinitionGroups(cwd: string): AgentDefinitionSourceGroup[] {
		return [
			path.join(cwd, ".pi", "agents"),
			path.join(getAgentDir(), "agents"),
			bundledAgentsDir,
		]
			.map(loadAgentDefinitionGroup)
			.filter((group): group is AgentDefinitionSourceGroup => group !== null);
	}

	loadConfigFiles(cwd: string): AgentConfigFile[] {
		return [
			path.join(getAgentDir(), "pi-crew.json"),
			path.join(cwd, ".pi", "pi-crew.json"),
		]
			.map(loadConfigFile)
			.filter((file): file is AgentConfigFile => file !== null);
	}
}

export function discoverAgents(cwd: string = process.cwd()): AgentDiscoveryResult {
	return new AgentCatalog(new FilesystemAgentCatalogSource()).discover(cwd);
}
