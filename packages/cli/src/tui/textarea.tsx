import { Box, Text } from "ink";
import { useReducer, useRef } from "react";
import stringWidth from "string-width";
import { useMeasure } from "./components.tsx";
import { useKeys, type Key } from "./keys.ts";
import type { Theme } from "./theme.ts";

const segmenter = new Intl.Segmenter();

/** Offsets where each grapheme of `text` starts, plus its length at the end. */
function boundaries(text: string): number[] {
  const out = [...segmenter.segment(text)].map((part) => part.index);
  out.push(text.length);
  return out;
}

function previousBoundary(text: string, offset: number): number {
  const all = boundaries(text);
  for (let index = all.length - 1; index >= 0; index--) if (all[index]! < offset) return all[index]!;
  return 0;
}

function nextBoundary(text: string, offset: number): number {
  for (const boundary of boundaries(text)) if (boundary > offset) return boundary;
  return text.length;
}

function previousWord(text: string, offset: number): number {
  let index = offset;
  while (index > 0 && /\s/.test(text[index - 1]!)) index--;
  while (index > 0 && !/\s/.test(text[index - 1]!)) index--;
  return index;
}

function nextWord(text: string, offset: number): number {
  let index = offset;
  while (index < text.length && /\s/.test(text[index]!)) index++;
  while (index < text.length && !/\s/.test(text[index]!)) index++;
  return index;
}

/** A row of the wrapped text: `text.slice(start, end)`. */
export interface Row {
  start: number;
  end: number;
}

/**
 * Wraps text into rows no wider than `width` cells, breaking after spaces
 * where it can. Spaces may hang past the edge so a row never starts with the
 * space it broke at.
 */
export function layoutRows(text: string, width: number): Row[] {
  const limit = Math.max(width, 1);
  const rows: Row[] = [];
  let paragraphStart = 0;
  for (const paragraph of text.split("\n")) {
    let rowStart = paragraphStart;
    let used = 0;
    let lastBreak = -1;
    for (const { segment, index } of segmenter.segment(paragraph)) {
      const offset = paragraphStart + index;
      const cells = stringWidth(segment);
      const space = /^\s+$/.test(segment);
      if (!space && used + cells > limit && offset > rowStart) {
        const breakAt = lastBreak > rowStart ? lastBreak : offset;
        rows.push({ start: rowStart, end: breakAt });
        used = stringWidth(text.slice(breakAt, offset));
        rowStart = breakAt;
        lastBreak = -1;
      }
      used += cells;
      if (space) lastBreak = offset + segment.length;
    }
    const paragraphEnd = paragraphStart + paragraph.length;
    rows.push({ start: rowStart, end: paragraphEnd });
    paragraphStart = paragraphEnd + 1;
  }
  return rows;
}

/** The row holding `offset`. At a soft wrap the cursor shows at the start of the next row. */
export function rowOf(rows: Row[], offset: number): number {
  let found = 0;
  rows.forEach((row, index) => {
    if (row.start <= offset) found = index;
  });
  return found;
}

/** The offset in `row` closest to `column` cells from its start, without going past it. */
function offsetAtColumn(text: string, row: Row, column: number): number {
  let offset = row.start;
  let used = 0;
  for (const { segment, index } of segmenter.segment(text.slice(row.start, row.end))) {
    const cells = stringWidth(segment);
    if (used + cells > column) break;
    used += cells;
    offset = row.start + index + segment.length;
  }
  return offset;
}

interface Snapshot {
  text: string;
  cursor: number;
}

export interface TextAreaProps {
  value: string;
  onChange: (value: string) => void;
  theme: Theme;
  focused: boolean;
  /** Rows to show; by default as many as fit. The text scrolls to keep the cursor in view. */
  height?: number;
  placeholder?: string;
  /** Enter calls this instead of starting a new line. */
  onSubmit?: () => void;
  /** Keeps the text on one line: no new lines, and up and down are left to the screen. */
  singleLine?: boolean;
}

/** A text box that wraps at word boundaries, with undo and redo. */
export function TextArea(props: TextAreaProps) {
  const { value, theme, focused, height } = props;
  const [ref, size] = useMeasure();
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const state = useRef({ cursor: value.length, top: 0, goalColumn: null as number | null, known: value });
  const history = useRef({ undo: [] as Snapshot[], redo: [] as Snapshot[], lastKind: "", lastAt: 0 });

  // A value set from outside (not typed here) puts the cursor at its end.
  if (value !== state.current.known) {
    state.current.cursor = value.length;
    state.current.known = value;
  }
  state.current.cursor = Math.min(state.current.cursor, value.length);

  // One cell stays free so the cursor fits after the last character.
  const width = Math.max(size.width - 1, 1);
  const rows = layoutRows(value, width);
  const cursorRow = rowOf(rows, state.current.cursor);

  function commit(text: string, cursor: number, kind: string) {
    const log = history.current;
    const now = Date.now();
    // Typing runs together into one undo step; other edits each get their own.
    if (kind !== log.lastKind || now - log.lastAt > 1000 || kind !== "type") {
      log.undo.push({ text: value, cursor: state.current.cursor });
      if (log.undo.length > 200) log.undo.shift();
    }
    log.redo = [];
    log.lastKind = kind;
    log.lastAt = now;
    move(cursor);
    state.current.known = text;
    props.onChange(text);
  }

  function restore(from: Snapshot[], to: Snapshot[]) {
    const snapshot = from.pop();
    if (!snapshot) return;
    to.push({ text: value, cursor: state.current.cursor });
    history.current.lastKind = "";
    state.current.known = snapshot.text;
    move(snapshot.cursor);
    props.onChange(snapshot.text);
  }

  function move(cursor: number, keepGoal = false) {
    state.current.cursor = cursor;
    if (!keepGoal) state.current.goalColumn = null;
  }

  function moveRow(step: number) {
    const target = rows[cursorRow + step];
    if (!target) {
      move(step < 0 ? 0 : value.length);
      return;
    }
    const current = rows[cursorRow]!;
    const goal = state.current.goalColumn ?? stringWidth(value.slice(current.start, state.current.cursor));
    move(offsetAtColumn(value, target, goal), true);
    state.current.goalColumn = goal;
  }

  function insert(text: string) {
    const clean = props.singleLine ? text.replace(/\n/g, " ") : text;
    const cursor = state.current.cursor;
    commit(value.slice(0, cursor) + clean + value.slice(cursor), cursor + clean.length, clean.length === 1 && !/\s/.test(clean) ? "type" : "insert");
  }

  function remove(from: number, to: number) {
    if (from === to) return;
    commit(value.slice(0, from) + value.slice(to), from, "delete");
  }

  useKeys((key: Key) => {
    const cursor = state.current.cursor;
    const row = rows[cursorRow]!;
    if (key.ctrl && key.name === "z") restore(key.shift ? history.current.redo : history.current.undo, key.shift ? history.current.undo : history.current.redo);
    else if (key.ctrl && key.name === "y") restore(history.current.redo, history.current.undo);
    else if (key.name === "return") {
      if (props.onSubmit) props.onSubmit();
      else if (!props.singleLine) insert("\n");
    } else if (key.name === "backspace") remove(key.meta || key.ctrl ? previousWord(value, cursor) : previousBoundary(value, cursor), cursor);
    else if (key.ctrl && key.name === "w") remove(previousWord(value, cursor), cursor);
    else if (key.name === "delete" || (key.ctrl && key.name === "d")) remove(cursor, key.meta || key.ctrl ? nextWord(value, cursor) : nextBoundary(value, cursor));
    else if (key.meta && key.name === "d") remove(cursor, nextWord(value, cursor));
    else if (key.ctrl && key.name === "u") remove(value.lastIndexOf("\n", cursor - 1) + 1, cursor);
    else if (key.ctrl && key.name === "k") {
      const end = value.indexOf("\n", cursor);
      remove(cursor, end === -1 ? value.length : end);
    } else if (key.name === "left") move(key.ctrl || key.meta ? previousWord(value, cursor) : previousBoundary(value, cursor));
    else if (key.name === "right") move(key.ctrl || key.meta ? nextWord(value, cursor) : nextBoundary(value, cursor));
    else if (key.meta && key.name === "b") move(previousWord(value, cursor));
    else if (key.meta && key.name === "f") move(nextWord(value, cursor));
    else if (key.name === "home" || (key.ctrl && key.name === "a")) move(row.start);
    else if (key.name === "end" || (key.ctrl && key.name === "e")) move(row.end);
    else if (key.name === "up" && !props.singleLine) moveRow(-1);
    else if (key.name === "down" && !props.singleLine) moveRow(1);
    else if (key.text && !key.ctrl && !key.meta) insert(key.text);
    else return;
    // A move doesn't change the value, so nothing else would draw it.
    redraw();
  }, focused);

  const visibleRows = Math.max(height ?? size.height, 1);
  // Keep the cursor in view, and never scroll past the end: the text may have
  // been wrapped narrower before the box was measured.
  const lastTop = Math.max(rows.length - visibleRows, 0);
  const top = Math.min(Math.max(state.current.top, cursorRow - visibleRows + 1), cursorRow, lastTop);
  state.current.top = Math.max(top, 0);

  const cursorStyle = { color: theme.background, backgroundColor: theme.text };
  const lines = [];
  if (size.width === 0) {
    // Not measured yet: nothing to wrap against.
  } else if (!value) {
    lines.push(
      <Text key={0} wrap="truncate-end">
        {focused && <Text {...cursorStyle}> </Text>}
        <Text color={theme.faint}>{props.placeholder ?? ""}</Text>
      </Text>,
    );
  } else {
    for (let index = state.current.top; index < Math.min(state.current.top + visibleRows, rows.length); index++) {
      const row = rows[index]!;
      const text = value.slice(row.start, row.end);
      if (!focused || index !== cursorRow) {
        lines.push(
          <Text key={index} color={theme.text} wrap="truncate-end">
            {text || " "}
          </Text>,
        );
        continue;
      }
      const at = state.current.cursor;
      const after = at < row.end ? nextBoundary(value, at) : at;
      lines.push(
        <Text key={index} color={theme.text} wrap="truncate-end">
          {value.slice(row.start, at)}
          <Text {...cursorStyle}>{at < row.end ? value.slice(at, after) : " "}</Text>
          {value.slice(after, row.end)}
        </Text>,
      );
    }
  }

  return (
    <Box ref={ref} flexDirection="column" flexGrow={1} height={height} overflow="hidden">
      {lines}
    </Box>
  );
}
