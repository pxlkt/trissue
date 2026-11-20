import { Box, Text } from "ink";
import { CONFIG_FILE } from "trissue-embedded";
import { Hints } from "../components.tsx";
import type { Controller } from "../controller.ts";
import { useKeys } from "../keys.ts";
import { BASE_THEME } from "../theme.ts";

/**
 * The first screen. It warns before anything from the repository is used, and
 * deliberately ignores the repository's colors and names.
 */
export function TrustScreen({ controller: c, onQuit }: { controller: Controller; onQuit: () => void }) {
  const theme = BASE_THEME;
  const source = c.options.source;
  const ready = c.fetched() !== null;
  const error = c.fetchError();

  useKeys((key) => {
    if (key.name === "escape" || key.name === "q") onQuit();
    else if (key.name === "return" && ready) c.setScreen("compose");
  });

  const row = (label: string, value: string) => (
    <Text>
      <Text color={theme.text} bold>
        {label}:{" "}
      </Text>
      <Text color={theme.text}>{value}</Text>
    </Text>
  );

  let status: [string, string];
  if (error) status = [error, theme.danger];
  else if (!ready) status = ["Downloading the repo…", theme.muted];
  else if (c.config()) status = [`This repo has a ${CONFIG_FILE}. Its instructions go to the agent, which checks them for anything malicious before following them.`, theme.muted];
  else status = ["This repo has no trissue configuration, so the defaults are used. Only continue if you trust it.", theme.muted];

  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="space-between">
      <Box flexDirection="column" gap={1}>
        <Text color={theme.danger} bold>
          This command can prompt an AI agent on your computer. Be sure you trust this repo before running this command.
        </Text>
        <Box flexDirection="column">
          {row("Repo Organization", source.org || "None")}
          {row("Repo Name", source.name)}
          {row(source.kind === "local" ? "Opened From" : "Downloaded From", source.kind === "local" ? `${source.origin} (${source.url})` : source.origin)}
        </Box>
        <Text color={status[1]}>{status[0]}</Text>
      </Box>
      <Hints theme={theme} hints={ready ? [["enter", "continue"], ["esc", "quit"]] : [["esc", "quit"]]} />
    </Box>
  );
}
