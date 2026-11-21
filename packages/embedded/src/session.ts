import { spawn, type ChildProcess } from "node:child_process";
import type { Harness, LaunchSpec } from "./harnesses.ts";
import type { ModelOption } from "./models.ts";
import { buildRefusedPrompt, buildSteerPrompt } from "./prompt.ts";

/** Something the agent did, in the order it happened. */
export type AgentEvent =
  | { type: "text"; channel: "thought" | "message"; text: string }
  | { type: "tool"; id: string; title: string; kind: string; status: string }
  /** A tool call trissue refused, because it could change or leave the computer. */
  | { type: "blocked"; id: string; title: string; kind: string }
  | { type: "steer"; text: string }
  | { type: "notice"; text: string };

export class AgentError extends Error {
  override name = "AgentError";
}

/** The user stopped the agent. */
export class StoppedError extends Error {
  override name = "StoppedError";
  constructor() {
    super("You stopped the agent.");
  }
}

export interface StartOptions {
  harness: Harness;
  /** The folder the agent investigates. */
  cwd: string;
  onEvent?: (event: AgentEvent) => void;
  /** Overrides how the agent is launched. For tests and custom setups. */
  launch?: LaunchSpec;
}

/** How a turn ended: finished, or cancelled by trissue (to steer or stop). */
export type TurnEnd = "end" | "cancelled";

const STDERR_LIMIT = 4000;
/** How many times an agent that stopped after a refused tool is asked to carry on. */
const MAX_REFUSED_FOLLOW_UPS = 3;

/** A running agent process, with its last stderr kept for error messages. */
export interface AgentProcess {
  child: ChildProcess;
  /** Rejects with an AgentError when the process fails to start or exits. Never resolves. */
  exited: Promise<never>;
}

export function spawnAgent(name: string, spec: LaunchSpec, cwd: string): AgentProcess {
  const child = spawn(spec.command, spec.args, { cwd, env: { ...process.env, ...spec.env }, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_LIMIT);
  });
  const exited = new Promise<never>((_, reject) => {
    child.once("error", (error) => {
      const message = (error as NodeJS.ErrnoException).code === "ENOENT" ? `${spec.command} isn't installed.` : error.message;
      reject(new AgentError(`Couldn't start ${name}: ${message}`));
    });
    child.once("exit", (code, signal) => {
      const how = signal ? `was killed (${signal})` : `exited with code ${code}`;
      const tail = stderr.trim().split("\n").slice(-6).join("\n");
      reject(new AgentError(`${name} ${how}.${tail ? `\n${tail}` : ""}`));
    });
  });
  exited.catch(() => {}); // quiet: callers race `exited`, which reports the failure.
  return { child, exited };
}

/**
 * One agent and one conversation with it. Start it with `startAgent`,
 * optionally pick a model, then `run` the prompt. The agent can only read the
 * repository.
 */
export abstract class AgentSession {
  /** Models the agent offers, before any repository filter. Empty when it doesn't list them. */
  readonly models: ModelOption[];
  protected modelId: string | undefined;

  private running = false;
  private pendingSteer: string | null = null;
  private stopped = false;
  /** Everything the agent has said (not its thinking), across turns. */
  private said = "";
  /** Whether trissue refused a tool in the current turn. */
  private refusedThisTurn = false;
  private readonly listener: ((event: AgentEvent) => void) | undefined;

  protected constructor(
    readonly harness: Harness,
    models: ModelOption[],
    modelId: string | undefined,
    onEvent: ((event: AgentEvent) => void) | undefined,
  ) {
    this.models = models;
    this.modelId = modelId;
    this.listener = onEvent;
  }

  /** Sends one prompt and resolves when the agent's turn ends. Throws AgentError on failure. */
  protected abstract promptTurn(text: string): Promise<TurnEnd>;
  /** Asks the agent to end the current turn; `promptTurn` then resolves "cancelled". */
  protected abstract cancelTurn(): void;
  protected abstract applyModel(id: string): Promise<void>;
  /** Ends the agent process. */
  protected abstract dispose(): void;
  /** Whether the agent lets trissue pick the model. */
  abstract readonly canSetModel: boolean;

  protected emit(event: AgentEvent): void {
    if (event.type === "text" && event.channel === "message") this.said += event.text;
    if (event.type === "blocked") this.refusedThisTurn = true;
    this.listener?.(event);
  }

  /** The model the session uses now, if the agent says. */
  get currentModel(): ModelOption | undefined {
    return this.models.find((model) => model.id === this.modelId);
  }

  async setModel(id: string): Promise<void> {
    if (!this.canSetModel) throw new AgentError(`${this.harness.name} doesn't let trissue pick a model.`);
    if (id === this.modelId) return;
    await this.applyModel(id);
    this.modelId = id;
  }

  /**
   * Sends the prompt and waits until the agent is done. Returns everything the
   * agent said, across steered turns.
   */
  async run(prompt: string): Promise<string> {
    if (this.running) throw new AgentError("The agent is already working.");
    let text = prompt;
    let followUps = 0;
    try {
      for (;;) {
        if (this.stopped) throw new StoppedError();
        this.running = true;
        this.refusedThisTurn = false;
        const end = await this.promptTurn(text);
        if (end === "end") {
          const answered = this.said.includes("<trissue-issue>") || this.said.includes("<trissue-rejected>");
          if (answered || !this.refusedThisTurn || followUps >= MAX_REFUSED_FOLLOW_UPS) return this.said;
          // The agent gave up after a refused tool. Tell it why and let it go on.
          followUps++;
          this.emit({ type: "notice", text: "trissue refused that step. Asking the agent to continue with read-only tools." });
          text = buildRefusedPrompt();
          continue;
        }
        if (this.stopped) throw new StoppedError();
        if (this.pendingSteer === null) throw new AgentError(`${this.harness.name} cancelled the task on its own.`);
        text = buildSteerPrompt(this.pendingSteer);
        this.pendingSteer = null;
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Sends the user's words to the agent mid-task. The current turn is
   * cancelled and a new one starts with the steering, in the same conversation.
   */
  steer(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.emit({ type: "steer", text: trimmed });
    this.pendingSteer = this.pendingSteer ? `${this.pendingSteer}\n\n${trimmed}` : trimmed;
    if (this.running) this.cancelTurn();
  }

  /** Stops the agent. `run` rejects with StoppedError. */
  stop(): void {
    this.stopped = true;
    if (this.running) this.cancelTurn();
    else this.close();
  }

  /** Ends the session and the agent process. */
  close(): void {
    this.stopped = true;
    this.dispose();
  }
}
