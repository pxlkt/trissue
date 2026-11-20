import { useKeyboard } from "@opentui/solid";
import { createMemo, Match, Show, Switch } from "solid-js";
import { BOLD } from "./components.tsx";
import type { Controller } from "./controller.ts";
import { Modals } from "./modals.tsx";
import { ComposeScreen } from "./screens/compose.tsx";
import { ErrorScreen, ResultScreen } from "./screens/result.tsx";
import { RunningScreen } from "./screens/running.tsx";
import { TrustScreen } from "./screens/trust.tsx";
import { BASE_THEME, themeFor } from "./theme.ts";

/** Columns the frame takes from the terminal width: border and padding on both sides. */
const FRAME_INSET = 2 + 4;

export function App(props: { controller: Controller; onQuit: () => void }) {
  const c = props.controller;
  const trusted = () => c.screen() !== "trust";
  // Nothing from the repository styles the trust screen.
  const theme = createMemo(() => (trusted() ? themeFor(c.config(), { background: c.options.background }) : BASE_THEME));
  const product = () => c.config()?.product?.name ?? c.options.source.name;
  const detail = () => {
    const source = c.options.source;
    return source.org ? `${source.org}/${source.name}` : source.name;
  };

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      key.preventDefault();
      props.onQuit();
    }
  });

  return (
    <box width="100%" height="100%" backgroundColor={theme().background}>
      <box
        width="100%"
        height="100%"
        border
        borderStyle="single"
        borderColor={theme().border}
        backgroundColor={theme().background}
        paddingX={2}
        paddingY={1}
        flexDirection="column"
      >
        <Switch>
          <Match when={c.screen() === "trust"}>
            <TrustScreen controller={c} onQuit={props.onQuit} />
          </Match>
          <Match when={c.screen() === "compose"}>
            <ComposeScreen controller={c} theme={theme()} product={product()} detail={detail()} inset={FRAME_INSET} />
          </Match>
          <Match when={c.screen() === "running"}>
            <RunningScreen controller={c} theme={theme()} product={product()} detail={detail()} />
          </Match>
          <Match when={c.screen() === "result"}>
            <ResultScreen controller={c} theme={theme()} product={product()} detail={detail()} onQuit={props.onQuit} />
          </Match>
          <Match when={c.screen() === "error"}>
            <ErrorScreen controller={c} theme={theme()} product={product()} detail={detail()} onQuit={props.onQuit} />
          </Match>
        </Switch>
      </box>
      <Show when={c.toast()}>
        {(toast) => (
          <box
            position="absolute"
            bottom={0}
            right={3}
            maxWidth="70%"
            zIndex={50}
            paddingX={1}
            backgroundColor={toast().tone === "danger" ? theme().danger : theme().success}
          >
            <text fg={theme().background} attributes={BOLD}>
              {`${toast().tone === "danger" ? "⚠" : "✓"} ${toast().text}`}
            </text>
          </box>
        )}
      </Show>
      <Show when={c.modal()}>
        <Modals controller={c} theme={theme()} />
      </Show>
    </box>
  );
}
