import { Box, Text } from "ink";
import { useState } from "react";
import { ButtonRow, Header, Hints, Lines, Panel, useMeasure, type Line } from "../components.tsx";
import type { Controller } from "../controller.ts";
import { useKeys } from "../keys.ts";
import { renderMarkdown, wrapSegments } from "../markdown.ts";
import type { Theme } from "../theme.ts";

type Action = { label: string; run: () => void };

/** The written issue, and the ways to send it. */
export function ResultScreen({ controller: c, theme, product, detail, onQuit }: { controller: Controller; theme: Theme; product: string; detail: string; onQuit: () => void }) {
  const [index, setIndex] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [ref, size] = useMeasure();

  const actions: Action[] = [];
  if (c.githubRepo()) actions.push({ label: "File an issue on GitHub", run: () => void c.beginGitHub() });
  actions.push({ label: "Copy issue", run: () => void c.copy() });
  for (const link of c.config()?.links ?? []) actions.push({ label: link.label, run: () => c.chooseLink(link) });
  actions.push({ label: "Quit", run: onQuit });

  const issue = c.issue();
  const width = Math.max(size.width, 1);
  const lines: Line[] = issue ? [...wrapSegments([{ text: issue.title, color: theme.text, bold: true }], width), [], ...renderMarkdown(issue.body, width, theme)] : [];
  const page = Math.max(size.height, 1);
  const maxScroll = Math.max(lines.length - page, 0);
  const top = Math.min(scroll, maxScroll);

  useKeys((key) => {
    if (c.modal() || c.screen() !== "result" || c.busy()) return;
    const scrollBy = (rows: number) => setScroll(Math.min(Math.max(top + rows, 0), maxScroll));
    if (key.name === "left") setIndex((value) => Math.max(value - 1, 0));
    else if (key.name === "right" || key.name === "tab") setIndex((value) => Math.min(value + 1, actions.length - 1));
    else if (key.name === "up") scrollBy(-1);
    else if (key.name === "down") scrollBy(1);
    else if (key.name === "pageup") scrollBy(-(page - 2));
    else if (key.name === "pagedown" || key.name === "space") scrollBy(page - 2);
    else if (key.name === "home") scrollBy(-lines.length);
    else if (key.name === "end") scrollBy(lines.length);
    else if (key.name === "return") actions[index]?.run();
  });

  const busy = c.busy();
  return (
    <Box flexDirection="column" flexGrow={1} gap={1}>
      <Header theme={theme} product={product} detail={detail} />
      <Text color={theme.success} bold>
        ✓ Issue ready
      </Text>
      <Panel borderColor={theme.faint} backgroundColor={theme.background} flexGrow={1} paddingX={2} paddingY={1}>
        <Box ref={ref} flexGrow={1} flexDirection="column" overflow="hidden">
          {size.height > 0 && <Lines lines={lines.slice(top, top + page)} />}
        </Box>
      </Panel>
      <ButtonRow theme={theme} focused={!c.modal()} index={index} items={actions.map((action) => ({ label: action.label }))} />
      {busy ? (
        <Text color={theme.muted}>{busy}</Text>
      ) : (
        <Hints
          theme={theme}
          hints={maxScroll > 0 ? [["←→", "choose"], ["enter", "select"], ["↑↓", "scroll"], ["ctrl+c", "quit"]] : [["←→", "choose"], ["enter", "select"], ["ctrl+c", "quit"]]}
        />
      )}
    </Box>
  );
}

/** What went wrong: an error, a rejection by the agent, or a stop. */
export function ErrorScreen({ controller: c, theme, product, detail, onQuit }: { controller: Controller; theme: Theme; product: string; detail: string; onQuit: () => void }) {
  const [index, setIndex] = useState(0);
  const actions: Action[] = [
    { label: "Try again", run: () => c.tryAgain() },
    { label: "Quit", run: onQuit },
  ];

  useKeys((key) => {
    if (c.modal() || c.screen() !== "error") return;
    if (key.name === "left") setIndex(0);
    else if (key.name === "right" || key.name === "tab") setIndex(1);
    else if (key.name === "return") actions[index]!.run();
  });

  return (
    <Box flexDirection="column" flexGrow={1} gap={1}>
      <Header theme={theme} product={product} detail={detail} />
      <Box flexDirection="column" flexGrow={1} gap={1}>
        <Text color={theme.danger} bold>
          ⚠ {c.error()?.title ?? "Error"}
        </Text>
        <Text color={theme.text}>{c.error()?.message}</Text>
      </Box>
      <ButtonRow theme={theme} focused index={index} items={actions.map((action) => ({ label: action.label }))} />
      <Hints theme={theme} hints={[["←→", "choose"], ["enter", "select"], ["ctrl+c", "quit"]]} />
    </Box>
  );
}
