import { TextAttributes } from "@opentui/core";
import { For, Show, type JSX } from "solid-js";
import type { HarnessBrand } from "trissue-embedded";
import { gradientAt, type Theme } from "./theme.ts";

export const BOLD = TextAttributes.BOLD;
export const DIM = TextAttributes.DIM;
export const ITALIC = TextAttributes.ITALIC;

/** The header on every screen after the trust screen: "<Product> Triage" and where it came from. */
export function Header(props: { theme: Theme; product: string; detail: string }) {
  return (
    <box flexDirection="row" justifyContent="space-between" height={1} flexShrink={0}>
      <text>
        <span style={{ fg: props.theme.product, bold: true }}>{props.product}</span>
        <span style={{ fg: props.theme.text }}> Triage</span>
      </text>
      <text fg={props.theme.muted}>{props.detail}</text>
    </box>
  );
}

/** Key hints along the bottom of the frame, like "enter continue · esc quit". */
export function Hints(props: { theme: Theme; hints: [string, string][] }) {
  return (
    <text flexShrink={0}>
      <For each={props.hints}>
        {([key, label], index) => (
          <>
            <Show when={index() > 0}>
              <span style={{ fg: props.theme.faint }}>{"  ·  "}</span>
            </Show>
            <span style={{ fg: props.theme.text }}>{key}</span>
            <span style={{ fg: props.theme.muted }}> {label}</span>
          </>
        )}
      </For>
    </text>
  );
}

/**
 * A harness name in its brand colors. Selected, the colors become the
 * background and the text takes the brand's second color.
 */
export function BrandLabel(props: { name: string; brand: HarnessBrand | null; selected: boolean; theme: Theme }) {
  const label = () => ` ${props.name} `;
  const colors = () => props.brand?.color ?? [props.theme.text];
  const selectedText = () => props.brand?.selectedText ?? props.theme.background;
  return (
    <text>
      <For each={[...label()]}>
        {(char, index) => {
          const color = () => gradientAt(colors(), label().length > 1 ? index() / (label().length - 1) : 0);
          return (
            <span style={props.selected ? { fg: selectedText(), bg: color(), bold: true } : { fg: color() }}>{char}</span>
          );
        }}
      </For>
    </text>
  );
}

/** A row of choices. The focused one is drawn inverted. */
export function ButtonRow(props: {
  theme: Theme;
  items: { label: string; prefix?: { text: string; color: string } }[];
  index: number;
  focused: boolean;
}) {
  return (
    <box flexDirection="row" flexWrap="wrap" columnGap={2} flexShrink={0}>
      <For each={props.items}>
        {(item, index) => {
          const active = () => props.focused && index() === props.index;
          return (
            <text>
              <span style={active() ? { fg: props.theme.background, bg: props.theme.focus } : { fg: props.theme.text }}> </span>
              <Show when={item.prefix}>
                {(prefix) => (
                  <span style={active() ? { fg: props.theme.background, bg: props.theme.focus, bold: true } : { fg: prefix().color, bold: true }}>
                    {prefix().text}{" "}
                  </span>
                )}
              </Show>
              <span style={active() ? { fg: props.theme.background, bg: props.theme.focus, bold: true } : { fg: props.theme.text }}>
                {item.label}{" "}
              </span>
            </text>
          );
        }}
      </For>
    </box>
  );
}

/**
 * A centered dialog over a dimmed screen. Rendered at the root, it covers
 * everything, including the outer frame.
 */
export function Modal(props: { theme: Theme; title: string; width?: number; children: JSX.Element }) {
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" zIndex={100} backgroundColor={props.theme.scrim} alignItems="center" justifyContent="center">
      <box
        width={props.width ?? 64}
        maxWidth="90%"
        border
        borderStyle="single"
        borderColor={props.theme.border}
        backgroundColor={props.theme.background}
        paddingX={2}
        paddingY={1}
        flexDirection="column"
        gap={1}
      >
        <text fg={props.theme.text} attributes={BOLD}>
          {props.title}
        </text>
        {props.children}
      </box>
    </box>
  );
}

export function Spinner(props: { theme: Theme; frame: number; label: string }) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  return (
    <text>
      <span style={{ fg: props.theme.text }}>{frames[props.frame % frames.length]} </span>
      <span style={{ fg: props.theme.muted }}>{props.label}</span>
    </text>
  );
}
