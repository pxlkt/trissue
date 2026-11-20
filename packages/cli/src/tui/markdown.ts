import { Lexer, type Token, type Tokens } from "marked";
import stringWidth from "string-width";
import type { Line, Segment } from "./components.tsx";
import type { Theme } from "./theme.ts";

type Style = Omit<Segment, "text">;

/**
 * Wraps styled text to `width` cells, breaking at spaces where it can.
 * `indent` starts every line; `first` replaces it on the first line, so a
 * list item can hang under its bullet.
 */
export function wrapSegments(segments: Segment[], width: number, indent: Segment[] = [], first: Segment[] = indent): Line[] {
  const lines: Line[] = [];
  const cellsOf = (line: Segment[]) => line.reduce((sum, segment) => sum + stringWidth(segment.text), 0);
  let line: Segment[] = first.map((segment) => ({ ...segment }));
  let used = cellsOf(line);
  let hasText = false;
  const limit = (prefix: number) => Math.max(width, prefix + 1);

  const push = (text: string, style: Style) => {
    const last = line[line.length - 1];
    if (last && last.color === style.color && last.bold === style.bold && last.italic === style.italic && last.underline === style.underline && last.background === style.background) last.text += text;
    else line.push({ ...style, text });
    used += stringWidth(text);
    hasText = true;
  };
  const breakLine = () => {
    // Spaces at the end of a line aren't drawn.
    const end = line[line.length - 1];
    if (end) end.text = end.text.trimEnd();
    lines.push(line.filter((segment) => segment.text));
    line = indent.map((segment) => ({ ...segment }));
    used = cellsOf(line);
    hasText = false;
  };

  for (const segment of segments) {
    const style: Style = { ...segment };
    delete (style as Partial<Segment>).text;
    for (const piece of segment.text.split(/(\n|\s+)/)) {
      if (!piece) continue;
      if (piece === "\n") {
        breakLine();
        continue;
      }
      const cells = stringWidth(piece);
      if (/^\s+$/.test(piece)) {
        // A space never starts a line.
        if (hasText && used + cells <= limit(cellsOf(indent))) push(piece, style);
        continue;
      }
      if (used + cells > limit(cellsOf(indent)) && hasText) breakLine();
      let rest = piece;
      // A word longer than a whole line is cut by cells.
      while (used + stringWidth(rest) > limit(cellsOf(indent))) {
        let cut = "";
        for (const char of rest) {
          if (used + stringWidth(cut + char) > limit(cellsOf(indent))) break;
          cut += char;
        }
        if (!cut) break;
        push(cut, style);
        rest = rest.slice(cut.length);
        breakLine();
      }
      if (rest) push(rest, style);
    }
  }
  if (hasText || lines.length === 0) breakLine();
  return lines;
}

function inline(tokens: Token[] | undefined, style: Style, theme: Theme): Segment[] {
  const out: Segment[] = [];
  const code = theme.product === theme.text ? theme.muted : theme.product;
  for (const token of tokens ?? []) {
    switch (token.type) {
      case "strong":
        out.push(...inline(token.tokens, { ...style, bold: true }, theme));
        break;
      case "em":
        out.push(...inline(token.tokens, { ...style, italic: true }, theme));
        break;
      case "del":
        out.push(...inline(token.tokens, { ...style, color: theme.muted }, theme));
        break;
      case "codespan":
        out.push({ ...style, color: code, text: decode(token.text) });
        break;
      case "br":
        out.push({ ...style, text: "\n" });
        break;
      case "link": {
        const link = token as Tokens.Link;
        const label = inline(link.tokens, { ...style, underline: true }, theme);
        const labelText = label.map((segment) => segment.text).join("");
        if (labelText === link.href || `mailto:${labelText}` === link.href) out.push({ ...style, color: theme.muted, underline: true, text: labelText });
        else out.push(...label, { ...style, color: theme.muted, text: ` (${link.href})` });
        break;
      }
      case "image":
        out.push({ ...style, color: theme.muted, text: `[${(token as Tokens.Image).text || "image"}] (${(token as Tokens.Image).href})` });
        break;
      case "text":
        if ("tokens" in token && token.tokens?.length) out.push(...inline(token.tokens, style, theme));
        else out.push({ ...style, text: decode(token.text) });
        break;
      case "escape":
        out.push({ ...style, text: token.text });
        break;
      default:
        out.push({ ...style, text: "raw" in token ? decode(String(token.raw)) : "" });
    }
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** marked escapes HTML in text; the terminal shows it as written. */
function decode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => ENTITIES[name]!);
}

/** The line without its first `cells` cells. Used on indents, which are plain spaces. */
function dropCells(line: Line, cells: number): Line {
  let left = cells;
  const out: Line = [];
  for (const segment of line) {
    if (left <= 0) {
      out.push(segment);
      continue;
    }
    const chars = [...segment.text];
    let cut = 0;
    while (cut < chars.length && left > 0) left -= stringWidth(chars[cut++]!);
    const rest = chars.slice(cut).join("");
    if (rest) out.push({ ...segment, text: rest });
  }
  return out;
}

function blocks(tokens: Token[], width: number, theme: Theme, indent: Segment[]): Line[] {
  const out: Line[] = [];
  const text: Style = { color: theme.text };
  const gap = () => {
    if (out.length && out[out.length - 1]!.some((segment) => segment.text.trim())) out.push([...indent]);
  };

  for (const token of tokens) {
    switch (token.type) {
      case "space":
        break;
      case "heading":
        gap();
        out.push(...wrapSegments(inline(token.tokens, { ...text, bold: true }, theme), width, indent));
        break;
      case "paragraph":
        gap();
        out.push(...wrapSegments(inline(token.tokens, text, theme), width, indent));
        break;
      case "text":
        // A list item's text: no blank line before it.
        out.push(...wrapSegments(inline(token.tokens ?? [{ type: "text", raw: token.text, text: token.text }], text, theme), width, indent));
        break;
      case "code":
        gap();
        for (const row of (token as Tokens.Code).text.split("\n")) out.push([...indent, { color: theme.muted, text: `  ${row}` }]);
        break;
      case "blockquote": {
        gap();
        const bar = [...indent, { color: theme.faint, text: "│ " }];
        const quoted = blocks((token as Tokens.Blockquote).tokens, width, { ...theme, text: theme.muted }, bar);
        out.push(...quoted.map((line) => line.map((segment) => (segment.text === "│ " ? segment : { ...segment, italic: true }))));
        break;
      }
      case "list": {
        gap();
        const list = token as Tokens.List;
        const start = typeof list.start === "number" ? list.start : 1;
        list.items.forEach((item, index) => {
          const bullet = list.ordered ? `${start + index}. ` : item.task ? (item.checked ? "[x] " : "[ ] ") : "- ";
          const hang = [...indent, { color: theme.text, text: " ".repeat(stringWidth(bullet)) }];
          const lines = blocks(item.tokens.filter((child) => child.type !== "checkbox"), width, theme, hang);
          // The first line gets the bullet in place of the hanging indent.
          if (lines[0]) lines[0] = [...indent, { color: theme.muted, text: bullet }, ...dropCells(lines[0], stringWidth(hang.map((segment) => segment.text).join("")))];
          // Items in a loose list keep a blank line between them; tight ones don't.
          out.push(...(list.loose ? lines : lines.filter((line) => line.some((segment) => segment.text.trim()))));
        });
        break;
      }
      case "hr":
        gap();
        out.push([...indent, { color: theme.faint, text: "─".repeat(Math.max(width - stringWidth(indent.map((segment) => segment.text).join("")), 1)) }]);
        break;
      case "table": {
        gap();
        for (const row of token.raw.trimEnd().split("\n")) out.push([...indent, { color: theme.muted, text: row }]);
        break;
      }
      default:
        if (token.raw.trim()) {
          gap();
          out.push(...wrapSegments([{ ...text, text: decode(token.raw.trim()) }], width, indent));
        }
    }
  }
  return out;
}

/** Markdown as styled terminal lines, wrapped to `width` cells. */
export function renderMarkdown(markdown: string, width: number, theme: Theme): Line[] {
  return blocks(new Lexer({ gfm: true }).lex(markdown), width, theme, []);
}
