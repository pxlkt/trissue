import { useKeyboard } from "@opentui/solid";
import { createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js";
import { linkIncludesIssue } from "../core/send.ts";
import { BOLD, ButtonRow, Hints, Modal } from "./components.tsx";
import type { Controller, Modal as ModalState } from "./controller.ts";
import type { Theme } from "./theme.ts";

const LIST_ROWS = 8;

/** Picks a model, then starts the investigation with it. */
function ModelPicker(props: { controller: Controller; theme: Theme }) {
  const c = props.controller;
  const [query, setQuery] = createSignal("");
  const [index, setIndex] = createSignal(0);

  const session = () => {
    const state = c.sessionState();
    return state.status === "ready" ? state.session : null;
  };
  const allowed = createMemo(() => {
    const ready = session();
    return ready ? c.allowedModels(ready) : [];
  });
  const matches = createMemo(() => {
    const words = query().toLowerCase().split(/\s+/).filter(Boolean);
    return allowed().filter((model) => words.every((word) => `${model.name} ${model.id}`.toLowerCase().includes(word)));
  });
  const windowStart = () => Math.min(Math.max(index() - LIST_ROWS + 1, 0), Math.max(matches().length - LIST_ROWS, 0));

  useKeyboard((key) => {
    if (key.name === "escape") {
      key.preventDefault();
      c.setModal(null);
    } else if (key.name === "up") setIndex((value) => Math.max(value - 1, 0));
    else if (key.name === "down") setIndex((value) => Math.min(value + 1, Math.max(matches().length - 1, 0)));
    else if (key.name === "return") {
      const model = matches()[index()];
      if (model) void c.start(model.id);
    }
  });

  const harnessName = () => c.harness()?.name ?? "The agent";
  const filter = () => c.config()?.models;

  return (
    <Modal theme={props.theme} title="Select model" width={60}>
      <Switch>
        <Match when={c.sessionState().status === "starting"}>
          <text fg={props.theme.muted}>Starting {harnessName()}…</text>
        </Match>
        <Match when={(() => { const state = c.sessionState(); return state.status === "failed" ? state.error : null; })()}>
          {(error) => <text fg={props.theme.danger}>{error()}</text>}
        </Match>
        <Match when={session() && session()!.models.length === 0}>
          <text fg={props.theme.text}>{harnessName()} doesn't list its models. Use its default model instead.</text>
        </Match>
        <Match when={session() && allowed().length === 0}>
          <box flexDirection="column" gap={1}>
            <text fg={props.theme.danger} attributes={BOLD}>
              No models are available
            </text>
            <text fg={props.theme.text}>This repo doesn't allow any of {harnessName()}'s models. Choose another agent.</text>
            <Show when={filter()?.allow?.length}>
              <text fg={props.theme.muted}>Allowed: {filter()!.allow!.join(", ")}</text>
            </Show>
            <Show when={filter()?.block?.length}>
              <text fg={props.theme.muted}>Blocked: {filter()!.block!.join(", ")}</text>
            </Show>
          </box>
        </Match>
        <Match when={session()}>
          <box flexDirection="column" gap={1}>
            <box border borderStyle="single" borderColor={props.theme.border} paddingX={1} height={3}>
              <input
                focused
                placeholder="Search"
                placeholderColor={props.theme.faint}
                textColor={props.theme.text}
                focusedTextColor={props.theme.text}
                backgroundColor={props.theme.background}
                focusedBackgroundColor={props.theme.background}
                cursorColor={props.theme.text}
                onInput={(value: string) => {
                  setQuery(value);
                  setIndex(0);
                }}
              />
            </box>
            <box flexDirection="column" height={LIST_ROWS}>
              <Show when={matches().length > 0} fallback={<text fg={props.theme.muted}>No models match "{query()}".</text>}>
                <For each={matches().slice(windowStart(), windowStart() + LIST_ROWS)}>
                  {(model, offset) => {
                    const active = () => windowStart() + offset() === index();
                    const isDefault = () => model.id === session()?.currentModel?.id;
                    return (
                      <box flexDirection="row" justifyContent="space-between" backgroundColor={active() ? props.theme.focus : props.theme.background} paddingX={1}>
                        <text fg={active() ? props.theme.background : props.theme.text} attributes={active() ? BOLD : 0}>
                          {model.name}
                        </text>
                        <text fg={active() ? props.theme.background : props.theme.faint}>{isDefault() ? "default" : model.id}</text>
                      </box>
                    );
                  }}
                </For>
              </Show>
            </box>
          </box>
        </Match>
      </Switch>
      <Hints theme={props.theme} hints={session() && allowed().length ? [["↑↓", "choose"], ["enter", "start"], ["esc", "close"]] : [["esc", "close"]]} />
    </Modal>
  );
}

/** A dialog with a message and a row of buttons. */
function Confirm(props: { theme: Theme; title: string; children: JSX.Element; buttons: { label: string; run: () => void }[]; onClose: () => void }) {
  const [index, setIndex] = createSignal(0);
  useKeyboard((key) => {
    if (key.name === "escape") {
      key.preventDefault();
      props.onClose();
    } else if (key.name === "left") setIndex((value) => Math.max(value - 1, 0));
    else if (key.name === "right" || key.name === "tab") setIndex((value) => Math.min(value + 1, props.buttons.length - 1));
    else if (key.name === "return") props.buttons[index()]?.run();
  });
  return (
    <Modal theme={props.theme} title={props.title}>
      <box flexDirection="column" gap={1}>
        {props.children}
      </box>
      <ButtonRow theme={props.theme} focused index={index()} items={props.buttons.map((button) => ({ label: button.label }))} />
    </Modal>
  );
}

function shorten(url: string, max = 120): string {
  return url.length > max ? `${url.slice(0, max - 1)}…` : url;
}

export function Modals(props: { controller: Controller; theme: Theme }) {
  const c = props.controller;
  const close = () => c.setModal(null);
  const is = <N extends ModalState["name"]>(name: N) => {
    const modal = c.modal();
    return modal?.name === name ? (modal as Extract<ModalState, { name: N }>) : null;
  };

  return (
    <Switch>
      <Match when={is("models")}>
        <ModelPicker controller={c} theme={props.theme} />
      </Match>
      <Match when={is("github-confirm")}>
        {(modal) => (
          <Confirm
            theme={props.theme}
            title="File an issue on GitHub?"
            onClose={close}
            buttons={[
              { label: "File issue", run: () => void c.fileOnGitHub(modal().repo) },
              { label: "Cancel", run: close },
            ]}
          >
            <text fg={props.theme.text}>
              This runs <span style={{ bold: true }}>gh issue create</span> and posts the issue to{" "}
              <span style={{ bold: true }}>{modal().repo}</span> as <span style={{ bold: true }}>@{modal().login}</span>.
            </text>
            <text fg={props.theme.muted}>Issues on public repos can be read by anyone.</text>
          </Confirm>
        )}
      </Match>
      <Match when={is("github-signin")}>
        {(modal) => (
          <Confirm
            theme={props.theme}
            title="Sign in to GitHub"
            onClose={close}
            buttons={[
              { label: "Sign in", run: () => void c.signInToGitHub() },
              { label: "Cancel", run: close },
            ]}
          >
            <text fg={props.theme.text}>Filing an issue needs the GitHub CLI signed in.</text>
            <text fg={props.theme.muted}>
              Sign in hands this terminal to <span style={{ fg: props.theme.text }}>gh auth login</span>, which opens GitHub in your browser. You come back here when it's done.
            </text>
          </Confirm>
        )}
      </Match>
      <Match when={is("github-missing")}>
        <Confirm
          theme={props.theme}
          title="The GitHub CLI isn't installed"
          onClose={close}
          buttons={[
            { label: "Open cli.github.com", run: () => void c.open("https://cli.github.com") },
            { label: "Close", run: close },
          ]}
        >
          <text fg={props.theme.text}>Filing an issue uses the GitHub CLI (gh). Install it, then choose File an issue on GitHub again.</text>
        </Confirm>
      </Match>
      <Match when={is("filed")}>
        {(modal) => (
          <Confirm
            theme={props.theme}
            title="Issue filed"
            onClose={close}
            buttons={[
              { label: "Open issue", run: () => void c.open(modal().url) },
              { label: "Done", run: close },
            ]}
          >
            <text fg={props.theme.text}>{modal().url}</text>
          </Confirm>
        )}
      </Match>
      <Match when={is("link")}>
        {(modal) => (
          <Confirm
            theme={props.theme}
            title={`Open ${modal().link.label}?`}
            onClose={close}
            buttons={[
              { label: "Open link", run: () => void c.open(modal().url) },
              { label: "Cancel", run: close },
            ]}
          >
            <Show when={modal().link.description}>
              <text fg={props.theme.text}>{modal().link.description}</text>
            </Show>
            <text fg={props.theme.text}>
              {linkIncludesIssue(modal().link) ? "The link includes the issue's title and text." : "The link doesn't include the issue. Copy it first if you want to paste it there."}
            </text>
            <text fg={props.theme.muted}>{shorten(modal().url)}</text>
          </Confirm>
        )}
      </Match>
    </Switch>
  );
}
