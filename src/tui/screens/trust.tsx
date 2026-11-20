import { useKeyboard } from "@opentui/solid";
import { Match, Show, Switch } from "solid-js";
import { CONFIG_FILE } from "../../core/config.ts";
import { BOLD, Hints } from "../components.tsx";
import type { Controller } from "../controller.ts";
import { BASE_THEME } from "../theme.ts";

/**
 * The first screen. It warns before anything from the repository is used, and
 * deliberately ignores the repository's colors and names.
 */
export function TrustScreen(props: { controller: Controller; onQuit: () => void }) {
  const theme = BASE_THEME;
  const source = props.controller.options.source;
  const ready = () => props.controller.fetched() !== null;

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "q") props.onQuit();
    else if (key.name === "return" && ready()) props.controller.setScreen("compose");
  });

  const row = (label: string, value: string) => (
    <text>
      <span style={{ fg: theme.text, bold: true }}>{label}: </span>
      <span style={{ fg: theme.text }}>{value}</span>
    </text>
  );

  return (
    <box flexDirection="column" flexGrow={1} justifyContent="space-between">
      <box flexDirection="column" gap={1}>
        <text fg={theme.danger} attributes={BOLD}>
          This command can prompt an AI agent on your computer. Be sure you trust this repo before running this command.
        </text>
        <box flexDirection="column">
          {row("Repo Organization", source.org || "None")}
          {row("Repo Name", source.name)}
          {row(source.kind === "local" ? "Opened From" : "Downloaded From", source.kind === "local" ? `${source.origin} (${source.url})` : source.origin)}
        </box>
        <Switch>
          <Match when={props.controller.fetchError()}>
            {(error) => <text fg={theme.danger}>{error()}</text>}
          </Match>
          <Match when={!ready()}>
            <text fg={theme.muted}>Downloading the repo…</text>
          </Match>
          <Match when={props.controller.config()}>
            <text fg={theme.muted}>
              This repo has a {CONFIG_FILE}. Its instructions go to the agent, which checks them for anything malicious before following them.
            </text>
          </Match>
          <Match when={ready()}>
            <text fg={theme.muted}>This repo has no trissue configuration, so the defaults are used. Only continue if you trust it.</text>
          </Match>
        </Switch>
      </box>
      <Show when={ready()} fallback={<Hints theme={theme} hints={[["esc", "quit"]]} />}>
        <Hints theme={theme} hints={[["enter", "continue"], ["esc", "quit"]]} />
      </Show>
    </box>
  );
}
