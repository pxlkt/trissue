import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { Harness } from "./harnesses.ts";
import type { ModelOption } from "./models.ts";
import { buildSteerPrompt } from "./prompt.ts";

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

/** Tool kinds an agent may use without asking: they only look at the repository. */
const SAFE_KINDS = new Set(["read", "search", "think"]);

const READ_ONLY_MODE = /^(read[-_ ]?only|readonly)$/i;

const STDERR_LIMIT = 4000;

export interface StartOptions {
  harness: Harness;
  /** The folder the agent investigates. */
  cwd: string;
  onEvent?: (event: AgentEvent) => void;
  /** Overrides how the agent is launched. For tests and custom setups. */
  launch?: Harness["launch"];
}

function flattenOptions(options: acp.SessionConfigSelectOptions): ModelOption[] {
  const out: ModelOption[] = [];
  for (const entry of options as Array<acp.SessionConfigSelectOption | acp.SessionConfigSelectGroup>) {
    if ("options" in entry) out.push(...flattenOptions(entry.options));
    else out.push({ id: entry.value, name: entry.name, description: entry.description ?? undefined });
  }
  return out;
}

interface UnstableModels {
  availableModels: { modelId: string; name: string; description?: string | null }[];
  currentModelId: string;
}

/**
 * One agent process and one ACP session in it. Start it, optionally pick a
 * model, then `run` the prompt. The agent can only read: trissue refuses every
 * tool call that would edit, run, or fetch.
 */
export class AgentSession {
  readonly harness: Harness;
  /** Models the agent offers, before any repository filter. Empty when it doesn't list them. */
  readonly models: ModelOption[];
  private modelId: string | undefined;
  private readonly setModelRequest: ((id: string) => Promise<void>) | null;

  private turn: Promise<acp.PromptResponse> | null = null;
  private pendingSteer: string | null = null;
  private stopped = false;

  private constructor(
    private readonly child: ChildProcess,
    private readonly connection: acp.ClientConnection,
    private readonly sessionId: string,
    private readonly emit: (event: AgentEvent) => void,
    /** Everything the agent has said, filled in by `emit`. */
    private readonly said: { text: string },
    /** Rejects when the agent process ends. */
    private readonly exited: Promise<never>,
    harness: Harness,
    models: ModelOption[],
    modelId: string | undefined,
    setModel: ((id: string) => Promise<void>) | null,
  ) {
    this.harness = harness;
    this.models = models;
    this.modelId = modelId;
    this.setModelRequest = setModel;
  }

  /** Launches the agent, connects over ACP, and opens a read-only session in `cwd`. */
  static async start(options: StartOptions): Promise<AgentSession> {
    const { harness } = options;
    const said = { text: "" };
    const emit = (event: AgentEvent) => {
      if (event.type === "text" && event.channel === "message") said.text += event.text;
      options.onEvent?.(event);
    };
    const spec = options.launch ?? harness.launch;

    const child = spawn(spec.command, spec.args, {
      cwd: options.cwd,
      env: { ...process.env, ...spec.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_LIMIT);
    });
    const describeExit = (code: number | null, signal: NodeJS.Signals | null) => {
      const how = signal ? `was killed (${signal})` : `exited with code ${code}`;
      const tail = stderr.trim().split("\n").slice(-6).join("\n");
      return `${harness.name} ${how}.${tail ? `\n${tail}` : ""}`;
    };

    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>,
    );

    const app = acp
      .client({ name: "trissue" })
      .onNotification(acp.methods.client.session.update, (context) => {
        const update = context.params.update;
        switch (update.sessionUpdate) {
          case "agent_message_chunk":
          case "agent_thought_chunk":
            if (update.content.type === "text") {
              emit({ type: "text", channel: update.sessionUpdate === "agent_message_chunk" ? "message" : "thought", text: update.content.text });
            }
            break;
          case "tool_call":
            emit({ type: "tool", id: update.toolCallId, title: update.title, kind: update.kind ?? "other", status: update.status ?? "pending" });
            break;
          case "tool_call_update":
            emit({ type: "tool", id: update.toolCallId, title: update.title ?? "", kind: update.kind ?? "", status: update.status ?? "" });
            break;
        }
      })
      .onRequest(acp.methods.client.session.requestPermission, (context) => {
        const { toolCall, options: choices } = context.params;
        const kind = toolCall.kind ?? "other";
        const allow = SAFE_KINDS.has(kind);
        const choice = choices.find((option) => option.kind === (allow ? "allow_once" : "reject_once"));
        if (!allow) emit({ type: "blocked", id: toolCall.toolCallId, title: toolCall.title ?? kind, kind });
        return choice ? { outcome: { outcome: "selected", optionId: choice.optionId } } : { outcome: { outcome: "cancelled" } };
      });

    const connection = app.connect(stream);

    const exited = new Promise<never>((_, reject) => {
      child.once("error", (error) => {
        const message = (error as NodeJS.ErrnoException).code === "ENOENT" ? `${spec.command} isn't installed.` : error.message;
        connection.close(new AgentError(message));
        reject(new AgentError(`Couldn't start ${harness.name}: ${message}`));
      });
      child.once("exit", (code, signal) => {
        const error = new AgentError(describeExit(code, signal));
        connection.close(error);
        reject(error);
      });
    });
    exited.catch(() => {}); // quiet: every await below races `exited`, which reports the failure.

    const race = <T>(promise: Promise<T>) => Promise.race([promise, exited]);

    try {
      const init = await race(
        connection.agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: { name: "trissue", version: "0.1.0" },
        }),
      );

      let session: acp.NewSessionResponse;
      try {
        session = await race(connection.agent.request(acp.methods.agent.session.new, { cwd: options.cwd, mcpServers: [] }));
      } catch (error) {
        if (error instanceof acp.RequestError && error.code === -32000) {
          const methods = init.authMethods?.map((method) => method.name).join(", ");
          throw new AgentError(`${harness.name} isn't signed in. Open ${harness.name} in a terminal, sign in${methods ? ` (${methods})` : ""}, then try again.`);
        }
        throw error;
      }

      const sessionId = session.sessionId;
      const request = <M extends acp.AgentRequestMethod>(method: M, params: acp.AgentRequestParamsByMethod[M]) =>
        race(connection.agent.request(method, params));

      // Prefer a read-only mode when the agent has one. Permission requests are refused either way.
      const modeOption = session.configOptions?.find((option) => option.category === "mode" && option.type === "select");
      const readOnlyValue =
        modeOption?.type === "select" ? flattenOptions(modeOption.options).find((option) => READ_ONLY_MODE.test(option.id) || READ_ONLY_MODE.test(option.name)) : undefined;
      if (modeOption && readOnlyValue && modeOption.type === "select" && modeOption.currentValue !== readOnlyValue.id) {
        await request(acp.methods.agent.session.setConfigOption, { sessionId, configId: modeOption.id, value: readOnlyValue.id });
      } else if (!modeOption && session.modes) {
        const mode = session.modes.availableModes.find((option) => READ_ONLY_MODE.test(option.id) || READ_ONLY_MODE.test(option.name));
        if (mode && mode.id !== session.modes.currentModeId) await request(acp.methods.agent.session.setMode, { sessionId, modeId: mode.id });
      }

      let models: ModelOption[] = [];
      let modelId: string | undefined;
      let setModel: ((id: string) => Promise<void>) | null = null;
      const modelOption = session.configOptions?.find((option) => option.category === "model" && option.type === "select");
      const unstable = (session as { models?: UnstableModels | null }).models;
      if (modelOption && modelOption.type === "select") {
        models = flattenOptions(modelOption.options);
        modelId = modelOption.currentValue;
        setModel = async (id) => {
          await request(acp.methods.agent.session.setConfigOption, { sessionId, configId: modelOption.id, value: id });
        };
      } else if (unstable) {
        models = unstable.availableModels.map((model) => ({ id: model.modelId, name: model.name, description: model.description ?? undefined }));
        modelId = unstable.currentModelId;
        setModel = async (id) => {
          await race(connection.agent.request("session/set_model", { sessionId, modelId: id }));
        };
      }

      return new AgentSession(child, connection, sessionId, emit, said, exited, harness, models, modelId, setModel);
    } catch (error) {
      child.kill();
      if (error instanceof AgentError) throw error;
      throw new AgentError(`${harness.name} failed to start: ${(error as Error).message}`);
    }
  }

  /** The model the session uses now, if the agent says. */
  get currentModel(): ModelOption | undefined {
    return this.models.find((model) => model.id === this.modelId);
  }

  /** Whether the agent lets trissue pick the model. */
  get canSetModel(): boolean {
    return this.setModelRequest !== null;
  }

  async setModel(id: string): Promise<void> {
    if (!this.setModelRequest) throw new AgentError(`${this.harness.name} doesn't let trissue pick a model.`);
    if (id === this.modelId) return;
    await this.setModelRequest(id);
    this.modelId = id;
  }

  /**
   * Sends the prompt and waits until the agent is done. Returns everything the
   * agent said (not its thinking), across steered turns.
   */
  async run(prompt: string): Promise<string> {
    if (this.turn) throw new AgentError("The agent is already working.");
    let text = prompt;
    for (;;) {
      if (this.stopped) throw new StoppedError();
      this.turn = Promise.race([
        this.connection.agent.request(acp.methods.agent.session.prompt, { sessionId: this.sessionId, prompt: [{ type: "text", text }] }),
        this.exited,
      ]);
      let response: acp.PromptResponse;
      try {
        response = await this.turn;
      } finally {
        this.turn = null;
      }

      if (response.stopReason === "cancelled") {
        if (this.stopped) throw new StoppedError();
        if (this.pendingSteer !== null) {
          text = buildSteerPrompt(this.pendingSteer);
          this.pendingSteer = null;
          continue;
        }
        throw new AgentError(`${this.harness.name} cancelled the task on its own.`);
      }
      if (response.stopReason === "refusal") throw new AgentError(`${this.harness.name} refused to continue.`);
      if (response.stopReason === "max_tokens") throw new AgentError(`${this.harness.name} ran out of tokens before finishing.`);
      if (response.stopReason === "max_turn_requests") throw new AgentError(`${this.harness.name} hit its turn limit before finishing.`);
      return this.said.text;
    }
  }

  /**
   * Sends the user's words to the agent mid-task. The current turn is
   * cancelled and a new one starts with the steering, in the same session.
   */
  steer(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.emit({ type: "steer", text: trimmed });
    this.pendingSteer = this.pendingSteer ? `${this.pendingSteer}\n\n${trimmed}` : trimmed;
    if (this.turn) void this.connection.agent.notify(acp.methods.agent.session.cancel, { sessionId: this.sessionId });
  }

  /** Stops the agent. `run` rejects with StoppedError. */
  stop(): void {
    this.stopped = true;
    if (this.turn) void this.connection.agent.notify(acp.methods.agent.session.cancel, { sessionId: this.sessionId });
    else this.close();
  }

  /** Ends the session and the agent process. */
  close(): void {
    this.stopped = true;
    this.connection.close();
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill();
  }
}
