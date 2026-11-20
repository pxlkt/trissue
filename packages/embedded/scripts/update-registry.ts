/**
 * Refreshes src/core/registry.json from the ACP agent registry.
 *
 * trissue never downloads an agent. It only runs agents that are already
 * installed, so the snapshot records which program names mean an agent is
 * installed and which arguments start its ACP server. Run with
 * `bun scripts/update-registry.ts`.
 */
import { $ } from "bun";

const REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

/** Agents with a built-in definition in src/core/harnesses.ts. */
const BUILT_IN = new Set(["claude-acp", "codex-acp", "cursor", "grok-build", "opencode", "opencode-v2", "antigravity-acp"]);

interface Launch {
  package?: string;
  cmd?: string;
  args?: string[];
  env?: Record<string, string>;
}

interface Agent {
  id: string;
  name: string;
  distribution: { npx?: Launch; uvx?: Launch; binary?: Record<string, Launch> };
}

const response = await fetch(REGISTRY_URL);
if (!response.ok) throw new Error(`The ACP registry answered ${response.status}.`);
const { agents } = (await response.json()) as { agents: Agent[] };

function unversioned(spec: string): string {
  return spec.replace(/(?<=.)@[^@/]+$/, "").replace(/[=<>~!].*$/, "");
}

async function npmBins(spec: string): Promise<string[]> {
  const out = await $`npm view ${spec} bin --json`.quiet().nothrow();
  if (out.exitCode !== 0 || !out.stdout.toString().trim()) return [unversioned(spec).split("/").pop()!];
  const bin = JSON.parse(out.stdout.toString()) as string | Record<string, string>;
  return typeof bin === "string" ? [unversioned(spec).split("/").pop()!] : Object.keys(bin);
}

const entries = [];
for (const agent of agents) {
  if (BUILT_IN.has(agent.id)) continue;
  const { npx, uvx, binary } = agent.distribution;
  let bins: string[];
  let launch: Launch;
  if (npx?.package) {
    bins = await npmBins(npx.package);
    launch = npx;
  } else if (uvx?.package) {
    bins = [unversioned(uvx.package)];
    launch = uvx;
  } else if (binary) {
    const target = binary["linux-x86_64"] ?? binary["darwin-aarch64"] ?? Object.values(binary)[0];
    if (!target?.cmd) continue;
    bins = [target.cmd.split("/").pop()!.replace(/\.exe$/i, "")];
    launch = target;
  } else continue;
  entries.push({ id: agent.id, name: agent.name, bins, args: launch.args ?? [], env: launch.env ?? {} });
}

await Bun.write(new URL("../src/core/registry.json", import.meta.url), JSON.stringify(entries, null, 2) + "\n");
console.log(`Saved ${entries.length} agents.`);
