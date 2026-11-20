import { Box, Text } from "ink";
import { useState } from "react";
import { BrandLabel, ButtonRow, Header, Hints, Panel, useFrameSize } from "../components.tsx";
import type { Controller } from "../controller.ts";
import { useKeys } from "../keys.ts";
import { TextArea } from "../textarea.tsx";
import type { Theme } from "../theme.ts";
import { wrap } from "../wrap.ts";

type Zone = "input" | "agents" | "model";
const ZONES: Zone[] = ["input", "agents", "model"];
const MAX_ROWS = 3;
const CHIP_GAP = 1;
/** Rows the issue box may take, border included. */
const INPUT_ROWS = { min: 3, max: 12 };

/** Lays the harness names out in rows that fit the width, like wrapped text. */
export function chipRows(names: string[], width: number): number[][] {
  const out: number[][] = [];
  let row: number[] = [];
  let used = 0;
  names.forEach((name, index) => {
    const chip = name.length + 2;
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
}

export function ComposeScreen({ controller: c, theme, product, detail }: { controller: Controller; theme: Theme; product: string; detail: string }) {
  const frame = useFrameSize();
  const [zone, setZone] = useState<Zone>("input");
  const [modelIndex, setModelIndex] = useState(0);
  const hasAgents = c.harnesses.length > 0;

  const rows = chipRows(
    c.harnesses.map((harness) => harness.name),
    frame.width,
  );
  const rowOf = (index: number) => rows.findIndex((row) => row.includes(index));
  const current = Math.max(rowOf(c.harnessIndex()), 0);
  const first = Math.min(Math.max(current - MAX_ROWS + 1, 0), Math.max(rows.length - MAX_ROWS, 0));
  const visible = rows.slice(first, first + MAX_ROWS);
  const hidden = rows.length - visible.length;

  function moveZone(step: number) {
    const available = hasAgents ? ZONES : (["input"] as Zone[]);
    const next = available[(available.indexOf(zone) + step + available.length) % available.length]!;
    setZone(next);
    if (next === "model") void c.prepareSession();
  }

  function moveHarness(dx: number, dy: number) {
    const index = c.harnessIndex();
    if (dx) {
      c.selectHarness(Math.min(Math.max(index + dx, 0), c.harnesses.length - 1));
      return;
    }
    const rowIndex = rowOf(index);
    const target = rows[rowIndex + dy];
    if (!target) return;
    const column = rows[rowIndex]!.indexOf(index);
    c.selectHarness(target[Math.min(column, target.length - 1)]!);
  }

  async function chooseModelOption() {
    if (modelIndex === 0) {
      await c.start(null);
      return;
    }
    c.setModal({ name: "models" });
    void c.prepareSession();
  }

  useKeys((key) => {
    if (c.modal() || c.screen() !== "compose") return;
    if (key.name === "tab") {
      moveZone(key.shift ? -1 : 1);
      return;
    }
    if (zone === "agents") {
      if (key.name === "left") moveHarness(-1, 0);
      else if (key.name === "right") moveHarness(1, 0);
      else if (key.name === "up") moveHarness(0, -1);
      else if (key.name === "down") moveHarness(0, 1);
      else if (key.name === "return") moveZone(1);
    } else if (zone === "model") {
      if (key.name === "left" || key.name === "right") setModelIndex(key.name === "left" ? 0 : 1);
      else if (key.name === "return") void chooseModelOption();
    }
  });

  const sessionLine = (() => {
    const state = c.sessionState();
    const harness = c.harness();
    if (!harness || state.status === "idle") return null;
    if (state.status === "starting") return { text: `Starting ${harness.name}…`, color: theme.muted };
    if (state.status === "failed") return { text: state.error, color: theme.danger };
    const model = state.session.currentModel;
    return { text: model ? `${harness.name} is ready. Its default model is ${model.name}.` : `${harness.name} is ready.`, color: theme.muted };
  })();

  const hints: [string, string][] =
    zone === "input"
      ? [["tab", "next"], ["enter", "new line"], ["ctrl+c", "quit"]]
      : zone === "agents"
        ? [["←→↑↓", "choose agent"], ["tab", "next"], ["shift+tab", "back"], ["ctrl+c", "quit"]]
        : [["←→", "choose"], ["enter", modelIndex === 0 ? "start" : "select model"], ["shift+tab", "back"], ["ctrl+c", "quit"]];

  const noAgents = "No coding agents are installed. Install Claude Code, Codex, Cursor, Grok, OpenCode, or another ACP agent, then run this again.";
  const prompt = c.config()?.prompt ?? "Explain the issue you're experiencing";
  // Everything below the issue box keeps its size; the box takes what's left, within limits.
  const promptRows = wrap(prompt, frame.width).length;
  const agentRows = 2 + (hasAgents ? visible.length + (hidden > 0 ? 1 : 0) : wrap(noAgents, frame.width).length);
  const modelRows = hasAgents ? 3 + 2 : 0;
  const gaps = hasAgents ? 4 : 3;
  const free = frame.height - 1 - gaps - promptRows - 1 - agentRows - modelRows - 1;
  const inputRows = Math.min(Math.max(free, INPUT_ROWS.min), INPUT_ROWS.max);

  return (
    <Box flexDirection="column" flexGrow={1} gap={1}>
      <Header theme={theme} product={product} detail={detail} />

      <Box flexDirection="column" flexShrink={0}>
        <Text color={theme.text} bold>
          {prompt}
        </Text>
        <Panel borderColor={zone === "input" ? theme.border : theme.faint} backgroundColor={theme.background} height={inputRows} marginTop={1} paddingX={1}>
          <TextArea
            value={c.issueText()}
            onChange={c.setIssueText}
            theme={theme}
            focused={zone === "input" && !c.modal()}
            height={Math.max(inputRows - 2, 1)}
            placeholder="What went wrong, and what did you expect to happen?"
          />
        </Panel>
      </Box>

      <Box flexDirection="column" flexShrink={0}>
        <Text color={zone === "agents" ? theme.text : theme.muted} bold>
          Agent
        </Text>
        {hasAgents ? (
          <Box flexDirection="column" marginTop={1}>
            {visible.map((row) => (
              <Box key={row[0]} flexDirection="row" columnGap={CHIP_GAP}>
                {row.map((index) => (
                  <BrandLabel key={index} name={c.harnesses[index]!.name} brand={c.harnesses[index]!.brand} selected={index === c.harnessIndex()} theme={theme} />
                ))}
              </Box>
            ))}
            {hidden > 0 && (
              <Text color={theme.faint}>
                {first > 0 ? "↑ " : ""}
                {first + MAX_ROWS < rows.length ? "↓ " : ""}more agents
              </Text>
            )}
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text color={theme.danger}>{noAgents}</Text>
          </Box>
        )}
      </Box>

      {hasAgents && (
        <Box flexDirection="column" flexShrink={0}>
          <Text color={zone === "model" ? theme.text : theme.muted} bold>
            Model
          </Text>
          <Box marginTop={1}>
            <ButtonRow
              theme={theme}
              focused={zone === "model" && !c.modal()}
              index={modelIndex}
              items={[{ label: "Use default model", prefix: { text: "✓", color: theme.check } }, { label: "Select model" }]}
            />
          </Box>
          <Box marginTop={1}>
            <Text color={sessionLine?.color ?? theme.muted} wrap="truncate-end">
              {sessionLine?.text ?? " "}
            </Text>
          </Box>
        </Box>
      )}

      <Box flexGrow={1} flexDirection="column" justifyContent="flex-end">
        <Hints theme={theme} hints={hints} />
      </Box>
    </Box>
  );
}
