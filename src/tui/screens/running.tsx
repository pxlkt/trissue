import type { BoxRenderable, TextareaRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import { createMemo, createSignal, For, onCleanup } from "solid-js";
import type { TranscriptEntry } from "../../core/transcript.ts";
import { BOLD, Header, Hints, ITALIC, Spinner } from "../components.tsx";
import type { Controller } from "../controller.ts";
import { mix, type Theme } from "../theme.ts";
import { wrap } from "../wrap.ts";

interface Segment {
  text: string;
  color: string;
  attributes?: number;
}

type Line = Segment[];

const ISSUE_MARKER = /<trissue-(issue|rejected)>[\s\S]*$/;

/** The share of the area, from the bottom, that stays at full brightness. */
const BRIGHT_SHARE = 0.35;
/** How bright the top line is, from 0 (background) to 1. */
const TOP_BRIGHTNESS = 0.18;

function entryLines(entry: TranscriptEntry, width: number, theme: Theme): Line[] {
  switch (entry.kind) {
    case "thought":
      return wrap(entry.text.trim(), width - 2).map((line) => [{ text: `  ${line}`, color: theme.muted, attributes: ITALIC }]);
    case "message": {
      const visible = entry.text.replace(ISSUE_MARKER, "").trim();
      const lines = visible ? wrap(visible, width).map((line): Line => [{ text: line, color: theme.text }]) : [];
      if (ISSUE_MARKER.test(entry.text)) lines.push([{ text: "Writing the issue…", color: theme.text, attributes: BOLD }]);
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
        { text: index === 0 ? "⊘ Blocked " : "          ", color: theme.danger, attributes: BOLD },
        { text: line, color: theme.muted },
      ]);
    case "steer":
      return wrap(entry.text, width - 6).map((line, index) => [
        { text: index === 0 ? "You › " : "      ", color: theme.product, attributes: BOLD },
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
export function RunningScreen(props: { controller: Controller; theme: Theme; product: string; detail: string }) {
  const c = props.controller;
  const [size, setSize] = createSignal({ width: 80, height: 10 });
  const [frame, setFrame] = createSignal(0);
  const [now, setNow] = createSignal(Date.now());
  let steerBox: TextareaRenderable | undefined;

  const timer = setInterval(() => {
    setFrame((value) => value + 1);
    setNow(Date.now());
  }, 80);
  onCleanup(() => clearInterval(timer));

  useKeyboard((key) => {
    if (c.screen() !== "running") return;
    if (key.name === "escape") {
      key.preventDefault();
      c.stop();
    }
  });

  const visible = createMemo(() => {
    const { width, height } = size();
    const lines = transcriptLines(c.entries(), width, props.theme).slice(-height);
    const bright = Math.ceil(height * BRIGHT_SHARE);
    // Lines are anchored to the bottom; distance is counted from the last line.
    return lines.map((line, index) => {
      const fromBottom = lines.length - 1 - index;
      const fade = fromBottom < bright ? 1 : Math.max(TOP_BRIGHTNESS, 1 - ((fromBottom - bright) / Math.max(height - bright, 1)) * (1 - TOP_BRIGHTNESS));
      return line.map((segment) => ({ ...segment, color: mix(props.theme.background, segment.color, fade) }));
    });
  });

  const status = () => {
    const state = c.sessionState();
    const name = state.status === "ready" ? state.session.harness.name : (c.harness()?.name ?? "The agent");
    const model = state.status === "ready" ? state.session.currentModel?.name : undefined;
    return `${name}${model ? ` · ${model}` : ""} is investigating · ${formatElapsed(now() - c.startedAt())}`;
  };

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <Header theme={props.theme} product={props.product} detail={props.detail} />
      <box
        flexGrow={1}
        flexDirection="column"
        justifyContent="flex-end"
        overflow="hidden"
        ref={(element: BoxRenderable) => {
          const measure = () => setSize({ width: Math.max(element.width, 10), height: Math.max(element.height, 1) });
          element.onSizeChange = measure;
          queueMicrotask(measure);
        }}
      >
        <For each={visible()}>
          {(line) => (
            <text height={1} flexShrink={0}>
              {line.length === 0 ? " " : ""}
              <For each={line}>{(segment) => <span style={{ fg: segment.color, bold: Boolean((segment.attributes ?? 0) & BOLD), italic: Boolean((segment.attributes ?? 0) & ITALIC) }}>{segment.text}</span>}</For>
            </text>
          )}
        </For>
      </box>
      <box flexDirection="column" flexShrink={0}>
        <Spinner theme={props.theme} frame={frame()} label={status()} />
        <box border borderStyle="single" borderColor={props.theme.border} paddingX={1} marginTop={1} height={3}>
          <textarea
            ref={(element: TextareaRenderable) => (steerBox = element)}
            focused={!c.modal()}
            height={1}
            wrapMode="none"
            placeholder="Steer the model or press esc to stop..."
            placeholderColor={props.theme.faint}
            textColor={props.theme.text}
            focusedTextColor={props.theme.text}
            backgroundColor={props.theme.background}
            focusedBackgroundColor={props.theme.background}
            cursorColor={props.theme.text}
            keyBindings={[
              { name: "return", action: "submit" },
              { name: "return", shift: true, action: "newline" },
            ]}
            onSubmit={() => {
              const text = steerBox?.plainText ?? "";
              if (!text.trim()) return;
              c.steer(text);
              steerBox?.setText("");
            }}
          />
        </box>
      </box>
      <Hints theme={props.theme} hints={[["enter", "steer"], ["esc", "stop"]]} />
    </box>
  );
}
