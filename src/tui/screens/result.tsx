import { SyntaxStyle, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/solid";
import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import { BOLD, ButtonRow, Header, Hints } from "../components.tsx";
import type { Controller } from "../controller.ts";
import type { Theme } from "../theme.ts";

type Action = { label: string; run: () => void };

function markdownStyle(theme: Theme, owner: Parameters<typeof SyntaxStyle.fromStyles>[1]): SyntaxStyle {
  const text = { fg: theme.text };
  return SyntaxStyle.fromStyles(
    {
      default: text,
      conceal: { fg: theme.faint },
      "markup.heading": { fg: theme.text, bold: true },
      "markup.heading.1": { fg: theme.text, bold: true },
      "markup.heading.2": { fg: theme.text, bold: true },
      "markup.heading.3": { fg: theme.text, bold: true },
      "markup.strong": { fg: theme.text, bold: true },
      "markup.italic": { fg: theme.text, italic: true },
      "markup.strikethrough": { fg: theme.muted, dim: true },
      "markup.raw": { fg: theme.product === theme.text ? theme.muted : theme.product },
      "markup.raw.block": { fg: theme.muted },
      "markup.link": { fg: theme.muted, underline: true },
      "markup.link.url": { fg: theme.muted, underline: true },
      "markup.link.label": { fg: theme.text, underline: true },
      "markup.list": { fg: theme.muted },
      "markup.quote": { fg: theme.muted, italic: true },
      "punctuation.special": { fg: theme.faint },
    },
    owner,
  );
}

/** The written issue, and the ways to send it. */
export function ResultScreen(props: { controller: Controller; theme: Theme; product: string; detail: string; onQuit: () => void }) {
  const c = props.controller;
  const renderer = useRenderer();
  const style = markdownStyle(props.theme, renderer.nativeScene);
  onCleanup(() => style.destroy?.());
  const [index, setIndex] = createSignal(0);
  let scroll: ScrollBoxRenderable | undefined;

  const actions = createMemo<Action[]>(() => {
    const list: Action[] = [];
    if (c.githubRepo()) list.push({ label: "File an issue on GitHub", run: () => void c.beginGitHub() });
    list.push({ label: "Copy issue", run: () => void c.copy() });
    for (const link of c.config()?.links ?? []) list.push({ label: link.label, run: () => c.chooseLink(link) });
    list.push({ label: "Quit", run: props.onQuit });
    return list;
  });

  useKeyboard((key) => {
    if (c.modal() || c.screen() !== "result" || c.busy()) return;
    if (key.name === "left") setIndex((value) => Math.max(value - 1, 0));
    else if (key.name === "right" || key.name === "tab") setIndex((value) => Math.min(value + 1, actions().length - 1));
    else if (key.name === "up") scroll?.scrollBy(-1);
    else if (key.name === "down") scroll?.scrollBy(1);
    else if (key.name === "pageup") scroll?.scrollBy(-(scroll.height - 2));
    else if (key.name === "pagedown" || key.name === "space") scroll?.scrollBy(scroll.height - 2);
    else if (key.name === "return") actions()[index()]?.run();
  });

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <Header theme={props.theme} product={props.product} detail={props.detail} />
      <text fg={props.theme.success} attributes={BOLD}>
        ✓ Issue ready
      </text>
      <box border borderStyle="single" borderColor={props.theme.faint} flexGrow={1} paddingX={2} paddingY={1}>
        <scrollbox ref={(element: ScrollBoxRenderable) => (scroll = element)} flexGrow={1} scrollY stickyScroll={false} verticalScrollbarOptions={{ visible: false }}>
          <text fg={props.theme.text} attributes={BOLD} marginBottom={1}>
            {c.issue()?.title}
          </text>
          <markdown content={c.issue()?.body ?? ""} syntaxStyle={style} fg={props.theme.text} conceal />
        </scrollbox>
      </box>
      <ButtonRow theme={props.theme} focused={!c.modal()} index={index()} items={actions().map((action) => ({ label: action.label }))} />
      <Show when={c.busy()} fallback={<Hints theme={props.theme} hints={[["←→", "choose"], ["enter", "select"], ["↑↓", "scroll"], ["ctrl+c", "quit"]]} />}>
        {(busy) => <text fg={props.theme.muted}>{busy()}</text>}
      </Show>
    </box>
  );
}

/** What went wrong: an error, a rejection by the agent, or a stop. */
export function ErrorScreen(props: { controller: Controller; theme: Theme; product: string; detail: string; onQuit: () => void }) {
  const c = props.controller;
  const [index, setIndex] = createSignal(0);
  const actions: Action[] = [
    { label: "Try again", run: () => c.tryAgain() },
    { label: "Quit", run: props.onQuit },
  ];

  useKeyboard((key) => {
    if (c.modal() || c.screen() !== "error") return;
    if (key.name === "left") setIndex(0);
    else if (key.name === "right" || key.name === "tab") setIndex(1);
    else if (key.name === "return") actions[index()]!.run();
  });

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <Header theme={props.theme} product={props.product} detail={props.detail} />
      <box flexDirection="column" flexGrow={1} gap={1}>
        <text fg={props.theme.danger} attributes={BOLD}>
          ⚠ {c.error()?.title ?? "Error"}
        </text>
        <text fg={props.theme.text}>{c.error()?.message}</text>
      </box>
      <ButtonRow theme={props.theme} focused index={index()} items={actions.map((action) => ({ label: action.label }))} />
      <Hints theme={props.theme} hints={[["←→", "choose"], ["enter", "select"], ["ctrl+c", "quit"]]} />
    </box>
  );
}
