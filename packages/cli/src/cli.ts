import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildLink, copyIssue, detectHarnesses, fileGitHubIssue, formatIssue, openUrl, resolveSource, runTriage } from "trissue-embedded";
import { VERSION } from "./version.ts";

const HELP = `trissue: have a coding agent find the source of an issue and write it up.

Usage
  trissue [repo] [options]

  repo                   owner/repo (GitHub), a clone URL, or a folder. Defaults to this folder.

Options
  --ref <ref>            Branch, tag or commit to download
  --background <hex>     Background color of the interface
  --list-agents          List the coding agents installed on this computer
  -h, --help             Show this help
  -v, --version          Show the version

Without the interface (all set from arguments)
  --issue <text>         What's wrong. "-" reads it from stdin
  --agent <id>           Agent to use, like claude or codex. Defaults to the first installed
  --model <id>           Model to use. Defaults to the agent's default
  --send <how>           print (default), json, copy, github, or link:<label>
  --yes                  Required with --send github: confirms filing a public issue
`;



function fail(message: string): never {
  process.stderr.write(`trissue: ${message}\n`);
  process.exit(1);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    ref: { type: "string" },
    background: { type: "string" },
    "list-agents": { type: "boolean" },
    issue: { type: "string" },
    agent: { type: "string" },
    model: { type: "string" },
    send: { type: "string" },
    yes: { type: "boolean" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
});

if (values.help) {
  process.stdout.write(HELP);
  process.exit(0);
}
if (values.version) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}
if (values.background && !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(values.background)) fail("--background must be a hex color like #101010.");
if (positionals.length > 1) fail("Give one repo at most.");

if (values["list-agents"]) {
  const harnesses = detectHarnesses();
  if (!harnesses.length) fail("No coding agents are installed.");
  for (const harness of harnesses) process.stdout.write(`${harness.id.padEnd(16)} ${harness.name.padEnd(20)} ${harness.executable}\n`);
  process.exit(0);
}

const repo = positionals[0];

if (values.issue !== undefined) {
  await headless();
} else {
  if (values.agent || values.model || values.send || values.yes) fail("--agent, --model, --send and --yes need --issue.");
  await interactive();
}

async function headless() {
  const issueText = values.issue === "-" ? readFileSync(0, "utf8") : values.issue!;
  const send = values.send ?? "print";
  if (!/^(print|json|copy|github|link:.+)$/.test(send)) fail(`--send must be print, json, copy, github, or link:<label>, not "${send}".`);
  if (send === "github" && !values.yes) fail("--send github posts a public issue. Add --yes to confirm.");

  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  let result: Awaited<ReturnType<typeof runTriage>>;
  try {
    result = await runTriage({
      issue: issueText,
      repo,
      ref: values.ref,
      harness: values.agent,
      model: values.model,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "tool") {
          if (event.title && event.status !== "completed") process.stderr.write(`› ${event.title}\n`);
        } else if (event.type === "blocked") process.stderr.write(`⊘ Blocked ${event.title}\n`);
      },
    });
  } catch (error) {
    fail((error as Error).message);
  }

  try {
    const { issue, config, source } = result;
    if (send === "print") process.stdout.write(`${formatIssue(issue)}\n`);
    else if (send === "json") process.stdout.write(`${JSON.stringify(issue, null, 2)}\n`);
    else if (send === "copy") {
      await copyIssue(issue);
      process.stderr.write("Copied the issue.\n");
    } else if (send === "github") {
      const target = config?.github === false ? null : (config?.github ?? source.github);
      if (!target) fail("This repo has no GitHub repository to file on.");
      process.stdout.write(`${await fileGitHubIssue(target, issue, config?.labels ?? [])}\n`);
    } else {
      const label = send.slice("link:".length);
      const link = config?.links?.find((candidate) => candidate.label.toLowerCase() === label.toLowerCase());
      if (!link) fail(`This repo has no link called "${label}".`);
      const url = buildLink(link, issue);
      await openUrl(url);
      process.stdout.write(`${url}\n`);
    }
  } finally {
    await result.source.dispose();
  }
  process.exit(0);
}

async function interactive() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) fail("The interface needs a terminal. Use --issue to run without it.");
  let source;
  try {
    source = await resolveSource(repo, values.ref);
  } catch (error) {
    fail((error as Error).message);
  }

  // This is a terminal (checked above), so Ink should draw even when CI is
  // set. Ink reads these once, when it loads; agents still get them after.
  // Ink draws nothing until the end when it thinks it runs in CI.
  const saved = ["CI", "CONTINUOUS_INTEGRATION"].map((name) => [name, process.env[name]] as const);
  for (const [name] of saved) delete process.env[name];
  let runInterface: typeof import("./tui/run.tsx").runInterface;
  try {
    ({ runInterface } = await import("./tui/run.tsx"));
  } finally {
    for (const [name, value] of saved) if (value !== undefined) process.env[name] = value;
  }
  await runInterface({ source, harnesses: detectHarnesses(), background: values.background });
}
