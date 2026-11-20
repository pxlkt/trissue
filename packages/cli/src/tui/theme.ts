import type { TrissueConfig } from "trissue-embedded";

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  let value = hex.replace("#", "");
  if (value.length === 3) value = [...value].map((char) => char + char).join("");
  const number = Number.parseInt(value.slice(0, 6), 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

/** Mixes `from` toward `to`. `amount` 0 is `from`, 1 is `to`. */
export function mix(from: string, to: string, amount: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  return toHex([0, 1, 2].map((index) => a[index]! + (b[index]! - a[index]!) * amount) as Rgb);
}

/** The color at `position` (0 to 1) along evenly spaced stops. */
export function gradientAt(stops: string[], position: number): string {
  if (stops.length === 1) return stops[0]!;
  const scaled = Math.min(Math.max(position, 0), 1) * (stops.length - 1);
  const index = Math.min(Math.floor(scaled), stops.length - 2);
  return mix(stops[index]!, stops[index + 1]!, scaled - index);
}

export interface Theme {
  background: string;
  text: string;
  muted: string;
  faint: string;
  border: string;
  danger: string;
  success: string;
  /** The "Use default model" checkmark. */
  check: string;
  product: string;
  /** Modal scrim, drawn over the screen behind a modal. The last two digits are its opacity. */
  scrim: string;
  /** Background of a focused control. */
  focus: string;
  /** Set on a veiled theme (see `veiled`): the scrim the colors are seen through. */
  veil?: string;
}

/** The trust screen ignores the repository's config: nothing from the repo is shown styled before you trust it. */
export const BASE_THEME: Theme = {
  background: "#000000",
  text: "#FFFFFF",
  muted: "#9A9A9A",
  faint: "#5C5C5C",
  border: "#FFFFFF",
  danger: "#FF4545",
  success: "#3DDC84",
  check: "#3DDC84",
  product: "#FFFFFF",
  scrim: "#000000B3",
  focus: "#FFFFFF",
};

export function themeFor(config: TrissueConfig | null, overrides: { background?: string } = {}): Theme {
  const background = overrides.background ?? config?.background ?? BASE_THEME.background;
  const light = luminance(background) > 0.5;
  const text = light ? "#000000" : "#FFFFFF";
  return {
    ...BASE_THEME,
    background,
    text,
    border: text,
    focus: text,
    muted: mix(text, background, 0.4),
    faint: mix(text, background, 0.65),
    scrim: `${light ? "#FFFFFF" : "#000000"}B3`,
    check: config?.checkmark === "monochrome" ? text : BASE_THEME.check,
    product: config?.product?.color ?? text,
  };
}

function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((channel) => channel / 255) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The theme seen through the modal scrim: every color mixed toward the
 * scrim's color by its opacity. The terminal can't blend cells, so the screen
 * behind a modal is drawn with this theme instead.
 */
export function veiled(theme: Theme): Theme {
  const out = { ...theme, veil: theme.scrim };
  for (const key of Object.keys(theme) as (keyof Theme)[]) {
    if (key !== "scrim" && key !== "veil") out[key] = paint(out, theme[key]!);
  }
  return out;
}

/** A color as the theme draws it: as is, or through the scrim when the theme is veiled. */
export function paint(theme: Theme, color: string): string {
  if (!theme.veil) return color;
  const opacity = Number.parseInt(theme.veil.slice(7, 9) || "FF", 16) / 255;
  return mix(color, theme.veil.slice(0, 7), opacity);
}
