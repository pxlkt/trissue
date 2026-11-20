import type { TextareaRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { BOLD, BrandLabel, ButtonRow, Header, Hints } from "../components.tsx";
import type { Controller } from "../controller.ts";
import type { Theme } from "../theme.ts";

type Zone = "input" | "agents" | "model";
const ZONES: Zone[] = ["input", "agents", "model"];
const MAX_ROWS = 3;
const CHIP_GAP = 1;

export const ISSUE_KEYBINDINGS = [
  { name: "z", ctrl: true, action: "undo" as const },
  { name: "y", ctrl: true, action: "redo" as const },
  { name: "z", ctrl: true, shift: true, action: "redo" as const },
];

export function ComposeScreen(props: { controller: Controller; theme: Theme; product: string; detail: string; inset: number }) {
  const c = props.controller;
  const dims = useTerminalDimensions();
  const [zone, setZone] = createSignal<Zone>("input");
  const [modelIndex, setModelIndex] = createSignal(0);
  let textarea: TextareaRenderable | undefined;

  /** Lays the harness names out in rows that fit the width, like wrapped text. */
  const rows = createMemo(() => {
    const width = Math.max(dims().width - props.inset, 10);
    const out: number[][] = [];
    let row: number[] = [];
    let used = 0;
    c.harnesses.forEach((harness, index) => {
      const chip = harness.name.length + 2;
      if (row.length && used + CHIP_GAP + chip > width) {
        out.push(row);
        row = [];
        used = 0;
      }
      used += (row.length ? CHIP_GAP : 0) + chip;
      row.push(index);
    });
    if (row.length) out.push(row);
    return out;
  });

  const rowOf = (index: number) => rows().findIndex((row) => row.includes(index));
  const visibleRows = createMemo(() => {
    const all = rows();
    const current = Math.max(rowOf(c.harnessIndex()), 0);
    const first = Math.min(Math.max(current - MAX_ROWS + 1, 0), Math.max(all.length - MAX_ROWS, 0));
    return { first, rows: all.slice(first, first + MAX_ROWS), hidden: all.length - Math.min(all.length, MAX_ROWS) };
  });

  function moveZone(step: number) {
    const available = c.harnesses.length ? ZONES : (["input"] as Zone[]);
    const next = available[(available.indexOf(zone()) + step + available.length) % available.length]!;
    setZone(next);
    if (next === "model") void c.prepareSession();
  }

  function moveHarness(dx: number, dy: number) {
    const all = rows();
    const current = c.harnessIndex();
    if (dx) {
      c.selectHarness(Math.min(Math.max(current + dx, 0), c.harnesses.length - 1));
      return;
    }
    const rowIndex = rowOf(current);
    const target = all[rowIndex + dy];
    if (!target) return;
    const column = all[rowIndex]!.indexOf(current);
    c.selectHarness(target[Math.min(column, target.length - 1)]!);
  }

  async function chooseModelOption() {
    if (modelIndex() === 0) {
      await c.start(null);
      return;
    }
    c.setModal({ name: "models" });
    void c.prepareSession();
  }

  useKeyboard((key) => {
    if (c.modal() || c.screen() !== "compose") return;
    if (key.name === "tab") {
      key.preventDefault();
      moveZone(key.shift ? -1 : 1);
      return;
    }
    if (zone() === "agents") {
      if (key.name === "left") moveHarness(-1, 0);
      else if (key.name === "right") moveHarness(1, 0);
      else if (key.name === "up") moveHarness(0, -1);
      else if (key.name === "down") moveHarness(0, 1);
      else if (key.name === "return") moveZone(1);
    } else if (zone() === "model") {
      if (key.name === "left" || key.name === "right") setModelIndex(key.name === "left" ? 0 : 1);
      else if (key.name === "return") void chooseModelOption();
    }
  });

  const sessionLine = () => {
    const state = c.sessionState();
    const harness = c.harness();
    if (!harness || state.status === "idle") return null;
    if (state.status === "starting") return { text: `Starting ${harness.name}…`, color: props.theme.muted };
    if (state.status === "failed") return { text: state.error, color: props.theme.danger };
    const model = state.session.currentModel;
    return { text: model ? `${harness.name} is ready. Its default model is ${model.name}.` : `${harness.name} is ready.`, color: props.theme.muted };
  };

  const hints = (): [string, string][] => {
    if (zone() === "input") return [["tab", "next"], ["enter", "new line"], ["ctrl+c", "quit"]];
    if (zone() === "agents") return [["←→↑↓", "choose agent"], ["tab", "next"], ["shift+tab", "back"], ["ctrl+c", "quit"]];
    return [["←→", "choose"], ["enter", modelIndex() === 0 ? "start" : "select model"], ["shift+tab", "back"], ["ctrl+c", "quit"]];
  };

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <Header theme={props.theme} product={props.product} detail={props.detail} />

      <box flexDirection="column" flexGrow={1} maxHeight={14} minHeight={5}>
        <text fg={props.theme.text} attributes={BOLD} flexShrink={0}>
          {c.config()?.prompt ?? "Explain the issue you're experiencing"}
        </text>
        <box
          border
          borderStyle="single"
          borderColor={zone() === "input" ? props.theme.border : props.theme.faint}
          flexGrow={1}
          paddingX={1}
          marginTop={1}
        >
          <textarea
            ref={(element: TextareaRenderable) => {
              textarea = element;
              if (c.issueText()) element.setText(c.issueText());
            }}
            focused={zone() === "input" && !c.modal()}
            flexGrow={1}
            wrapMode="word"
            placeholder="What went wrong, and what did you expect to happen?"
            placeholderColor={props.theme.faint}
            textColor={props.theme.text}
            focusedTextColor={props.theme.text}
            backgroundColor={props.theme.background}
            focusedBackgroundColor={props.theme.background}
            cursorColor={props.theme.text}
            keyBindings={ISSUE_KEYBINDINGS}
            onContentChange={() => c.setIssueText(textarea?.plainText ?? "")}
          />
        </box>
      </box>

      <box flexDirection="column" flexShrink={0}>
        <text fg={zone() === "agents" ? props.theme.text : props.theme.muted} attributes={BOLD}>
          Agent
        </text>
        <Switch>
          <Match when={c.harnesses.length === 0}>
            <text fg={props.theme.danger}>
              No coding agents are installed. Install Claude Code, Codex, Cursor, Grok, OpenCode, or another ACP agent, then run this again.
            </text>
          </Match>
          <Match when={c.harnesses.length > 0}>
            <box flexDirection="column" marginTop={1}>
              <For each={visibleRows().rows}>
                {(row) => (
                  <box flexDirection="row" columnGap={CHIP_GAP}>
                    <For each={row}>
                      {(index) => (
                        <BrandLabel
                          name={c.harnesses[index]!.name}
                          brand={c.harnesses[index]!.brand}
                          selected={index === c.harnessIndex()}
                          theme={props.theme}
                        />
                      )}
                    </For>
                  </box>
                )}
              </For>
              <Show when={visibleRows().hidden > 0}>
                <text fg={props.theme.faint}>
                  {visibleRows().first > 0 ? "↑ " : ""}
                  {visibleRows().first + MAX_ROWS < rows().length ? "↓ " : ""}more agents
                </text>
              </Show>
            </box>
          </Match>
        </Switch>
      </box>

      <Show when={c.harnesses.length > 0}>
        <box flexDirection="column" flexShrink={0}>
          <text fg={zone() === "model" ? props.theme.text : props.theme.muted} attributes={BOLD}>
            Model
          </text>
          <box marginTop={1}>
            <ButtonRow
              theme={props.theme}
              focused={zone() === "model" && !c.modal()}
              index={modelIndex()}
              items={[{ label: "Use default model", prefix: { text: "✓", color: props.theme.check } }, { label: "Select model" }]}
            />
          </box>
          <Show when={sessionLine()}>{(line) => <text fg={line().color} marginTop={1}>{line().text}</text>}</Show>
        </box>
      </Show>

      <box flexGrow={1} flexDirection="column" justifyContent="flex-end">
        <Hints theme={props.theme} hints={hints()} />
      </box>
    </box>
  );
}
