import type { ChildProcess } from "node:child_process";
import { relative } from "node:path";
import { createInterface } from "node:readline";
import type { LaunchSpec } from "./harnesses.ts";
import type { ModelOption } from "./models.ts";
import { AgentError, AgentSession, spawnAgent, type StartOptions, type TurnEnd } from "./session.ts";

/** The only tools Claude Code gets. Everything else, Bash and MCP included, doesn't exist in the session. */
const TOOLS = "Read,Grep,Glob";

/**
 * Arguments for `claude -p` that make it a read-only agent trissue drives over
 * stdin and stdout. `--setting-sources user` ignores the repository's own
 * `.claude` settings, so a downloaded repo can't add hooks that run commands.
 */
export function claudeLaunch(executable: string): LaunchSpec {
  return {
    command: executable,
    args: [
      "-p",
      "--input-format=stream-json",
      "--output-format=stream-json",
      "--verbose",
      "--include-partial-messages",
      `--tools=${TOOLS}`,
      `--allowedTools=${TOOLS}`,
      "--strict-mcp-config",
      "--setting-sources=user",
      "--no-session-persistence",
    ],
    env: {},
  };
}

interface ClaudeModel {
  value: string;
  displayName: string;
  description?: string;
}

type Message = { type: string; subtype?: string; [key: string]: any };

function toolTitle(name: string, input: Record<string, unknown>, cwd: string): string {
  const path = (value: unknown) => (typeof value === "string" ? relative(cwd, value) || "." : "");
  switch (name) {
    case "Read":
      return `Read ${path(input.file_path)}`;
    case "Grep":
      return `Search for "${input.pattern}"${input.path ? ` in ${path(input.path)}` : ""}`;
    case "Glob":
      return `Find ${input.pattern}${input.path ? ` in ${path(input.path)}` : ""}`;
    default:
      return name;
  }
}

function toolKind(name: string): string {
  return name === "Read" ? "read" : name === "Grep" || name === "Glob" ? "search" : "other";
}

/**
 * Claude Code, driven directly through `claude -p` and its stream-json
 * protocol. trissue ships no Claude code of its own: it runs the `claude` the
 * user installed.
 */
export class ClaudeSession extends AgentSession {
  readonly canSetModel = true;

  private requestCount = 0;
  private readonly pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private turnEnded: ((result: Message) => void) | null = null;
  private cancelling = false;
  private readonly toolNames = new Map<string, string>();

  private constructor(
    options: StartOptions,
    private readonly child: ChildProcess,
    private readonly exited: Promise<never>,
    private readonly cwd: string,
  ) {
    super(options.harness, [], undefined, options.onEvent);
    createInterface({ input: child.stdout! }).on("line", (line) => this.receive(line));
    exited.catch((error: Error) => {
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
    });
  }

  static async start(options: StartOptions): Promise<ClaudeSession> {
    const { harness } = options;
    const { child, exited } = spawnAgent(harness.name, options.launch ?? harness.launch, options.cwd);
    const session = new ClaudeSession(options, child, exited, options.cwd);
    try {
      const init = await session.control({ subtype: "initialize" });
      const models = ((init?.models ?? []) as ClaudeModel[]).map((model) => ({ id: model.value, name: model.displayName, description: model.description }));
      session.models.push(...models);
      session.modelId = models.find((model) => model.id === "default")?.id ?? models[0]?.id;
      return session;
    } catch (error) {
      child.kill();
      if (error instanceof AgentError) throw error;
      throw new AgentError(`${harness.name} failed to start: ${(error as Error).message}`);
    }
  }

  private send(message: object): void {
    this.child.stdin!.write(`${JSON.stringify(message)}\n`);
  }

  private control(request: { subtype: string; [key: string]: unknown }): Promise<any> {
    const id = `trissue-${++this.requestCount}`;
    const answer = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.send({ type: "control_request", request_id: id, request });
    return Promise.race([answer, this.exited]);
  }

  private receive(line: string): void {
    if (!line.trim()) return;
    let message: Message;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit({ type: "notice", text: line });
      return;
    }

    switch (message.type) {
      case "control_response": {
        const { request_id: id, subtype, response, error } = message.response ?? {};
        const waiter = this.pending.get(id);
        if (!waiter) return;
        this.pending.delete(id);
        if (subtype === "success") waiter.resolve(response);
        else waiter.reject(new AgentError(`${this.harness.name}: ${error ?? "request failed"}`));
        return;
      }
      case "control_request":
        // trissue gives Claude Code no tools that need permission, so it has nothing to answer.
        this.send({ type: "control_response", response: { subtype: "error", request_id: message.request_id, error: "trissue doesn't handle this request." } });
        return;
      case "stream_event": {
        const delta = message.event?.delta;
        if (message.event?.type !== "content_block_delta" || !delta) return;
        if (delta.type === "text_delta" && delta.text) this.emit({ type: "text", channel: "message", text: delta.text });
        else if (delta.type === "thinking_delta" && delta.thinking) this.emit({ type: "text", channel: "thought", text: delta.thinking });
        return;
      }
      case "assistant":
        for (const block of message.message?.content ?? []) {
          if (block.type !== "tool_use") continue;
          this.toolNames.set(block.id, block.name);
          this.emit({ type: "tool", id: block.id, title: toolTitle(block.name, block.input ?? {}, this.cwd), kind: toolKind(block.name), status: "in_progress" });
        }
        return;
      case "user":
        for (const block of Array.isArray(message.message?.content) ? message.message.content : []) {
          if (block.type !== "tool_result") continue;
          const name = this.toolNames.get(block.tool_use_id) ?? "tool";
          const text = typeof block.content === "string" ? block.content : "";
          if (block.is_error && text.includes("No such tool available")) {
            this.emit({ type: "blocked", id: block.tool_use_id, title: name, kind: "other" });
          } else {
            this.emit({ type: "tool", id: block.tool_use_id, title: "", kind: "", status: block.is_error ? "failed" : "completed" });
          }
        }
        return;
      case "result":
        this.turnEnded?.(message);
        return;
    }
  }

  protected async promptTurn(text: string): Promise<TurnEnd> {
    const result = new Promise<Message>((resolve) => (this.turnEnded = resolve));
    this.cancelling = false;
    this.send({ type: "user", message: { role: "user", content: [{ type: "text", text }] }, parent_tool_use_id: null });
    let message: Message;
    try {
      message = await Promise.race([result, this.exited]);
    } finally {
      this.turnEnded = null;
    }
    if (message.subtype === "success" && !message.is_error) return "end";
    if (this.cancelling) return "cancelled";
    if (message.subtype === "success") throw new AgentError(`${this.harness.name}: ${message.result ?? "the request failed."}`);
    if (message.subtype === "error_max_turns") throw new AgentError(`${this.harness.name} hit its turn limit before finishing.`);
    throw new AgentError(`${this.harness.name} stopped with an error (${message.subtype}).`);
  }

  protected cancelTurn(): void {
    this.cancelling = true;
    this.control({ subtype: "interrupt" }).catch((error: Error) => this.emit({ type: "notice", text: `Couldn't interrupt: ${error.message}` }));
  }

  protected async applyModel(id: string): Promise<void> {
    await this.control({ subtype: "set_model", model: id });
  }

  protected dispose(): void {
    this.child.stdin!.end();
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill();
  }
}
