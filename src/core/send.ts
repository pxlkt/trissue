import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { LinkTarget } from "./config.ts";
import { findExecutable } from "./harnesses.ts";
import { formatIssue, type Issue } from "./issue.ts";

const exec = promisify(execFile);

export class SendError extends Error {
  override name = "SendError";
}

export type GitHubStatus =
  | { state: "missing" }
  | { state: "signed-out" }
  | { state: "signed-in"; login: string };

/** Whether the GitHub CLI is installed and signed in to github.com. */
export async function gitHubStatus(): Promise<GitHubStatus> {
  const gh = findExecutable("gh");
  if (!gh) return { state: "missing" };
  try {
    await exec(gh, ["auth", "status", "--hostname", "github.com"]);
  } catch {
    // quiet: a non-zero exit is how gh says nobody is signed in; the caller shows the sign-in step.
    return { state: "signed-out" };
  }
  const { stdout } = await exec(gh, ["api", "user", "--jq", ".login"]);
  return { state: "signed-in", login: stdout.trim() };
}

/** The command that signs the GitHub CLI in. It is interactive and needs the terminal. */
export const GITHUB_LOGIN_ARGS = ["auth", "login", "--hostname", "github.com", "--web", "--git-protocol", "https"];

/**
 * Files the issue with `gh issue create` and returns its URL. Labels the
 * repository doesn't have are left off, because gh refuses unknown labels.
 */
export async function fileGitHubIssue(repo: string, issue: Issue, labels: string[] = []): Promise<string> {
  const gh = findExecutable("gh");
  if (!gh) throw new SendError("The GitHub CLI (gh) isn't installed.");

  const args = ["issue", "create", "--repo", repo, "--title", issue.title, "--body-file", "-"];
  if (labels.length) {
    const { stdout } = await exec(gh, ["label", "list", "--repo", repo, "--limit", "1000", "--json", "name", "--jq", ".[].name"]);
    const existing = new Set(stdout.split("\n").map((name) => name.trim().toLowerCase()));
    for (const label of labels) if (existing.has(label.toLowerCase())) args.push("--label", label);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(gh, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", (error) => reject(new SendError(`Couldn't run gh: ${error.message}`)));
    child.once("close", (code) => {
      const url = stdout.trim().split("\n").pop() ?? "";
      if (code === 0 && /^https:\/\//.test(url)) resolve(url);
      else reject(new SendError(stderr.trim() || `gh exited with code ${code}.`));
    });
    child.stdin.end(issue.body);
  });
}

function clipboardCommand(): [string, string[]] | null {
  const candidates: [string, string[]][] =
    process.platform === "darwin"
      ? [["pbcopy", []]]
      : process.platform === "win32"
        ? [["clip", []]]
        : [
            ...(process.env.WAYLAND_DISPLAY ? ([["wl-copy", []]] as [string, string[]][]) : []),
            ["xclip", ["-selection", "clipboard"]],
            ["xsel", ["--clipboard", "--input"]],
          ];
  for (const [bin, args] of candidates) {
    const path = findExecutable(bin);
    if (path) return [path, args];
  }
  return null;
}

/** Whether this computer has a clipboard program trissue can use. */
export function hasClipboard(): boolean {
  return clipboardCommand() !== null;
}

/** Puts text on the system clipboard. */
export async function copyText(text: string): Promise<void> {
  const command = clipboardCommand();
  if (!command) {
    throw new SendError(process.platform === "linux" ? "No clipboard program found. Install wl-clipboard or xclip." : "No clipboard program found.");
  }
  const [bin, args] = command;
  await new Promise<void>((resolve, reject) => {
    // wl-copy stays running to serve the clipboard, so its output is ignored and only its start is awaited.
    const child = spawn(bin, args, { stdio: ["pipe", "ignore", "pipe"], detached: process.platform !== "win32" });
    let stderr = "";
    child.stderr!.on("data", (chunk) => (stderr += chunk));
    child.once("error", (error) => reject(new SendError(`Couldn't copy: ${error.message}`)));
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new SendError(stderr.trim() || `${bin} exited with code ${code}.`))));
    child.stdin!.end(text);
    child.unref();
  });
}

/** Copies the issue as "Title: …" and "Issue Content: …". */
export function copyIssue(issue: Issue): Promise<void> {
  return copyText(formatIssue(issue));
}

/** Fills a link's `{title}`, `{body}` and `{issue}` with the URL-encoded issue. */
export function buildLink(link: LinkTarget, issue: Issue): string {
  return link.url
    .replaceAll("{title}", encodeURIComponent(issue.title))
    .replaceAll("{body}", encodeURIComponent(issue.body))
    .replaceAll("{issue}", encodeURIComponent(formatIssue(issue)));
}

/** Whether a link carries the issue in it. */
export function linkIncludesIssue(link: LinkTarget): boolean {
  return /\{(title|body|issue)\}/.test(link.url);
}

/** Opens a URL in the default browser or mail app. */
export async function openUrl(url: string): Promise<void> {
  const [bin, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  if (!findExecutable(bin as string)) throw new SendError(`Can't open links: ${bin} isn't installed.`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin as string, args as string[], { stdio: "ignore", detached: true });
    child.once("error", (error) => reject(new SendError(`Couldn't open the link: ${error.message}`)));
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
