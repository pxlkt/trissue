import { useStdin } from "ink";
import { useEffect, useRef } from "react";

/**
 * One key press, or pasted text. `name` is a key like "return", "left" or "a";
 * pasted text has the name "paste" and its text in `text`.
 */
export interface Key {
  name: string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  /** Text to insert: the character typed, or what was pasted. Empty for keys that don't type anything. */
  text: string;
}

const CSI_NAMES: Record<string, string> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  H: "home",
  F: "end",
  Z: "tab",
  P: "f1",
  Q: "f2",
  R: "f3",
  S: "f4",
};

const TILDE_NAMES: Record<string, string> = {
  "1": "home",
  "2": "insert",
  "3": "delete",
  "4": "end",
  "5": "pageup",
  "6": "pagedown",
  "7": "home",
  "8": "end",
};

function key(name: string, extra: Partial<Key> = {}): Key {
  return { name, ctrl: false, shift: false, meta: false, text: "", ...extra };
}

/** Modifier number from an xterm sequence like ESC[1;5C: 2 shift, 3 alt, 5 ctrl, and their sums. */
function modifiers(value: string | undefined): Pick<Key, "ctrl" | "shift" | "meta"> {
  const bits = Math.max(Number(value ?? 1) - 1, 0);
  return { shift: Boolean(bits & 1), meta: Boolean(bits & 2), ctrl: Boolean(bits & 4) };
}

/**
 * Decodes one input event. Ink's input parser has already split the stream
 * into escape sequences and runs of plain text, so each call gets one of those.
 */
export function decodeKey(sequence: string): Key {
  if (sequence === "\r" || sequence === "\n") return key("return");
  if (sequence === "\x1b\r") return key("return", { meta: true });
  if (sequence === "\t") return key("tab");
  if (sequence === "\x7f" || sequence === "\b") return key("backspace");
  if (sequence === "\x1b\x7f" || sequence === "\x1b\b") return key("backspace", { meta: true });
  if (sequence === "\x1b" || sequence === "\x1b\x1b") return key("escape");
  if (sequence === " ") return key("space", { text: " " });

  // ESC [ … or ESC O …: arrows, home/end, function keys, with optional modifiers.
  const csi = /^\x1b(?:\[|O)(?:(\d+)(?:;(\d+))?)?([A-Za-z~])$/.exec(sequence);
  if (csi) {
    const [, number, modifier, final] = csi;
    if (final === "~") return key(TILDE_NAMES[number ?? ""] ?? "unknown", modifiers(modifier));
    if (final === "Z") return key("tab", { shift: true });
    const name = CSI_NAMES[final!];
    // Arrows report modifiers as ESC[1;<mod>X.
    if (name) return key(name, modifiers(modifier));
    return key("unknown");
  }

  // ESC followed by one character: alt+<char>. Terminals send alt+b/f for word moves.
  if (sequence.length === 2 && sequence[0] === "\x1b") {
    const char = sequence[1]!;
    return key(char.toLowerCase(), { meta: true, shift: char !== char.toLowerCase() });
  }

  if (sequence.startsWith("\x1b")) return key("unknown");

  if (sequence.length === 1) {
    const code = sequence.charCodeAt(0);
    // ctrl+a … ctrl+z
    if (code >= 1 && code <= 26) return key(String.fromCharCode(code + 96), { ctrl: true });
    if (code < 32) return key("unknown");
  }

  // A single character, or several at once: pasted text, with line breaks made plain.
  const text = sequence.replace(/\r\n?/g, "\n");
  if ([...text].length > 1) return key("paste", { text });
  return key(text.toLowerCase(), { text, shift: text !== text.toLowerCase() });
}

/**
 * Calls `handler` for every key while `active`. Every active handler sees
 * every key, so each one checks the state it cares about.
 */
export function useKeys(handler: (key: Key) => void, active = true) {
  const { internal_eventEmitter: events, setRawMode } = useStdin();
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!active) return;
    setRawMode(true);
    const listener = (sequence: string) => latest.current(decodeKey(sequence));
    events.on("input", listener);
    return () => {
      events.off("input", listener);
      setRawMode(false);
    };
  }, [active, events, setRawMode]);
}
