import { Box } from "ink";
import { useEffect, useState } from "react";
import type { TranscriptEntry } from "trissue-embedded";
import { Header, Hints, Lines, Panel, Spinner, useMeasure, type Line } from "../components.tsx";
import type { Controller } from "../controller.ts";
import { useKeys } from "../keys.ts";
import { TextArea } from "../textarea.tsx";
import { mix, type Theme } from "../theme.ts";
import { wrap } from "../wrap.ts";

const ISSUE_MARKER = /<trissue-(issue|rejected)>[\s\S]*$/;

/** The share of the area, from the bottom, that stays at full brightness. */
const BRIGHT_SHARE = 0.35;
/** How bright the top line is, from 0 (background) to 1. */
const TOP_BRIGHTNESS = 0.18;

function entryLines(entry: TranscriptEntry, width: number, theme: Theme): Line[] {
  switch (entry.kind) {
    case "thought":
      return wrap(entry.text.trim(), width - 2).map((line) => [{ text: `  ${line}`, color: theme.muted, italic: true }]);
    case "message": {
      const visible = entry.text.replace(ISSUE_MARKER, "").trim();
      const lines = visible ? wrap(visible, width).map((line): Line => [{ text: line, color: theme.text }]) : [];
      if (ISSUE_MARKER.test(entry.text)) lines.push([{ text: "Writing the issue…", color: theme.text, bold: true }]);
      return lines;
    }
    case "tool": {
      const glyph = entry.status === "completed" ? "✓" : entry.status === "failed" ? "✗" : "›";
      const glyphColor = entry.status === "completed" ? theme.success : entry.status === "failed" ? theme.danger : theme.muted;
      return wrap(entry.text, width - 2).map((line, index) => [
        { text: index === 0 ? `${glyph} ` : "  ", color: glyphColor },
        { text: line, color: theme.muted },
      ]);
    }
    case "blocked":
      return wrap(entry.text, width - 10).map((line, index) => [
        { text: index === 0 ? "⊘ Blocked " : "          ", color: theme.danger, bold: true },
        { text: line, color: theme.muted },
      ]);
    case "steer":
      return wrap(entry.text, width - 6).map((line, index) => [
        { text: index === 0 ? "You › " : "      ", color: theme.product, bold: true },
        { text: line, color: theme.text },
      ]);
    case "notice":
      return wrap(entry.text, width).map((line) => [{ text: line, color: theme.muted }]);
  }
}

/** Every entry as lines, with a blank line between entries (tool calls stay together). */
export function transcriptLines(entries: readonly TranscriptEntry[], width: number, theme: Theme): Line[] {
  const lines: Line[] = [];
  let previous: TranscriptEntry | undefined;
  for (const entry of entries) {
    const next = entryLines(entry, width, theme);
    if (!next.length) continue;
    const together = previous && (previous.kind === "tool" || previous.kind === "blocked") && (entry.kind === "tool" || entry.kind === "blocked");
    if (previous && !together) lines.push([]);
    lines.push(...next);
    previous = entry;
  }
  return lines;
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The agent at work. Its words, thinking and tool calls stack up from the
 * bottom and fade toward the top. There is no scrolling: this screen is to
 * watch, steer, or stop.
 */
export function RunningScreen({ controller: c, theme, product, detail }: { controller: Controller; theme: Theme; product: string; detail: string }) {
  const [ref, size] = useMeasure();
  const [frame, setFrame] = useState(0);
  const [steerText, setSteerText] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setFrame((value) => value + 1), 80);
    return () => clearInterval(timer);
  }, []);

  useKeys((key) => {
    if (c.screen() === "running" && !c.modal() && key.name === "escape") c.stop();
  });

  const width = Math.max(size.width, 10);
  const height = Math.max(size.height, 1);
  const lines = transcriptLines(c.entries(), width, theme).slice(-height);
  const bright = Math.ceil(height * BRIGHT_SHARE);
  // Lines are anchored to the bottom; distance is counted from the last line.
  const faded = lines.map((line, index) => {
    const fromBottom = lines.length - 1 - index;
    const fade = fromBottom < bright ? 1 : Math.max(TOP_BRIGHTNESS, 1 - ((fromBottom - bright) / Math.max(height - bright, 1)) * (1 - TOP_BRIGHTNESS));
    return line.map((segment) => ({ ...segment, color: mix(theme.background, segment.color, fade) }));
  });

  const state = c.sessionState();
  const name = state.status === "ready" ? state.session.harness.name : (c.harness()?.name ?? "The agent");
  const model = state.status === "ready" ? state.session.currentModel?.name : undefined;
  const status = `${name}${model ? ` · ${model}` : ""} is investigating · ${formatElapsed(Date.now() - c.startedAt())}`;

  return (
    <Box flexDirection="column" flexGrow={1} gap={1}>
      <Header theme={theme} product={product} detail={detail} />
      <Box ref={ref} flexGrow={1} flexDirection="column" justifyContent="flex-end" overflow="hidden">
        {size.height > 0 && <Lines lines={faded} />}
      </Box>
      <Box flexDirection="column" flexShrink={0}>
        <Spinner theme={theme} frame={frame} label={status} />
        <Panel borderColor={theme.border} backgroundColor={theme.background} paddingX={1} marginTop={1} height={3}>
          <TextArea
            value={steerText}
            onChange={setSteerText}
            theme={theme}
            focused={!c.modal()}
            height={1}
            singleLine
            placeholder="Steer the model or press esc to stop..."
            onSubmit={() => {
              if (!steerText.trim()) return;
              c.steer(steerText);
              setSteerText("");
            }}
          />
        </Panel>
      </Box>
      <Hints theme={theme} hints={[["enter", "steer"], ["esc", "stop"]]} />
    </Box>
  );
}
