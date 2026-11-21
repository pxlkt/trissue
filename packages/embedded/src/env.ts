import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const MARK = "__trissue_path__";
const SHELL_TIMEOUT_MS = 3000;

/** Where agents and their runtimes usually live, for when the shell can't be asked. */
function wellKnownDirs(): string[] {
  const home = homedir();
  return [
    join(home, ".local", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".opencode", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".volta", "bin"),
    join(home, ".cargo", "bin"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
  ];
}

/** The PATH the user's login shell sets up, or [] when it can't be read. */
function loginShellPath(): string[] {
  const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh");
  try {
    // -i and -l, so PATH set in .zshrc/.bashrc (nvm, Homebrew) is there too. The markers
    // skip anything the shell's startup files print.
    const result = spawnSync(shell, ["-ilc", `printf '${MARK}%s${MARK}' "$PATH"`], {
      encoding: "utf8",
      timeout: SHELL_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const match = result.stdout?.match(new RegExp(`${MARK}(.*?)${MARK}`, "s"));
    return match ? match[1]!.split(":").filter(Boolean) : [];
  } catch {
    // quiet: an unusual shell just means trissue falls back to the well-known folders.
    return [];
  }
}

let cached: string | undefined;

/**
 * The PATH to find and run agents with. An app launched from the macOS Dock
 * (or a Linux desktop menu) gets a bare PATH without Homebrew, ~/.local/bin or
 * nvm, so trissue adds the login shell's PATH and the usual install folders.
 * Worked out once per process.
 */
export function userPath(): string {
  if (cached !== undefined) return cached;
  const own = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  if (process.platform === "win32") return (cached = own.join(delimiter));
  // From a terminal, PATH is already the user's; only GUI launches need the shell asked.
  const shell = process.stdin.isTTY ? [] : loginShellPath();
  return (cached = [...new Set([...shell, ...own, ...wellKnownDirs()])].join(delimiter));
}

/** process.env with the user's PATH, for spawning programs. */
export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  // Windows GUI apps already get the full PATH, and its env keys are case-insensitive ("Path").
  if (process.platform === "win32") return { ...process.env, ...extra };
  return { ...process.env, PATH: userPath(), ...extra };
}
