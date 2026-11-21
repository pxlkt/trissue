import { Box } from "ink";
import { CONFIG_FILE } from "trissue-embedded";
import { CenteredLines, Hints, useFrameSize, type Line, type Segment } from "../components.tsx";
import type { Controller } from "../controller.ts";
import { useKeys } from "../keys.ts";
import { wrapSegments } from "../markdown.ts";
import { BASE_THEME } from "../theme.ts";

/** The widest a line of text gets on the centered screens, so it stays easy to read. */
export const CENTERED_TEXT_WIDTH = 76;

/**
 * The first screen. It warns before anything from the repository is used, and
 * deliberately ignores the repository's colors and names.
 */
export function TrustScreen({ controller: c, onQuit }: { controller: Controller; onQuit: () => void }) {
  const theme = BASE_THEME;
  const frame = useFrameSize();
  const width = Math.min(frame.width, CENTERED_TEXT_WIDTH);
  const source = c.options.source;
  const ready = c.fetched() !== null;
  const error = c.fetchError();

  useKeys((key) => {
    if (key.name === "escape" || key.name === "q") onQuit();
    else if (key.name === "return" && ready) c.setScreen("compose");
  });

  const paragraph = (segments: Segment[]): Line[] => wrapSegments(segments, width);
  const row = (label: string, value: string) => paragraph([
    { text: `${label}: `, color: theme.text, bold: true },
    { text: value, color: theme.text },
  ]);

  let status: Segment;
  if (error) status = { text: error, color: theme.danger };
  else if (!ready) status = { text: "Downloading the repo…", color: theme.muted };
  else if (c.config()) status = { text: `This repo has a ${CONFIG_FILE}. Its instructions go to the agent, which checks them for anything malicious before following them.`, color: theme.muted };
  else status = { text: "This repo has no trissue configuration, so the defaults are used. Only continue if you trust it.", color: theme.muted };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" flexGrow={1} justifyContent="center" gap={1}>
        <CenteredLines
          lines={paragraph([{ text: "This command can prompt an AI agent on your computer. Be sure you trust this repo before running this command.", color: theme.danger, bold: true }])}
        />
        <CenteredLines
          lines={[
            ...row("Repo Organization", source.org || "None"),
            ...row("Repo Name", source.name),
            ...row(source.kind === "local" ? "Opened From" : "Downloaded From", source.kind === "local" ? `${source.origin} (${source.url})` : source.origin),
          ]}
        />
        <CenteredLines lines={paragraph([status])} />
      </Box>
      <Hints theme={theme} centered hints={ready ? [["enter", "continue"], ["esc", "quit"]] : [["esc", "quit"]]} />
    </Box>
  );
}
