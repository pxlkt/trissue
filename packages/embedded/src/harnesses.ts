import { accessSync, constants, existsSync, statSync } from "node:fs";
import { basename, delimiter, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeLaunch } from "./claude-session.ts";
import registry from "./registry.json" with { type: "json" };

/** How a harness's name is drawn. Brand colors are fixed; repositories can't change them. */
export interface HarnessBrand {
  /** The name's color in the list. Several colors make a left-to-right gradient. */
  color: string[];
  /** Text color when the harness is selected and `color` becomes the background. */
  selectedText: string;
}

export interface LaunchSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** A coding agent on this computer that trissue can run over ACP. */
export interface Harness {
  id: string;
  name: string;
  /** Null for harnesses without brand colors; they draw in the interface's text color. */
  brand: HarnessBrand | null;
  /** "claude" drives `claude -p` directly; everything else speaks ACP. */
  protocol: "acp" | "claude";
  /** The installed program trissue found. */
  executable: string;
  launch: LaunchSpec;
}

interface HarnessDefinition {
  id: string;
  name: string;
  brand: HarnessBrand | null;
  protocol?: "acp" | "claude";
  /** Programs that mean the harness is installed. The first one found is used. */
  bins: string[];
  launch(executable: string): LaunchSpec;
}

/** Finds the trissue package root, where `dist/adapters` lives. */
function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("trissue can't find its own package folder.");
    dir = parent;
  }
  return dir;
}

/**
 * The Codex ACP adapter ships inside trissue as one bundled file, so
 * installing trissue doesn't download a second copy of Codex. It runs the
 * `codex` the user already has.
 */
function bundledAdapter(name: "codex"): LaunchSpec {
  const file = join(packageRoot(), "dist", "adapters", `${name}.mjs`);
  if (!existsSync(file)) throw new Error(`The ${name} adapter is missing at ${file}. Run \`bun run build\`.`);
  // Electron runs scripts with its own binary only when ELECTRON_RUN_AS_NODE is set; Node and Bun ignore it.
  return { command: process.execPath, args: [file], env: { ELECTRON_RUN_AS_NODE: "1" } };
}

const BUILT_IN: HarnessDefinition[] = [
  {
    id: "claude",
    name: "Claude Code",
    brand: { color: ["#DE7356"], selectedText: "#B1ADA1" },
    protocol: "claude",
    bins: ["claude"],
    launch: claudeLaunch,
  },
  {
    id: "codex",
    name: "Codex",
    brand: { color: ["#B1A7FF", "#7A9DFF", "#3941FF"], selectedText: "#FFFFFF" },
    bins: ["codex"],
    launch: (executable) => {
      const spec = bundledAdapter("codex");
      return { ...spec, env: { ...spec.env, CODEX_PATH: executable, INITIAL_AGENT_MODE: "read-only" } };
    },
  },
  {
    id: "cursor",
    name: "Cursor",
    brand: { color: ["#F54E00"], selectedText: "#14120B" },
    bins: ["cursor-agent"],
    launch: (executable) => ({ command: executable, args: ["acp"], env: {} }),
  },
  {
    id: "grok",
    name: "Grok",
    brand: { color: ["#FFFFFF"], selectedText: "#000000" },
    bins: ["grok"],
    launch: (executable) => ({ command: executable, args: ["agent", "stdio"], env: {} }),
  },
  {
    id: "opencode",
    name: "OpenCode",
    brand: { color: ["#D2D2D2"], selectedText: "#1F1F1F" },
    bins: ["opencode"],
    launch: (executable) => ({ command: executable, args: ["acp"], env: {} }),
  },
  {
    id: "antigravity",
    name: "Antigravity",
    brand: { color: ["#3186FF", "#00B95C", "#FFE432", "#FC413D", "#3186FF"], selectedText: "#FFFFFF" },
    // `agy` is the Antigravity CLI, which serves ACP with `agy acp`. The other
    // two are the standalone ACP server from before the CLI existed.
    bins: ["agy", "agy_acp_server.par", "agy-acp-server"],
    launch: (executable) => ({ command: executable, args: basename(executable, extname(executable)) === "agy" ? ["acp"] : ["--uid="], env: {} }),
  },
];

interface RegistryEntry {
  id: string;
  name: string;
  bins: string[];
  args: string[];
  env: Record<string, string>;
}

/** Every other agent in the ACP registry, drawn without brand colors. */
const REGISTRY: HarnessDefinition[] = (registry as RegistryEntry[]).map((entry) => ({
  id: entry.id,
  name: entry.name,
  brand: null,
  bins: entry.bins,
  launch: (executable) => ({ command: executable, args: entry.args, env: entry.env }),
}));

const DEFINITIONS = [...BUILT_IN, ...REGISTRY];

function isExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform !== "win32") accessSync(path, constants.X_OK);
    return true;
  } catch {
    // quiet: a missing or non-executable candidate just means the harness isn't installed there.
    return false;
  }
}

/** Looks a program up on PATH, like `which`. */
export function findExecutable(name: string, path = process.env.PATH ?? ""): string | null {
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = join(dir, name + extension);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

/** The harnesses installed on this computer, brand harnesses first. */
export function detectHarnesses(path?: string): Harness[] {
  const found: Harness[] = [];
  const used = new Set<string>();
  for (const definition of DEFINITIONS) {
    for (const bin of definition.bins) {
      const executable = findExecutable(bin, path);
      // Two registry entries can name the same program (a renamed agent); the first one wins.
      if (!executable || used.has(executable)) continue;
      used.add(executable);
      found.push({
        id: definition.id,
        name: definition.name,
        brand: definition.brand,
        protocol: definition.protocol ?? "acp",
        executable,
        get launch() {
          return definition.launch(executable);
        },
      });
      break;
    }
  }
  return found;
}

/** Every harness trissue knows, installed or not. For docs and tests. */
export function knownHarnesses(): { id: string; name: string; bins: string[]; branded: boolean }[] {
  return DEFINITIONS.map((definition) => ({ id: definition.id, name: definition.name, bins: definition.bins, branded: definition.brand !== null }));
}
