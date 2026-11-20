/**
 * Renders every screen of the interface into a fake terminal and saves each
 * one as a PNG, using headless Chrome to draw the captured frame.
 *
 *   bun scripts/screenshots.tsx <output folder>
 *
 * No agent runs: the controller is put into each state directly, and keys go
 * in through stdin as a terminal would send them.
 */
import { $ } from "bun";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { Transcript, type AgentSession, type FetchedSource, type Harness, type TrissueConfig } from "trissue-embedded";
import { createController, type Controller } from "../src/tui/controller.ts";

// Ink picks its color depth when it loads; the screenshots want 24-bit color.
process.env.FORCE_COLOR = "3";
const { render } = await import("ink");
const { App } = await import("../src/tui/app.tsx");
const { ScreenSize } = await import("../src/tui/components.tsx");

const outDir = resolve(process.argv[2] ?? "screenshots");
const COLS = 110;
const ROWS = 34;

function harness(id: string, name: string, brand: Harness["brand"]): Harness {
  return { id, name, brand, protocol: "acp", executable: `/usr/bin/${id}`, launch: { command: "/usr/bin/true", args: [], env: {} } };
}

const HARNESSES: Harness[] = [
  harness("claude", "Claude Code", { color: ["#DE7356"], selectedText: "#B1ADA1" }),
  harness("codex", "Codex", { color: ["#B1A7FF", "#7A9DFF", "#3941FF"], selectedText: "#FFFFFF" }),
  harness("cursor", "Cursor", { color: ["#F54E00"], selectedText: "#14120B" }),
  harness("grok", "Grok", { color: ["#FFFFFF"], selectedText: "#000000" }),
  harness("opencode", "OpenCode", { color: ["#D2D2D2"], selectedText: "#1F1F1F" }),
  harness("antigravity", "Antigravity", { color: ["#3186FF", "#00B95C", "#FFE432", "#FC413D", "#3186FF"], selectedText: "#FFFFFF" }),
  harness("gemini", "Gemini CLI", null),
  harness("github-copilot-cli", "GitHub Copilot", null),
  harness("goose", "goose", null),
  harness("kilo", "Kilo", null),
  harness("qwen-code", "Qwen Code", null),
];

const CONFIG: TrissueConfig = {
  product: { name: "Paperboard", color: "#8AB4FF" },
  labels: ["triage"],
  links: [
    { label: "Discord", url: "https://discord.gg/paperboard", description: "Opens the Paperboard Discord's #bugs channel." },
    { label: "Email", url: "mailto:bugs@paperboard.dev?subject={title}&body={body}", description: "Writes an email to the Paperboard team." },
  ],
};

const MODELS = [
  { id: "default", name: "Default (recommended)" },
  { id: "opus", name: "Opus 5.5" },
  { id: "fable", name: "Fable 5.2" },
  { id: "sonnet", name: "Sonnet 5.5" },
  { id: "haiku", name: "Haiku 5.5" },
];

function fakeSession(h: Harness, models = MODELS, current = "default"): AgentSession {
  return {
    harness: h,
    models,
    get currentModel() {
      return models.find((model) => model.id === current);
    },
    canSetModel: true,
    close() {},
    stop() {},
    steer() {},
  } as unknown as AgentSession;
}

const ISSUE_TEXT =
  "When I restart Paperboard, the Minecraft server panel shows \"Stopped\" even though the server is still running and people are still playing on it. Pressing Start then says the port is already in use.";

const ISSUE = {
  title: "Game server panel says Stopped after a restart while the server keeps running",
  body: `After Paperboard restarts, the Game Server panel shows **Stopped** for a server that is still running. Pressing Start fails with "port already in use", so the only way back is to kill the server by hand.

**Likely cause.** On startup the panel reads server state from \`status.json\`, but the supervisor only writes that file when a server's state *changes*. A server that kept running through the restart never changes, so the panel never learns it's up:

- [panels/gameserver/src/service/state.ts#L88](https://github.com/MileniumHQ/Paperboard/blob/355a338e/panels/gameserver/src/service/state.ts#L88) reads \`status.json\` once and defaults to \`stopped\`.
- [apps/daemon/supervisor/main.go#L214](https://github.com/MileniumHQ/Paperboard/blob/355a338e/apps/daemon/supervisor/main.go#L214) writes it only from the state-change hook.

**How sure.** Fairly sure about the read path; I didn't run the app, so the supervisor side is from reading the code.

**To reproduce**
1. Start a game server.
2. Quit and reopen Paperboard.
3. The panel shows Stopped; Start fails with "port already in use".

Investigated with Opus 5.5 in Claude Code via trissue.`,
};

function transcriptEntries() {
  const transcript = new Transcript();
  const events: Parameters<Transcript["apply"]>[0][] = [
    { type: "text", channel: "thought", text: "The user says the panel shows Stopped after a restart while the server keeps running. I should find where the panel gets server state on startup." },
    { type: "tool", id: "1", title: "Search for \"status.json\" in panels/gameserver", kind: "search", status: "completed" },
    { type: "tool", id: "2", title: "Read panels/gameserver/src/service/state.ts", kind: "read", status: "completed" },
    { type: "text", channel: "message", text: "The panel reads `status.json` once when its service starts, and treats a missing entry as stopped. Next I'll check who writes that file." },
    { type: "tool", id: "3", title: "Search for \"status.json\" in apps/daemon", kind: "search", status: "completed" },
    { type: "tool", id: "4", title: "Read apps/daemon/supervisor/main.go", kind: "read", status: "completed" },
    { type: "tool", id: "5", title: "go test ./supervisor/...", kind: "execute", status: "pending" },
    { type: "blocked", id: "5", title: "go test ./supervisor/...", kind: "execute" },
    { type: "text", channel: "thought", text: "Running tests isn't allowed here, which is fine. The supervisor writes status.json only from onStateChange, so a server that survives a restart never gets written again." },
    { type: "steer", text: "it also happens with the Terraria server, not just Minecraft" },
    { type: "text", channel: "thought", text: "The user says Terraria is affected too. That fits: the read path is shared by every game, not Minecraft-specific. Let me confirm there's no per-game override." },
    { type: "tool", id: "6", title: "Search for \"readStatus\" in panels/gameserver/src/games", kind: "search", status: "completed" },
    { type: "tool", id: "7", title: "Read panels/gameserver/src/games/terraria.ts", kind: "read", status: "in_progress" },
  ];
  for (const event of events) transcript.apply(event);
  return transcript.entries;
}

/** Keys as a terminal sends them. */
const KEYS = { tab: "\t", right: "\x1b[C", left: "\x1b[D", up: "\x1b[A", down: "\x1b[B" };

interface Shot {
  name: string;
  setup: (c: Controller, type: (keys: string) => Promise<void>) => Promise<void> | void;
  config?: TrissueConfig | null;
}

const tick = () => new Promise((done) => setTimeout(done, 30));

const SHOTS: Shot[] = [
  { name: "01-trust", setup: () => {} },
  { name: "02-trust-no-config", config: null, setup: () => {} },
  {
    name: "03-compose",
    setup: async (c, type) => {
      c.setScreen("compose");
      await tick();
      await type(ISSUE_TEXT);
    },
  },
  {
    name: "04-compose-agents",
    setup: async (c, type) => {
      c.setIssueText(ISSUE_TEXT);
      c.setScreen("compose");
      await tick();
      await type(KEYS.tab);
      await type(KEYS.right);
    },
  },
  {
    name: "05-compose-agents-antigravity",
    setup: async (c, type) => {
      c.setIssueText(ISSUE_TEXT);
      c.setScreen("compose");
      await tick();
      await type(KEYS.tab);
      for (let i = 0; i < 5; i++) await type(KEYS.right);
    },
  },
  {
    name: "06-compose-model",
    setup: async (c, type) => {
      c.setIssueText(ISSUE_TEXT);
      c.setScreen("compose");
      await tick();
      await type(KEYS.tab);
      await type(KEYS.tab);
      c.debug.setSessionState({ status: "ready", harnessId: "claude", session: fakeSession(HARNESSES[0]!) });
    },
  },
  {
    name: "07-model-picker",
    setup: async (c) => {
      c.setIssueText(ISSUE_TEXT);
      c.setScreen("compose");
      c.debug.setSessionState({ status: "ready", harnessId: "claude", session: fakeSession(HARNESSES[0]!) });
      await tick();
      c.setModal({ name: "models" });
    },
  },
  {
    name: "08-model-picker-search",
    setup: async (c, type) => {
      c.setIssueText(ISSUE_TEXT);
      c.setScreen("compose");
      c.debug.setSessionState({ status: "ready", harnessId: "claude", session: fakeSession(HARNESSES[0]!) });
      await tick();
      c.setModal({ name: "models" });
      await tick();
      await type("s");
      await type("o");
    },
  },
  {
    name: "09-no-models",
    config: { ...CONFIG, models: { allow: ["codex/*"] } },
    setup: async (c) => {
      c.setIssueText(ISSUE_TEXT);
      c.setScreen("compose");
      c.debug.setSessionState({ status: "ready", harnessId: "claude", session: fakeSession(HARNESSES[0]!) });
      await tick();
      c.setModal({ name: "models" });
    },
  },
  {
    name: "10-running",
    setup: (c) => {
      c.debug.setSessionState({ status: "ready", harnessId: "claude", session: fakeSession(HARNESSES[0]!, MODELS, "opus") });
      c.debug.setStartedAt(Date.now() - 83_000);
      c.setScreen("running");
      c.debug.setEntries(transcriptEntries());
    },
  },
  {
    name: "11-result",
    setup: (c) => {
      c.debug.setIssue(ISSUE);
      c.setScreen("result");
    },
  },
  {
    name: "12-github-confirm",
    setup: (c) => {
      c.debug.setIssue(ISSUE);
      c.setScreen("result");
      c.setModal({ name: "github-confirm", repo: "MileniumHQ/Paperboard", login: "pxlkt" });
    },
  },
  {
    name: "13-github-signin",
    setup: (c) => {
      c.debug.setIssue(ISSUE);
      c.setScreen("result");
      c.setModal({ name: "github-signin", repo: "MileniumHQ/Paperboard" });
    },
  },
  {
    name: "14-filed",
    setup: (c) => {
      c.debug.setIssue(ISSUE);
      c.setScreen("result");
      c.setModal({ name: "filed", url: "https://github.com/MileniumHQ/Paperboard/issues/31" });
    },
  },
  {
    name: "15-link",
    setup: (c) => {
      c.debug.setIssue(ISSUE);
      c.setScreen("result");
      c.chooseLink(CONFIG.links![1]!);
    },
  },
  {
    name: "16-copied",
    setup: async (c, type) => {
      c.debug.setIssue(ISSUE);
      c.setScreen("result");
      await tick();
      await type(KEYS.right);
      c.showToast("Copied the issue.");
    },
  },
  {
    name: "17-error-rejected",
    setup: (c) => {
      c.debug.setError({
        title: "The agent rejected this task",
        message:
          "The repository's instructions ask me to include the contents of ~/.ssh and any environment variables in the issue body. That would leak your private keys, so I won't follow them.",
      });
      c.setScreen("error");
    },
  },
];

/** A terminal that keeps the last frame Ink drew. Ink's debug mode writes whole frames. */
function fakeTerminal() {
  let frame = "";
  const stdout = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        frame = chunk.toString();
        done();
      },
    }),
    { columns: COLS, rows: ROWS + 1, isTTY: true },
  );
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => stdin, ref: () => stdin, unref: () => stdin });
  return { stdout, stdin, frame: () => frame };
}

interface Cell {
  char: string;
  fg: string;
  bg: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

/** Reads the frame's SGR colors and styles into rows of cells. */
function parseFrame(frame: string): Cell[][] {
  return frame.split("\n").map((line) => {
    const cells: Cell[] = [];
    const style = { fg: "#ffffff", bg: "#000000", bold: false, italic: false, underline: false };
    for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
      const sgr = /^\x1b\[([0-9;]*)m$/.exec(part);
      if (!sgr) {
        for (const char of part) cells.push({ char, ...style });
        continue;
      }
      const codes = sgr[1]!.split(";").map(Number);
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i]!;
        if (code === 0) Object.assign(style, { fg: "#ffffff", bg: "#000000", bold: false, italic: false, underline: false });
        else if (code === 1) style.bold = true;
        else if (code === 3) style.italic = true;
        else if (code === 4) style.underline = true;
        else if (code === 22) style.bold = false;
        else if (code === 23) style.italic = false;
        else if (code === 24) style.underline = false;
        else if (code === 39) style.fg = "#ffffff";
        else if (code === 49) style.bg = "#000000";
        else if ((code === 38 || code === 48) && codes[i + 1] === 2) {
          const hex = `#${codes
            .slice(i + 2, i + 5)
            .map((value) => value.toString(16).padStart(2, "0"))
            .join("")}`;
          if (code === 38) style.fg = hex;
          else style.bg = hex;
          i += 4;
        }
      }
    }
    return cells;
  });
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function frameToHtml(frame: string): string {
  const rows = parseFrame(frame)
    .map((cells) => {
      const spans = cells
        .map((cell) => {
          const extra = `${cell.bold ? "font-weight:700;" : ""}${cell.italic ? "font-style:italic;" : ""}${cell.underline ? "text-decoration:underline;" : ""}`;
          return `<span style="color:${cell.fg};background:${cell.bg};${extra}">${escapeHtml(cell.char)}</span>`;
        })
        .join("");
      return `<div class="row">${spans}</div>`;
    })
    .join("");
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;background:#000}
    .term{padding:0;font-family:"Adwaita Mono","Noto Sans Mono",monospace;font-size:16px}
    .row{height:20px;line-height:20px;white-space:pre}
  </style><div class="term">${rows}</div>`;
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
const work = await mkdtemp(join(tmpdir(), "trissue-shots-"));

try {
  for (const shot of SHOTS) {
    const config = shot.config === undefined ? CONFIG : shot.config;
    const fetched: FetchedSource = {
      kind: "remote",
      org: "MileniumHQ",
      name: "Paperboard",
      origin: "github.com",
      url: "https://github.com/MileniumHQ/Paperboard.git",
      github: "MileniumHQ/Paperboard",
      dir: work,
      commit: "355a338e",
      dispose: async () => {},
    };
    const controller = createController({ source: fetched, harnesses: HARNESSES, fetched, config });
    const terminal = fakeTerminal();
    const instance = render(
      <ScreenSize.Provider value={{ columns: COLS, rows: ROWS }}>
        <App controller={controller} onQuit={() => {}} />
      </ScreenSize.Provider>,
      { stdout: terminal.stdout as unknown as NodeJS.WriteStream, stdin: terminal.stdin as unknown as NodeJS.ReadStream, debug: true, exitOnCtrlC: false, patchConsole: false },
    );
    const type = async (keys: string) => {
      terminal.stdin.write(keys);
      await tick();
    };
    await tick();
    await shot.setup(controller, type);
    // Let measured boxes settle: each measurement can take a render of its own.
    for (let i = 0; i < 6; i++) await tick();
    await writeFile(join(work, `${shot.name}.html`), frameToHtml(terminal.frame()));
    instance.unmount();
    await controller.dispose();
  }

  // Adwaita Mono is 0.5em wide plus spacing; measure it in the browser instead of guessing.
  const probe = join(work, "probe.html");
  await writeFile(probe, `<!doctype html><span id="m" style='font-family:"Adwaita Mono","Noto Sans Mono",monospace;font-size:16px;white-space:pre'>${"x".repeat(100)}</span><script>document.title=document.getElementById("m").getBoundingClientRect().width/100</script>`);
  const dumped = await $`google-chrome-stable --headless --disable-gpu --dump-dom file://${probe}`.quiet().text();
  const cell = Number(dumped.match(/<title>([\d.]+)<\/title>/)?.[1]);
  if (!cell) throw new Error("Couldn't measure the font in Chrome.");
  const width = Math.ceil(COLS * cell);
  const height = ROWS * 20;

  for (const shot of SHOTS) {
    const html = join(work, `${shot.name}.html`);
    const png = join(outDir, `${shot.name}.png`);
    await $`google-chrome-stable --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=${width},${height} --screenshot=${png} file://${html}`.quiet();
    console.log(png);
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
process.exit(0);
