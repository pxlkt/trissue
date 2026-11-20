import { batch, createSignal } from "solid-js";
import { AgentSession, StoppedError } from "../core/agent.ts";
import { loadConfig, type LinkTarget, type TrissueConfig } from "../core/config.ts";
import type { Harness } from "../core/harnesses.ts";
import { formatIssue, parseIssue, RejectedError, type Issue } from "../core/issue.ts";
import { filterModels, hasModelFilter, isModelAllowed, type ModelOption } from "../core/models.ts";
import { buildPrompt } from "../core/prompt.ts";
import { GITHUB_LOGIN_ARGS, buildLink, copyIssue, fileGitHubIssue, gitHubStatus, openUrl } from "../core/send.ts";
import { fetchSource, type FetchedSource, type RepoSource } from "../core/source.ts";
import { Transcript, type TranscriptEntry } from "../core/transcript.ts";

export type Screen = "trust" | "compose" | "running" | "result" | "error";

export type Modal =
  | { name: "models" }
  | { name: "github-confirm"; repo: string; login: string }
  | { name: "github-signin"; repo: string }
  | { name: "github-missing" }
  | { name: "filed"; url: string }
  | { name: "link"; link: LinkTarget; url: string };

export type SessionState =
  | { status: "idle" }
  | { status: "starting"; harnessId: string }
  | { status: "ready"; harnessId: string; session: AgentSession }
  | { status: "failed"; harnessId: string; error: string };

export interface Toast {
  text: string;
  tone: "success" | "danger";
}

export interface ControllerOptions {
  source: RepoSource;
  harnesses: Harness[];
  /** Background from the command line. Beats the repository's. */
  background?: string;
  /** Starts with a fetched source instead of downloading one. For screenshots and embedding. */
  fetched?: FetchedSource;
  config?: TrissueConfig | null;
  /** Hands the terminal to an interactive command, like `gh auth login`. */
  runInTerminal?: (command: string, args: string[]) => Promise<number>;
  /** Copies text when the system clipboard isn't available (OSC 52 in the TUI). */
  copyFallback?: (text: string) => boolean;
}

export type Controller = ReturnType<typeof createController>;

export function createController(options: ControllerOptions) {
  const [screen, setScreen] = createSignal<Screen>("trust");
  const [modal, setModal] = createSignal<Modal | null>(null);
  const [toast, setToastSignal] = createSignal<Toast | null>(null);

  const [fetched, setFetched] = createSignal<FetchedSource | null>(options.fetched ?? null);
  const [fetchError, setFetchError] = createSignal<string | null>(null);
  const [config, setConfig] = createSignal<TrissueConfig | null>(options.config ?? null);

  const [issueText, setIssueText] = createSignal("");
  const [harnessIndex, setHarnessIndex] = createSignal(0);
  const [modelId, setModelId] = createSignal<string | null>(null);
  const [sessionState, setSessionState] = createSignal<SessionState>({ status: "idle" });

  const [entries, setEntries] = createSignal<readonly TranscriptEntry[]>([], { equals: false });
  const [startedAt, setStartedAt] = createSignal(0);
  const [issue, setIssue] = createSignal<Issue | null>(null);
  const [error, setError] = createSignal<{ title: string; message: string } | null>(null);
  const [busy, setBusy] = createSignal<string | null>(null);

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function showToast(text: string, tone: Toast["tone"] = "success") {
    clearTimeout(toastTimer);
    setToastSignal({ text, tone });
    toastTimer = setTimeout(() => setToastSignal(null), 3500);
  }

  // Download the repository right away; the trust screen shows progress.
  if (!options.fetched) {
    void (async () => {
      try {
        const source = await fetchSource(options.source);
        const loaded = await loadConfig(source.dir).catch(async (error) => {
          await source.dispose();
          throw error;
        });
        batch(() => {
          setFetched(source);
          setConfig(loaded);
        });
      } catch (error) {
        setFetchError((error as Error).message);
      }
    })();
  }

  const harness = () => options.harnesses[harnessIndex()];

  /** Changes come in order; an older start that finishes late is closed and ignored. */
  let sessionToken = 0;

  function closeSession() {
    sessionToken++;
    const state = sessionState();
    if (state.status === "ready") state.session.close();
    setSessionState({ status: "idle" });
  }

  function selectHarness(index: number) {
    if (index === harnessIndex()) return;
    batch(() => {
      closeSession();
      setHarnessIndex(index);
      setModelId(null);
    });
  }

  /** Starts the selected agent, or returns the one already running for it. */
  async function prepareSession(): Promise<AgentSession | null> {
    const chosen = harness();
    const source = fetched();
    if (!chosen || !source) return null;
    const state = sessionState();
    if (state.status === "ready" && state.harnessId === chosen.id) return state.session;
    if (state.status === "starting" && state.harnessId === chosen.id) return waitForSession(chosen.id);

    const token = ++sessionToken;
    setSessionState({ status: "starting", harnessId: chosen.id });
    try {
      const session = await AgentSession.start({ harness: chosen, cwd: source.dir, onEvent: onAgentEvent });
      if (token !== sessionToken) {
        session.close();
        return null;
      }
      setSessionState({ status: "ready", harnessId: chosen.id, session });
      return session;
    } catch (error) {
      if (token === sessionToken) setSessionState({ status: "failed", harnessId: chosen.id, error: (error as Error).message });
      return null;
    }
  }

  function waitForSession(harnessId: string): Promise<AgentSession | null> {
    return new Promise((resolve) => {
      const check = () => {
        const state = sessionState();
        if (state.status === "ready" && state.harnessId === harnessId) resolve(state.session);
        else if (state.status !== "starting" || state.harnessId !== harnessId) resolve(null);
        else setTimeout(check, 50);
      };
      check();
    });
  }

  let transcript = new Transcript();
  let flushQueued = false;
  function onAgentEvent(event: Parameters<Transcript["apply"]>[0]) {
    if (screen() !== "running") return;
    transcript.apply(event);
    if (flushQueued) return;
    flushQueued = true;
    setTimeout(() => {
      flushQueued = false;
      setEntries(transcript.entries);
    }, 33);
  }

  /** Models the repository allows for the selected agent. */
  function allowedModels(session: AgentSession): ModelOption[] {
    return filterModels(config()?.models, session.harness.id, session.models);
  }

  function modelProblem(session: AgentSession, id: string | null): string | null {
    const filter = config()?.models;
    if (id) return isModelAllowed(filter, session.harness.id, id) ? null : `This repo doesn't allow ${id}.`;
    if (!hasModelFilter(filter)) return null;
    const current = session.currentModel;
    if (!current) return `This repo only allows some models, and ${session.harness.name} doesn't say which model it uses by default.`;
    return isModelAllowed(filter, session.harness.id, current.id) ? null : `This repo doesn't allow ${current.name}, ${session.harness.name}'s default. Pick another model.`;
  }

  /** Starts the investigation with the chosen model, or the default when `id` is null. */
  async function start(id: string | null) {
    if (!issueText().trim()) {
      showToast("Explain the issue first.", "danger");
      return false;
    }
    const session = await prepareSession();
    if (!session) {
      const state = sessionState();
      if (state.status === "failed") showToast(state.error, "danger");
      return false;
    }
    const problem = modelProblem(session, id);
    if (problem) {
      showToast(problem, "danger");
      setModal({ name: "models" });
      return false;
    }
    try {
      if (id) await session.setModel(id);
    } catch (error) {
      showToast((error as Error).message, "danger");
      return false;
    }

    const source = fetched()!;
    const chosen = id ?? session.currentModel?.id ?? null;
    transcript = new Transcript();
    batch(() => {
      setModelId(chosen);
      setModal(null);
      setEntries([]);
      setStartedAt(Date.now());
      setScreen("running");
    });

    const modelName = session.models.find((model) => model.id === chosen)?.name ?? chosen ?? undefined;
    try {
      const text = await session.run(
        buildPrompt({ issue: issueText(), source, instructions: config()?.instructions, harnessName: session.harness.name, modelName }),
      );
      const parsed = parseIssue(text);
      batch(() => {
        setIssue(parsed);
        setScreen("result");
      });
    } catch (error) {
      const title = error instanceof StoppedError ? "Stopped" : error instanceof RejectedError ? "The agent rejected this task" : "Error";
      batch(() => {
        setError({ title, message: (error as Error).message });
        setScreen("error");
      });
    } finally {
      // A session runs one investigation. Trying again starts a fresh one.
      closeSession();
    }
    return true;
  }

  function steer(text: string) {
    const state = sessionState();
    if (state.status === "ready") state.session.steer(text);
  }

  function stop() {
    const state = sessionState();
    if (state.status === "ready") state.session.stop();
  }

  function tryAgain() {
    batch(() => {
      setError(null);
      setIssue(null);
      setScreen("compose");
    });
  }

  const githubRepo = () => {
    const configured = config()?.github;
    if (configured === false) return null;
    return configured ?? fetched()?.github ?? null;
  };

  async function beginGitHub() {
    const repo = githubRepo();
    if (!repo) return;
    setBusy("Checking GitHub sign-in…");
    try {
      const status = await gitHubStatus();
      if (status.state === "missing") setModal({ name: "github-missing" });
      else if (status.state === "signed-out") setModal({ name: "github-signin", repo });
      else setModal({ name: "github-confirm", repo, login: status.login });
    } catch (error) {
      showToast(`Couldn't check GitHub sign-in: ${(error as Error).message}`, "danger");
    } finally {
      setBusy(null);
    }
  }

  async function signInToGitHub() {
    setModal(null);
    if (!options.runInTerminal) {
      showToast("Sign in with `gh auth login`, then try again.", "danger");
      return;
    }
    const code = await options.runInTerminal("gh", GITHUB_LOGIN_ARGS);
    if (code !== 0) {
      showToast("GitHub sign-in didn't finish.", "danger");
      return;
    }
    await beginGitHub();
  }

  async function fileOnGitHub(repo: string) {
    const current = issue();
    if (!current) return;
    setModal(null);
    setBusy("Filing the issue…");
    try {
      const url = await fileGitHubIssue(repo, current, config()?.labels ?? []);
      setModal({ name: "filed", url });
    } catch (error) {
      showToast(`Couldn't file the issue: ${(error as Error).message}`, "danger");
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    const current = issue();
    if (!current) return;
    try {
      await copyIssue(current);
      showToast("Copied the issue.");
    } catch (error) {
      if (options.copyFallback?.(formatIssue(current))) showToast("Copied the issue through your terminal.");
      else showToast((error as Error).message, "danger");
    }
  }

  function chooseLink(link: LinkTarget) {
    const current = issue();
    if (!current) return;
    setModal({ name: "link", link, url: buildLink(link, current) });
  }

  async function open(url: string) {
    try {
      await openUrl(url);
      setModal(null);
    } catch (error) {
      showToast((error as Error).message, "danger");
    }
  }

  function dispose() {
    closeSession();
    clearTimeout(toastTimer);
    return fetched()?.dispose();
  }

  return {
    options,
    screen,
    setScreen,
    modal,
    setModal,
    toast,
    showToast,
    fetched,
    fetchError,
    config,
    issueText,
    setIssueText,
    harnesses: options.harnesses,
    harness,
    harnessIndex,
    selectHarness,
    modelId,
    sessionState,
    prepareSession,
    allowedModels,
    entries,
    startedAt,
    issue,
    error,
    busy,
    start,
    steer,
    stop,
    tryAgain,
    githubRepo,
    beginGitHub,
    signInToGitHub,
    fileOnGitHub,
    copy,
    chooseLink,
    open,
    dispose,
    /** For screenshots: puts the controller in a given state without running an agent. */
    debug: { setEntries, setIssue, setError, setStartedAt, setSessionState, setModelId },
  };
}
