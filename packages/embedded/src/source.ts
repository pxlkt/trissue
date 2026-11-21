import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

import { childEnv } from "./env.ts";

const exec = promisify(execFile);

/** Where the repository being triaged comes from. */
export interface RepoSource {
  kind: "local" | "remote";
  /** The owner or organization, like "MileniumHQ". Empty when a local folder has no remote. */
  org: string;
  /** The repository name, like "Paperboard". */
  name: string;
  /** Where it was downloaded from, like "github.com", or "this computer" for a local folder. */
  origin: string;
  /** Clone URL for remote sources. */
  url?: string;
  /** Branch, tag or commit to check out. */
  ref?: string;
  /** `owner/repo` when the repository lives on github.com. */
  github?: string;
}

/** A source that is on disk and ready to investigate. */
export interface FetchedSource extends RepoSource {
  dir: string;
  /** The checked-out commit. */
  commit: string;
  /** Deletes the download. Does nothing for local folders. */
  dispose(): Promise<void>;
}

export class SourceError extends Error {
  override name = "SourceError";
}

function parseRemote(url: string): Pick<RepoSource, "org" | "name" | "origin" | "github"> | null {
  const match =
    url.match(/^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)\/([^/]+?)(?:\.git)?\/?$/) ??
    url.match(/^[^@]+@([^:]+):(.+?)\/([^/]+?)(?:\.git)?$/);
  if (!match) return null;
  const [, host, org, name] = match as unknown as [string, string, string, string];
  return { org, name, origin: host, github: host === "github.com" ? `${org}/${name}` : undefined };
}

/**
 * Turns what the user typed into a source. Accepts `owner/repo` (GitHub),
 * `host/owner/repo`, a clone URL, or a local folder. Nothing is downloaded yet.
 */
export async function resolveSource(spec: string | undefined, ref?: string): Promise<RepoSource> {
  const input = spec?.trim() || ".";
  const local = input.startsWith("~") ? join(homedir(), input.slice(1)) : resolve(input);

  if (input === "." || input.startsWith("/") || input.startsWith(".") || input.startsWith("~") || existsSync(local)) {
    if (!existsSync(local)) throw new SourceError(`There is no folder at ${local}.`);
    if (ref) throw new SourceError("A ref can only be given for a repository that is downloaded.");
    let remote: ReturnType<typeof parseRemote> = null;
    try {
      const { stdout } = await exec("git", ["-C", local, "remote", "get-url", "origin"], { env: childEnv() });
      remote = parseRemote(stdout.trim());
    } catch {
      // quiet: a folder without a git remote is still a valid local source; it is named after the folder.
    }
    return {
      kind: "local",
      org: remote?.org ?? "",
      name: remote?.name ?? basename(local),
      origin: "this computer",
      url: local,
      github: remote?.github,
    };
  }

  const shorthand = input.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (shorthand) {
    const [, org, name] = shorthand as unknown as [string, string, string];
    return { kind: "remote", org, name, origin: "github.com", url: `https://github.com/${org}/${name}.git`, ref, github: `${org}/${name}` };
  }

  const hostPath = input.match(/^([\w.-]+\.[a-z]{2,})\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i);
  const url = hostPath ? `https://${hostPath[1]}/${hostPath[2]}/${hostPath[3]}.git` : input;
  const remote = parseRemote(url);
  if (!remote) throw new SourceError(`"${input}" is not a repository. Use owner/repo, a clone URL, or a folder.`);
  return { kind: "remote", ...remote, url, ref };
}

async function headCommit(dir: string): Promise<string> {
  try {
    const { stdout } = await exec("git", ["-C", dir, "rev-parse", "HEAD"], { env: childEnv() });
    return stdout.trim();
  } catch {
    // quiet: a local folder that isn't a git repository has no commit; the prompt says so.
    return "";
  }
}

/** Downloads a remote source into a temporary folder, or checks a local one. */
export async function fetchSource(source: RepoSource): Promise<FetchedSource> {
  if (source.kind === "local") {
    const dir = source.url!;
    return { ...source, dir, commit: await headCommit(dir), dispose: async () => {} };
  }

  const dir = await mkdtemp(join(tmpdir(), "trissue-"));
  const args = ["clone", "--depth", "1", "--no-tags", "--quiet"];
  if (source.ref) args.push("--branch", source.ref);
  args.push("--", source.url!, dir);
  try {
    await exec("git", args, {
      env: childEnv({ GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" }),
      timeout: 120_000,
    });
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new SourceError(`Couldn't download ${source.url}${stderr ? `: ${stderr}` : "."}`);
  }
  return {
    ...source,
    dir,
    commit: await headCommit(dir),
    dispose: () => rm(dir, { recursive: true, force: true }),
  };
}
