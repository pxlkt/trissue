import { Box, measureElement, Text, type BoxProps, type DOMElement } from "ink";
import { createContext, Fragment, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { HarnessBrand } from "trissue-embedded";
import { gradientAt, paint, type Theme } from "./theme.ts";

/** A run of text in one style. */
export interface Segment {
  text: string;
  color: string;
  background?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

/** One terminal row of styled text. */
export type Line = Segment[];

/** The terminal's size, in cells: the rows the interface may use. */
export const ScreenSize = createContext({ columns: 80, rows: 24 });
export const useScreenSize = () => useContext(ScreenSize);

/** The space inside the frame, where screens draw, in cells. */
export const FrameSize = createContext({ width: 72, height: 18 });
export const useFrameSize = () => useContext(FrameSize);

/** The size Ink laid an element out at. It's known after the first render, so it starts at zero. */
export function useMeasure(): [React.RefObject<DOMElement | null>, { width: number; height: number }] {
  const ref = useRef<DOMElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const next = measureElement(ref.current);
    if (next.width !== size.width || next.height !== size.height) setSize(next);
  });
  return [ref, size];
}

export function SegmentText({ segment }: { segment: Segment }) {
  return (
    <Text color={segment.color} backgroundColor={segment.background} bold={segment.bold} italic={segment.italic} underline={segment.underline}>
      {segment.text}
    </Text>
  );
}

/** Rows of styled text, one terminal row each. Lines are expected to fit already. */
export function Lines({ lines }: { lines: Line[] }) {
  return (
    <>
      {lines.map((line, index) => (
        <Text key={index} wrap="truncate-end">
          {line.length === 0 ? " " : line.map((segment, part) => <SegmentText key={part} segment={segment} />)}
        </Text>
      ))}
    </>
  );
}

type PanelProps = Omit<BoxProps, "borderStyle" | "borderColor" | "backgroundColor"> & {
  borderColor: string;
  backgroundColor: string;
  children?: ReactNode;
};

/**
 * A box with a single-line border. Ink draws borders without a background,
 * so this draws its own over a box that fills the whole area, border included.
 */
export function Panel({ borderColor, backgroundColor, children, paddingX = 0, paddingY = 0, flexDirection, gap, alignItems, justifyContent, ...box }: PanelProps) {
  const [ref, size] = useMeasure();
  const inner = Math.max(size.width - 2, 0);
  const sides = Math.max(size.height - 2, 0);
  return (
    <Box ref={ref} {...box} backgroundColor={backgroundColor}>
      <Box
        flexGrow={1}
        flexDirection={flexDirection}
        gap={gap}
        alignItems={alignItems}
        justifyContent={justifyContent}
        paddingX={(paddingX as number) + 1}
        paddingY={(paddingY as number) + 1}
      >
        {children}
      </Box>
      {size.width >= 2 && size.height >= 2 && (
        <>
          <Box position="absolute" width={size.width} height={size.height} flexDirection="column" justifyContent="space-between">
            <Text color={borderColor} backgroundColor={backgroundColor}>{`┌${"─".repeat(inner)}┐`}</Text>
            <Text color={borderColor} backgroundColor={backgroundColor}>{`└${"─".repeat(inner)}┘`}</Text>
          </Box>
          {sides > 0 && (
            <Box position="absolute" width={size.width} height={size.height} paddingY={1} flexDirection="row" justifyContent="space-between">
              <Text color={borderColor} backgroundColor={backgroundColor}>{Array(sides).fill("│").join("\n")}</Text>
              <Text color={borderColor} backgroundColor={backgroundColor}>{Array(sides).fill("│").join("\n")}</Text>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

/** The header on every screen after the trust screen: "<Product> Triage" and where it came from. */
export function Header({ theme, product, detail }: { theme: Theme; product: string; detail: string }) {
  return (
    <Box flexDirection="row" justifyContent="space-between" height={1} flexShrink={0} gap={2}>
      <Text wrap="truncate-end">
        <Text color={theme.product} bold>
          {product}
        </Text>
        <Text color={theme.text}> Triage</Text>
      </Text>
      <Text color={theme.muted} wrap="truncate-start">
        {detail}
      </Text>
    </Box>
  );
}

/**
 * Rows of styled text, each centered on its own. For screens with little on
 * them, where text hugging the left edge leaves the rest of the frame empty.
 */
export function CenteredLines({ lines }: { lines: Line[] }) {
  return (
    <Box flexDirection="column" alignItems="center" flexShrink={0}>
      {lines.map((line, index) => (
        <Text key={index}>{line.length === 0 ? " " : line.map((segment, part) => <SegmentText key={part} segment={segment} />)}</Text>
      ))}
    </Box>
  );
}

/** Key hints along the bottom of the frame, like "enter continue · esc quit". */
export function Hints({ theme, hints, centered = false }: { theme: Theme; hints: [string, string][]; centered?: boolean }) {
  return (
    <Box flexShrink={0} justifyContent={centered ? "center" : "flex-start"}>
      <Text>
        {hints.map(([key, label], index) => (
          <Fragment key={key + label}>
            {index > 0 && <Text color={theme.faint}>{"  ·  "}</Text>}
            <Text color={theme.text}>{key}</Text>
            <Text color={theme.muted}> {label}</Text>
          </Fragment>
        ))}
      </Text>
    </Box>
  );
}

/**
 * A harness name in its brand colors. Selected, the colors become the
 * background and the text takes the brand's second color.
 */
export function BrandLabel({ name, brand, selected, theme }: { name: string; brand: HarnessBrand | null; selected: boolean; theme: Theme }) {
  const label = ` ${name} `;
  const chars = [...label];
  const colors = brand?.color ?? [theme.text];
  const selectedText = paint(theme, brand?.selectedText ?? theme.background);
  return (
    <Text>
      {chars.map((char, index) => {
        const color = paint(theme, gradientAt(colors, chars.length > 1 ? index / (chars.length - 1) : 0));
        return selected ? (
          <Text key={index} color={selectedText} backgroundColor={color} bold>
            {char}
          </Text>
        ) : (
          <Text key={index} color={color}>
            {char}
          </Text>
        );
      })}
    </Text>
  );
}

/** A row of choices. The focused one is drawn inverted. */
export function ButtonRow({
  theme,
  items,
  index,
  focused,
  centered = false,
}: {
  theme: Theme;
  items: { label: string; prefix?: { text: string; color: string } }[];
  index: number;
  focused: boolean;
  centered?: boolean;
}) {
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2} flexShrink={0} justifyContent={centered ? "center" : "flex-start"}>
      {items.map((item, position) => {
        const active = focused && position === index;
        const inverted = { color: theme.background, backgroundColor: theme.focus };
        return (
          <Text key={item.label}>
            <Text {...(active ? inverted : {})}> </Text>
            {item.prefix && (
              <Text {...(active ? inverted : { color: item.prefix.color })} bold>
                {item.prefix.text}{" "}
              </Text>
            )}
            <Text {...(active ? inverted : { color: theme.text })} bold={active}>
              {item.label}{" "}
            </Text>
          </Text>
        );
      })}
    </Box>
  );
}

/**
 * A centered dialog. The app draws the screen behind it through the scrim
 * (see `veiled` in theme.ts), and this sits on top of everything.
 */
export function Modal({ theme, title, width = 64, children }: { theme: Theme; title: string; width?: number; children: ReactNode }) {
  const screen = useScreenSize();
  return (
    <Box position="absolute" width={screen.columns} height={screen.rows} alignItems="center" justifyContent="center">
      <Panel
        width={Math.min(width, Math.floor(screen.columns * 0.9))}
        borderColor={theme.border}
        backgroundColor={theme.background}
        paddingX={2}
        paddingY={1}
        flexDirection="column"
        gap={1}
      >
        <Text color={theme.text} bold>
          {title}
        </Text>
        {children}
      </Panel>
    </Box>
  );
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner({ theme, frame, label }: { theme: Theme; frame: number; label: string }) {
  return (
    <Text wrap="truncate-end">
      <Text color={theme.text}>{SPINNER[frame % SPINNER.length]} </Text>
      <Text color={theme.muted}>{label}</Text>
    </Text>
  );
}
