import { spawnSync } from "node:child_process";
import { render, type Instance } from "ink";
import { useEffect, useState } from "react";
import type { Harness, RepoSource } from "trissue-embedded";
import { App } from "./app.tsx";
import { ScreenSize } from "./components.tsx";
import { createController } from "./controller.ts";

const ENTER_ALT_SCREEN = "\x1b[?1049h\x1b[2J\x1b[H";
const LEAVE_ALT_SCREEN = "\x1b[?1049l";
const SHOW_CURSOR = "\x1b[?25h";

/**
 * The size the interface draws at. Ink clears the whole terminal on every
 * frame once its output reaches the last row, which flickers, so the
 * interface stops one row short of it.
 */
function terminalSize() {
  return { columns: Math.max(process.stdout.columns || 80, 20), rows: Math.max((process.stdout.rows || 24) - 1, 8) };
}

function Root({ children }: { children: React.ReactNode }) {
  const [size, setSize] = useState(terminalSize);
  useEffect(() => {
    const onResize = () => setSize(terminalSize());
    process.stdout.on("resize", onResize);
    return () => void process.stdout.off("resize", onResize);
  }, []);
  return <ScreenSize.Provider value={size}>{children}</ScreenSize.Provider>;
}

/** Copies through the terminal (OSC 52), for when there's no clipboard command. */
function copyThroughTerminal(text: string): boolean {
  if (!process.stdout.isTTY) return false;
  process.stdout.write(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`);
  return true;
}

/** Runs the full-screen interface until the user quits. */
export async function runInterface(options: { source: RepoSource; harnesses: Harness[]; background?: string }) {
  let instance: Instance | null = null;
  let onScreen = false;
  const enter = () => {
    process.stdout.write(ENTER_ALT_SCREEN);
    onScreen = true;
  };
  const leave = () => {
    if (!onScreen) return;
    onScreen = false;
    process.stdout.write(LEAVE_ALT_SCREEN + SHOW_CURSOR);
  };
  // However the process ends, the terminal gets its normal screen back.
  process.once("exit", leave);

  const controller = createController({
    ...options,
    runInTerminal: async (command, args) => {
      // Let the key press that asked for this finish first.
      await new Promise((resolve) => setImmediate(resolve));
      unmount();
      leave();
      try {
        return spawnSync(command, args, { stdio: "inherit" }).status ?? 1;
      } finally {
        mount();
      }
    },
    copyFallback: copyThroughTerminal,
  });

  let quitting = false;
  const quit = async () => {
    if (quitting) return;
    quitting = true;
    try {
      await controller.dispose();
    } finally {
      unmount();
      leave();
      process.exit(0);
    }
  };
  // Not `once`: signal-exit (used by Ink) re-sends the signal when it finds no
  // other listener, and a `once` listener is gone by the time it looks.
  for (const signal of ["SIGTERM", "SIGHUP"] as const) process.on(signal, () => void quit());

  function mount() {
    enter();
    instance = render(
      <Root>
        <App controller={controller} onQuit={() => void quit()} />
      </Root>,
      { exitOnCtrlC: false, patchConsole: true, maxFps: 30 },
    );
  }

  function unmount() {
    instance?.clear();
    instance?.unmount();
    instance = null;
  }

  mount();
}
