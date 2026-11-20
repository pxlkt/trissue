import { Box, Text } from "ink";
import { useState, type ReactNode } from "react";
import { linkIncludesIssue } from "trissue-embedded";
import { ButtonRow, Hints, Modal, Panel } from "./components.tsx";
import type { Controller } from "./controller.ts";
import { useKeys } from "./keys.ts";
import { TextArea } from "./textarea.tsx";
import type { Theme } from "./theme.ts";

const LIST_ROWS = 8;

/** Picks a model, then starts the investigation with it. */
function ModelPicker({ controller: c, theme }: { controller: Controller; theme: Theme }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const state = c.sessionState();
  const session = state.status === "ready" ? state.session : null;
  const allowed = session ? c.allowedModels(session) : [];
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = allowed.filter((model) => words.every((word) => `${model.name} ${model.id}`.toLowerCase().includes(word)));
  const windowStart = Math.min(Math.max(index - LIST_ROWS + 1, 0), Math.max(matches.length - LIST_ROWS, 0));

  useKeys((key) => {
    if (key.name === "escape") c.setModal(null);
    else if (key.name === "up") setIndex((value) => Math.max(value - 1, 0));
    else if (key.name === "down") setIndex((value) => Math.min(value + 1, Math.max(matches.length - 1, 0)));
    else if (key.name === "return") {
      const model = matches[index];
      if (model) void c.start(model.id);
    }
  });

  const harnessName = c.harness()?.name ?? "The agent";
  const filter = c.config()?.models;
  let body: ReactNode;
  if (state.status === "starting") body = <Text color={theme.muted}>Starting {harnessName}…</Text>;
  else if (state.status === "failed") body = <Text color={theme.danger}>{state.error}</Text>;
  else if (session && session.models.length === 0) body = <Text color={theme.text}>{harnessName} doesn't list its models. Use its default model instead.</Text>;
  else if (session && allowed.length === 0)
    body = (
      <Box flexDirection="column" gap={1}>
        <Text color={theme.danger} bold>
          No models are available
        </Text>
        <Text color={theme.text}>This repo doesn't allow any of {harnessName}'s models. Choose another agent.</Text>
        {filter?.allow?.length ? <Text color={theme.muted}>Allowed: {filter.allow.join(", ")}</Text> : null}
        {filter?.block?.length ? <Text color={theme.muted}>Blocked: {filter.block.join(", ")}</Text> : null}
      </Box>
    );
  else if (session)
    body = (
      <Box flexDirection="column" gap={1}>
        <Panel borderColor={theme.border} backgroundColor={theme.background} paddingX={1} height={3}>
          <TextArea
            value={query}
            onChange={(value) => {
              setQuery(value);
              setIndex(0);
            }}
            theme={theme}
            focused
            height={1}
            singleLine
            placeholder="Search"
          />
        </Panel>
        <Box flexDirection="column" height={LIST_ROWS}>
          {matches.length === 0 ? (
            <Text color={theme.muted}>No models match "{query}".</Text>
          ) : (
            matches.slice(windowStart, windowStart + LIST_ROWS).map((model, offset) => {
              const active = windowStart + offset === index;
              const isDefault = model.id === session.currentModel?.id;
              return (
                <Box key={model.id} flexDirection="row" justifyContent="space-between" backgroundColor={active ? theme.focus : theme.background} paddingX={1} gap={2}>
                  <Text color={active ? theme.background : theme.text} bold={active} wrap="truncate-end">
                    {model.name}
                  </Text>
                  <Text color={active ? theme.background : theme.faint} wrap="truncate-start">
                    {isDefault ? "default" : model.id}
                  </Text>
                </Box>
              );
            })
          )}
        </Box>
      </Box>
    );

  return (
    <Modal theme={theme} title="Select model" width={60}>
      {body}
      <Hints theme={theme} hints={session && allowed.length ? [["↑↓", "choose"], ["enter", "start"], ["esc", "close"]] : [["esc", "close"]]} />
    </Modal>
  );
}

/** A dialog with a message and a row of buttons. */
function Confirm({ theme, title, children, buttons, onClose }: { theme: Theme; title: string; children: ReactNode; buttons: { label: string; run: () => void }[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  useKeys((key) => {
    if (key.name === "escape") onClose();
    else if (key.name === "left") setIndex((value) => Math.max(value - 1, 0));
    else if (key.name === "right" || key.name === "tab") setIndex((value) => Math.min(value + 1, buttons.length - 1));
    else if (key.name === "return") buttons[index]?.run();
  });
  return (
    <Modal theme={theme} title={title}>
      <Box flexDirection="column" gap={1}>
        {children}
      </Box>
      <ButtonRow theme={theme} focused index={index} items={buttons.map((button) => ({ label: button.label }))} />
    </Modal>
  );
}

function shorten(url: string, max = 120): string {
  return url.length > max ? `${url.slice(0, max - 1)}…` : url;
}

export function Modals({ controller: c, theme }: { controller: Controller; theme: Theme }) {
  const close = () => c.setModal(null);
  const modal = c.modal();
  if (!modal) return null;

  switch (modal.name) {
    case "models":
      return <ModelPicker controller={c} theme={theme} />;
    case "github-confirm":
      return (
        <Confirm
          key={modal.name}
          theme={theme}
          title="File an issue on GitHub?"
          onClose={close}
          buttons={[
            { label: "File issue", run: () => void c.fileOnGitHub(modal.repo) },
            { label: "Cancel", run: close },
          ]}
        >
          <Text color={theme.text}>
            This runs <Text bold>gh issue create</Text> and posts the issue to <Text bold>{modal.repo}</Text> as <Text bold>@{modal.login}</Text>.
          </Text>
          <Text color={theme.muted}>Issues on public repos can be read by anyone.</Text>
        </Confirm>
      );
    case "github-signin":
      return (
        <Confirm
          key={modal.name}
          theme={theme}
          title="Sign in to GitHub"
          onClose={close}
          buttons={[
            { label: "Sign in", run: () => void c.signInToGitHub() },
            { label: "Cancel", run: close },
          ]}
        >
          <Text color={theme.text}>Filing an issue needs the GitHub CLI signed in.</Text>
          <Text color={theme.muted}>
            Sign in hands this terminal to <Text color={theme.text}>gh auth login</Text>, which opens GitHub in your browser. You come back here when it's done.
          </Text>
        </Confirm>
      );
    case "github-missing":
      return (
        <Confirm
          key={modal.name}
          theme={theme}
          title="The GitHub CLI isn't installed"
          onClose={close}
          buttons={[
            { label: "Open cli.github.com", run: () => void c.open("https://cli.github.com") },
            { label: "Close", run: close },
          ]}
        >
          <Text color={theme.text}>Filing an issue uses the GitHub CLI (gh). Install it, then choose File an issue on GitHub again.</Text>
        </Confirm>
      );
    case "filed":
      return (
        <Confirm
          key={modal.name}
          theme={theme}
          title="Issue filed"
          onClose={close}
          buttons={[
            { label: "Open issue", run: () => void c.open(modal.url) },
            { label: "Done", run: close },
          ]}
        >
          <Text color={theme.text}>{modal.url}</Text>
        </Confirm>
      );
    case "link":
      return (
        <Confirm
          key={modal.name}
          theme={theme}
          title={`Open ${modal.link.label}?`}
          onClose={close}
          buttons={[
            { label: "Open link", run: () => void c.open(modal.url) },
            { label: "Cancel", run: close },
          ]}
        >
          {modal.link.description && <Text color={theme.text}>{modal.link.description}</Text>}
          <Text color={theme.text}>
            {linkIncludesIssue(modal.link) ? "The link includes the issue's title and text." : "The link doesn't include the issue. Copy it first if you want to paste it there."}
          </Text>
          <Text color={theme.muted}>{shorten(modal.url)}</Text>
        </Confirm>
      );
  }
}
