import { Box, Text } from "ink";
import stringWidth from "string-width";
import { BASE_THEME, themeFor, veiled } from "./theme.ts";
import { FrameSize, Panel, useScreenSize } from "./components.tsx";
import type { Controller } from "./controller.ts";
import { useKeys } from "./keys.ts";
import { Modals } from "./modals.tsx";
import { ComposeScreen } from "./screens/compose.tsx";
import { ErrorScreen, ResultScreen } from "./screens/result.tsx";
import { RunningScreen } from "./screens/running.tsx";
import { TrustScreen } from "./screens/trust.tsx";
import { useStore } from "./store.ts";

/**
 * The largest the frame gets. In a bigger terminal it stays this size and
 * sits in the middle, instead of stretching into a corner-heavy layout.
 */
export const MAX_FRAME = { width: 110, height: 36 };
/** Cells the frame's border and padding take from each axis. */
const FRAME_INSET = { x: 2 + 4, y: 2 + 2 };

export function App({ controller: c, onQuit }: { controller: Controller; onQuit: () => void }) {
  useStore(c.store);
  const screen = useScreenSize();
  const trusted = c.screen() !== "trust";
  // Nothing from the repository styles the trust screen.
  const theme = trusted ? themeFor(c.config(), { background: c.options.background }) : BASE_THEME;
  // The screen behind a modal is drawn through its scrim.
  const behind = c.modal() ? veiled(theme) : theme;
  const product = c.config()?.product?.name ?? c.options.source.name;
  const source = c.options.source;
  const detail = source.org ? `${source.org}/${source.name}` : source.name;
  const frame = { width: Math.min(screen.columns, MAX_FRAME.width), height: Math.min(screen.rows, MAX_FRAME.height) };
  const inner = { width: Math.max(frame.width - FRAME_INSET.x, 1), height: Math.max(frame.height - FRAME_INSET.y, 1) };
  const toast = c.toast();

  useKeys((key) => {
    if (key.ctrl && key.name === "c") onQuit();
  });

  const screens = {
    trust: () => <TrustScreen controller={c} onQuit={onQuit} />,
    compose: () => <ComposeScreen controller={c} theme={behind} product={product} detail={detail} />,
    running: () => <RunningScreen controller={c} theme={behind} product={product} detail={detail} />,
    result: () => <ResultScreen controller={c} theme={behind} product={product} detail={detail} onQuit={onQuit} />,
    error: () => <ErrorScreen controller={c} theme={behind} product={product} detail={detail} onQuit={onQuit} />,
  };

  return (
    <FrameSize.Provider value={inner}>
      <Box width={screen.columns} height={screen.rows} backgroundColor={behind.background} alignItems="center" justifyContent="center">
        <Panel
          width={frame.width}
          height={frame.height}
          borderColor={behind.border}
          backgroundColor={behind.background}
          paddingX={2}
          paddingY={1}
          flexDirection="column"
        >
          {screens[c.screen()]()}
        </Panel>
        {toast && (
          <Box position="absolute" width={frame.width} height={frame.height} flexDirection="column" justifyContent="flex-end" alignItems="flex-end" paddingRight={3}>
            <Box backgroundColor={toast.tone === "danger" ? theme.danger : theme.success} paddingX={1} width={Math.min(stringWidth(toast.text) + 4, Math.floor(frame.width * 0.7))}>
              <Text color={theme.background} bold>
                {`${toast.tone === "danger" ? "⚠" : "✓"} ${toast.text}`}
              </Text>
            </Box>
          </Box>
        )}
        {c.modal() && <Modals controller={c} theme={theme} />}
      </Box>
    </FrameSize.Provider>
  );
}
