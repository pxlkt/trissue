import type { ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { ModelOption } from "./models.ts";
import { AgentError, AgentSession, spawnAgent, type AgentEvent, type StartOptions, type TurnEnd } from "./session.ts";
import { VERSION } from "./version.ts";

/** Tool kinds an agent may use without asking: they only look at the repository. */
const SAFE_KINDS = new Set(["read", "search", "think"]);

const READ_ONLY_MODE = /^(read[-_ ]?only|readonly)$/i;

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
 * An agent spoken to over the Agent Client Protocol. trissue refuses every
 * permission request to edit, run, or fetch, and picks a read-only mode when
 * the agent has one.
 */
export class AcpSession extends AgentSession {
  readonly canSetModel: boolean;

  private constructor(
    options: StartOptions,
    models: ModelOption[],
    modelId: string | undefined,
    private readonly child: ChildProcess,
    private readonly connection: acp.ClientConnection,
    private readonly sessionId: string,
    private readonly exited: Promise<never>,
    private readonly modelSetter: ((id: string) => Promise<void>) | null,
  ) {
    super(options.harness, models, modelId, options.onEvent);
    this.canSetModel = modelSetter !== null;
  }

  static async start(options: StartOptions): Promise<AcpSession> {
    const { harness } = options;
    // The session doesn't exist until the handshake is done, so early events go through this.
    let forward: (event: AgentEvent) => void = (event) => options.onEvent?.(event);
    const emit = (event: AgentEvent) => forward(event);

    const { child, exited } = spawnAgent(harness.name, options.launch ?? harness.launch, options.cwd);
    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>,
    );

    const connection = acp
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
      })
      .connect(stream);
    exited.catch((error) => connection.close(error));

    const race = <T>(promise: Promise<T>) => Promise.race([promise, exited]);

    try {
      const init = await race(
        connection.agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: { name: "trissue", version: VERSION },
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
      if (modeOption?.type === "select") {
        const readOnly = flattenOptions(modeOption.options).find((option) => READ_ONLY_MODE.test(option.id) || READ_ONLY_MODE.test(option.name));
        if (readOnly && modeOption.currentValue !== readOnly.id) {
          await request(acp.methods.agent.session.setConfigOption, { sessionId, configId: modeOption.id, value: readOnly.id });
        }
      } else if (session.modes) {
        const mode = session.modes.availableModes.find((option) => READ_ONLY_MODE.test(option.id) || READ_ONLY_MODE.test(option.name));
        if (mode && mode.id !== session.modes.currentModeId) await request(acp.methods.agent.session.setMode, { sessionId, modeId: mode.id });
      }

      let models: ModelOption[] = [];
      let modelId: string | undefined;
      let setModel: ((id: string) => Promise<void>) | null = null;
      const modelOption = session.configOptions?.find((option) => option.category === "model" && option.type === "select");
      const unstable = (session as { models?: UnstableModels | null }).models;
      if (modelOption?.type === "select") {
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

      const agent = new AcpSession(options, models, modelId, child, connection, sessionId, exited, setModel);
      forward = (event) => agent.emit(event);
      return agent;
    } catch (error) {
      child.kill();
      if (error instanceof AgentError) throw error;
      throw new AgentError(`${harness.name} failed to start: ${(error as Error).message}`);
    }
  }

  protected async promptTurn(text: string): Promise<TurnEnd> {
    const response = await Promise.race([
      this.connection.agent.request(acp.methods.agent.session.prompt, { sessionId: this.sessionId, prompt: [{ type: "text", text }] }),
      this.exited,
    ]);
    switch (response.stopReason) {
      case "end_turn":
        return "end";
      case "cancelled":
        return "cancelled";
      case "refusal":
        throw new AgentError(`${this.harness.name} refused to continue.`);
      case "max_tokens":
        throw new AgentError(`${this.harness.name} ran out of tokens before finishing.`);
      case "max_turn_requests":
        throw new AgentError(`${this.harness.name} hit its turn limit before finishing.`);
    }
  }

  protected cancelTurn(): void {
    void this.connection.agent.notify(acp.methods.agent.session.cancel, { sessionId: this.sessionId });
  }

  protected async applyModel(id: string): Promise<void> {
    await this.modelSetter!(id);
  }

  protected dispose(): void {
    this.connection.close();
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill();
  }
}
