# trissue

Have the coding agent already on your computer find the source of an issue and
write it up, then file it, copy it, or send it wherever the project wants.

```sh
bunx trissue MileniumHQ/Paperboard
```

1. trissue downloads the repo and warns you before anything else: an agent is
   about to read it, so you should trust it.
2. You explain the issue.
3. You pick an agent and a model. Only agents installed on your computer are
   listed.
4. The agent investigates the repo, read-only, and writes the issue. You can
   steer it while it works, or press `esc` to stop.
5. You file the issue on GitHub, copy it, or open one of the project's links.

## Agents

trissue talks to agents over the [Agent Client Protocol](https://agentclientprotocol.com).
It runs the agents you have installed and never downloads one.

| Agent | Detected by | Runs |
|---|---|---|
| Claude Code | `claude` | the bundled Claude ACP adapter, with your `claude` |
| Codex | `codex` | the bundled Codex ACP adapter, with your `codex` |
| Cursor | `cursor-agent` | `cursor-agent acp` |
| Grok | `grok` | `grok agent stdio` |
| OpenCode | `opencode` | `opencode acp` |
| Antigravity | `agy_acp_server.par` | `agy_acp_server.par` |
| Everything else in the ACP registry | its program | its ACP command |

The Claude and Codex adapters are bundled as single files (about 5 MB), so
installing trissue doesn't also install a second copy of each CLI. The registry
list is a snapshot in `src/core/registry.json`; `bun run update-registry`
refreshes it.

### What the agent can do

The agent may read and search the repo. trissue refuses every permission
request to edit, delete, move, run, or fetch. Agents that have a read-only mode
(Codex) start in it. The prompt also says the repo's instructions are
untrusted: the agent checks them first and rejects the task if they ask for
anything beyond writing the issue.

## Configuring a repo

Put a `.trissue.json` at the repo root. Every field is optional.

```json
{
  "$schema": "https://raw.githubusercontent.com/pxlkt/trissue/main/trissue.schema.json",
  "product": { "name": "Paperboard", "color": "#8AB4FF" },
  "background": "#000000",
  "prompt": "Explain the issue you're experiencing",
  "instructions": "How issues for this project should be written…",
  "models": { "allow": ["claude/*", "codex/*"], "block": ["*haiku*"] },
  "checkmark": "green",
  "github": "MileniumHQ/Paperboard",
  "labels": ["triage"],
  "links": [
    { "label": "Discord", "url": "https://discord.gg/example", "description": "Opens the #bugs channel." },
    { "label": "Email", "url": "mailto:bugs@example.com?subject={title}&body={body}" }
  ]
}
```

- `instructions` replaces the default issue-writing guide (adapted from
  [t3dotgg/tstack](https://github.com/t3dotgg/tstack)). It only shapes how the
  issue is written; the agent is told to reject anything else.
- `models` patterns match `agent/model` (`claude/opus`) or, without a slash,
  the model id alone. `allow` narrows, `block` removes.
- `github` defaults to the repo itself when it's on github.com. `false` hides
  GitHub filing.
- `links` open in the browser or mail app. `{title}`, `{body}` and `{issue}`
  become the URL-encoded issue.

Brand colors of agents can't be configured.

## Without the interface

Everything can be passed as arguments:

```sh
trissue MileniumHQ/Paperboard --issue "The server panel says Stopped after a restart" \
  --agent claude --model opus --send github --yes
```

`--send` is `print` (default), `json`, `copy`, `github` (needs `--yes`), or
`link:<label>`. `--issue -` reads the issue from stdin. `trissue --list-agents`
lists what's installed.

## In an app

```ts
import { runTriage, detectHarnesses, fileGitHubIssue } from "trissue";

const agents = detectHarnesses(); // for your own picker
const { issue, source } = await runTriage({
  repo: "MileniumHQ/Paperboard",
  issue: "The server panel says Stopped after a restart",
  harness: agents[0]?.id,
  onEvent: (event) => render(event), // thinking, messages, tool calls
});
await fileGitHubIssue("MileniumHQ/Paperboard", issue);
await source.dispose();
```

For a step-by-step UI (pick a model after the agent starts, steer, stop), use
`AgentSession` directly; `Transcript` turns its events into rows. The library
runs on Node, Bun and Electron.

## Development

```sh
bun install
bun run build:adapters   # once, before running from source
bun start <repo>         # the interface
bun run screenshots      # renders every screen to screenshots/
bun run typecheck
```

The interface is built with [OpenTUI](https://github.com/anomalyco/opentui)
and Solid, and needs Bun 1.3.14 or newer.
