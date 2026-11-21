# trissue-embedded

The engine behind [trissue](https://github.com/pxlkt/trissue), for apps that
want their own "Report an issue" button. It runs the coding agent already on
the user's computer (Claude Code, Codex, Cursor, Grok, OpenCode, Antigravity,
or any ACP agent), has it investigate the repo read-only, and returns a
written issue. No terminal interface; runs on Node 20+, Bun and Electron.

```sh
npm install trissue-embedded
```

## All at once

```ts
import { runTriage, fileGitHubIssue } from "trissue-embedded";

const { issue, source } = await runTriage({
  repo: "MileniumHQ/Paperboard", // owner/repo, a clone URL, or a folder
  issue: "The server panel says Stopped after a restart",
  harness: "claude",             // optional: defaults to the first installed agent
  onEvent: (event) => console.log(event),
});
await fileGitHubIssue("MileniumHQ/Paperboard", issue);
await source.dispose(); // deletes the downloaded repo
```

## Step by step

```ts
import { buildPrompt, detectHarnesses, fetchSource, loadConfig, parseIssue, resolveSource, startAgent, Transcript } from "trissue-embedded";

const agents = detectHarnesses();                 // installed agents, with brand colors
const source = await fetchSource(await resolveSource("MileniumHQ/Paperboard"));
const config = await loadConfig(source.dir);      // the repo's .trissue.json, or null

const transcript = new Transcript();
const session = await startAgent({ harness: agents[0]!, cwd: source.dir, onEvent: (event) => transcript.apply(event) });
await session.setModel(session.models[0]!.id);    // optional

const text = await session.run(buildPrompt({ issue: "…", source, instructions: config?.instructions, harnessName: session.harness.name }));
const issue = parseIssue(text);                   // throws RejectedError or NoIssueError
session.close();
await source.dispose();
```

While `run` is going, `session.steer(text)` redirects the agent and
`session.stop()` ends it (`run` rejects with `StoppedError`).

Sending: `fileGitHubIssue`, `gitHubStatus`, `copyIssue`, `buildLink` and
`openUrl`. The `.trissue.json` schema ships as
`trissue-embedded/trissue.schema.json`.

Apps opened from the macOS Dock or a Linux desktop menu get a bare PATH, so
trissue looks agents up on the user's login-shell PATH plus the usual install
folders (Homebrew, `~/.local/bin`, …) and runs them with it. `userPath()`
returns that PATH. On Windows the PATH is used as it is.

See the [trissue README](https://github.com/pxlkt/trissue#readme) for the
config file, the agents, and what the agent is allowed to do.

## License

MIT. `dist/adapters/codex.mjs` is the unmodified Codex ACP adapter
(Apache-2.0); see `dist/adapters/THIRD_PARTY_NOTICES.md`.
