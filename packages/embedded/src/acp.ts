/**
 * The small part of the Agent Client Protocol (v1) that trissue speaks:
 * JSON-RPC 2.0, one JSON object per line, over the agent's stdin and stdout.
 * Types cover only the fields trissue reads.
 */
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export const PROTOCOL_VERSION = 1;

export interface SessionConfigSelectOption {
  value: string;
  name: string;
  description?: string | null;
}
export interface SessionConfigSelectGroup {
  group: string;
  name: string;
  options: SessionConfigSelectOption[];
}
export type SessionConfigSelectOptions = SessionConfigSelectOption[] | SessionConfigSelectGroup[];

export type SessionConfigOption =
  | { type: "select"; id: string; name: string; category?: string | null; currentValue: string; options: SessionConfigSelectOptions }
  | { type: "boolean"; id: string; name: string; category?: string | null };

export interface InitializeResponse {
  protocolVersion: number;
  authMethods?: { id: string; name: string }[];
}

export interface NewSessionResponse {
  sessionId: string;
  configOptions?: SessionConfigOption[] | null;
  modes?: { currentModeId: string; availableModes: { id: string; name: string }[] } | null;
}

export interface PromptResponse {
  stopReason: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";
}

type ContentBlock = { type: "text"; text: string } | { type: string };

export type SessionUpdate =
  | { sessionUpdate: "agent_message_chunk" | "agent_thought_chunk"; content: ContentBlock }
  | { sessionUpdate: "tool_call"; toolCallId: string; title: string; kind?: string; status?: string }
  | { sessionUpdate: "tool_call_update"; toolCallId: string; title?: string | null; kind?: string | null; status?: string | null }
  | { sessionUpdate: string };

export interface RequestPermissionParams {
  sessionId: string;
  toolCall: { toolCallId: string; title?: string | null; kind?: string | null };
  options: { optionId: string; name: string; kind: "allow_once" | "allow_always" | "reject_once" | "reject_always" }[];
}

export type RequestPermissionResponse = { outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" } };

/** A JSON-RPC error the agent answered with. */
export class RequestError extends Error {
  override name = "RequestError";
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

interface Handlers {
  onNotification(method: string, params: any): void;
  /** Returns the result, or undefined when trissue doesn't handle the method. */
  onRequest(method: string, params: any): unknown;
}

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void };

/** A JSON-RPC connection to an agent process. */
export class Connection {
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();
  private closedWith: Error | null = null;

  constructor(
    private readonly output: Writable,
    input: Readable,
    private readonly handlers: Handlers,
  ) {
    const lines = createInterface({ input, crlfDelay: Infinity });
    lines.on("line", (line) => this.receive(line));
    lines.on("close", () => this.close(new Error("The agent closed its output.")));
    output.on("error", (error) => this.close(error));
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.closedWith) return Promise.reject(this.closedWith);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    if (!this.closedWith) this.send({ jsonrpc: "2.0", method, params });
  }

  /** Fails every request still waiting. Safe to call more than once. */
  close(error: Error = new Error("The connection to the agent is closed.")): void {
    if (this.closedWith) return;
    this.closedWith = error;
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  private send(message: object): void {
    if (this.output.writable) this.output.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string): void {
    if (!line.trim()) return;
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      // quiet: some agents print logs to stdout; anything that isn't JSON-RPC is ignored.
      return;
    }
    if (typeof message !== "object" || message === null || message.jsonrpc !== "2.0") return;

    if (typeof message.method === "string") {
      if (message.id === undefined || message.id === null) {
        try {
          this.handlers.onNotification(message.method, message.params);
        } catch {
          // quiet: a malformed notification shouldn't end the session.
        }
        return;
      }
      void this.answer(message.id, message.method, message.params);
      return;
    }

    const waiting = this.pending.get(message.id);
    if (!waiting) return;
    this.pending.delete(message.id);
    if (message.error) {
      const { code, message: text, data } = message.error;
      waiting.reject(new RequestError(typeof code === "number" ? code : -32603, typeof text === "string" ? text : "Unknown error", data));
    } else {
      waiting.resolve(message.result);
    }
  }

  private async answer(id: unknown, method: string, params: unknown): Promise<void> {
    if (this.closedWith) return;
    try {
      const result = await this.handlers.onRequest(method, params);
      if (result === undefined) this.send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
      else this.send({ jsonrpc: "2.0", id, result });
    } catch (error) {
      this.send({ jsonrpc: "2.0", id, error: { code: -32603, message: (error as Error).message } });
    }
  }
}
