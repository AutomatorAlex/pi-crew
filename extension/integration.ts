import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { CrewRuntime } from "./runtime/crew-runtime.js";
import { registerCrewMessageRenderers } from "./integration/register-renderers.js";
import { registerCrewTools } from "./integration/register-tools.js";

export function registerCrewIntegration(
	pi: ExtensionAPI,
	crew: CrewRuntime,
	extensionDir: string,
): void {
	registerCrewTools(pi, crew, extensionDir);
	registerCrewMessageRenderers(pi);
}
