import { AgentSession, type AgentEvent } from "./agent.ts";
import { loadConfig, type TrissueConfig } from "./config.ts";
import { detectHarnesses, type Harness } from "./harnesses.ts";
import { parseIssue, type Issue } from "./issue.ts";
import { filterModels, hasModelFilter, isModelAllowed } from "./models.ts";
import { buildPrompt } from "./prompt.ts";
import { fetchSource, resolveSource, type FetchedSource } from "./source.ts";

export class TriageError extends Error {
  override name = "TriageError";
}

export interface TriageOptions {
  /** What the user says is wrong. */
  issue: string;
  /** `owner/repo`, a clone URL, or a folder. Ignored when `source` is given. */
  repo?: string;
  /** Branch, tag or commit to check out when downloading. */
  ref?: string;
  /** An already fetched source. The caller disposes it. */
  source?: FetchedSource;
  /** Harness id, like "claude". Defaults to the first one installed. */
  harness?: string;
  /** Model id. Defaults to the agent's default model. */
  model?: string;
  onEvent?: (event: AgentEvent) => void;
  /** Aborting stops the agent; the promise rejects with StoppedError. */
  signal?: AbortSignal;
}

export interface TriageResult {
  issue: Issue;
  config: TrissueConfig | null;
  source: FetchedSource;
  harness: Harness;
  model?: string;
}

/** Picks a harness by id from the installed ones, or the first installed one. */
export function pickHarness(id?: string): Harness {
  const installed = detectHarnesses();
  if (installed.length === 0) throw new TriageError("No coding agents are installed. Install Claude Code, Codex, or another ACP agent.");
  if (!id) return installed[0]!;
  const harness = installed.find((candidate) => candidate.id === id);
  if (!harness) throw new TriageError(`"${id}" isn't installed. Installed: ${installed.map((candidate) => candidate.id).join(", ")}.`);
  return harness;
}

/**
 * Picks the model a session will use under the repository's filter: the
 * requested one, else the agent's default. Throws when the filter allows neither.
 */
export async function chooseModel(session: AgentSession, config: TrissueConfig | null, requested?: string): Promise<string | undefined> {
  const filter = config?.models;
  const harnessId = session.harness.id;
  if (requested) {
    if (session.models.length && !session.models.some((model) => model.id === requested)) {
      throw new TriageError(`${session.harness.name} has no model "${requested}".`);
    }
    if (!isModelAllowed(filter, harnessId, requested)) throw new TriageError(`This repository doesn't allow ${requested}.`);
    await session.setModel(requested);
    return requested;
  }
  const current = session.currentModel?.id;
  if (!hasModelFilter(filter)) return current;
  if (!current) throw new TriageError(`This repository only allows some models, and ${session.harness.name} doesn't say which model it uses.`);
  if (isModelAllowed(filter, harnessId, current)) return current;
  const allowed = filterModels(filter, harnessId, session.models);
  if (allowed.length === 0) throw new TriageError(`None of ${session.harness.name}'s models are allowed by this repository.`);
  throw new TriageError(`This repository doesn't allow ${current}, ${session.harness.name}'s default. Pick one of: ${allowed.map((model) => model.id).join(", ")}.`);
}

/**
 * The whole flow without an interface: fetch the repository, start the
 * agent, investigate, and return the written issue. Sending it is up to the
 * caller (see `fileGitHubIssue`, `copyIssue`, `buildLink`).
 */
export async function runTriage(options: TriageOptions): Promise<TriageResult> {
  if (!options.issue.trim()) throw new TriageError("Describe the issue first.");
  const harness = pickHarness(options.harness);
  const source = options.source ?? (await fetchSource(await resolveSource(options.repo, options.ref)));
  let session: AgentSession | null = null;
  try {
    const config = await loadConfig(source.dir);
    session = await AgentSession.start({ harness, cwd: source.dir, onEvent: options.onEvent });
    const model = await chooseModel(session, config, options.model);
    const stop = () => session?.stop();
    options.signal?.addEventListener("abort", stop, { once: true });
    if (options.signal?.aborted) stop();
    const text = await session.run(
      buildPrompt({
        issue: options.issue,
        source,
        instructions: config?.instructions,
        harnessName: harness.name,
        modelName: session.models.find((candidate) => candidate.id === model)?.name ?? model,
      }),
    );
    options.signal?.removeEventListener("abort", stop);
    return { issue: parseIssue(text), config, source, harness, model };
  } catch (error) {
    if (!options.source) await source.dispose();
    throw error;
  } finally {
    session?.close();
  }
}
