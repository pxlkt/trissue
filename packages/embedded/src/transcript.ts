import type { AgentEvent } from "./agent.ts";

export interface TranscriptEntry {
  /** Stable for the life of the entry, so a UI can keep its rows. */
  id: string;
  kind: "thought" | "message" | "tool" | "blocked" | "steer" | "notice";
  text: string;
  /** Tool calls: pending, in_progress, completed or failed. */
  status?: string;
  /** Tool calls: read, search, edit, execute… */
  toolKind?: string;
}

/**
 * Turns the agent's event stream into readable entries: text chunks join the
 * entry before them, and tool updates change their tool's entry in place.
 */
export class Transcript {
  readonly entries: TranscriptEntry[] = [];
  private readonly tools = new Map<string, TranscriptEntry>();
  private count = 0;

  /** Applies an event. Returns the entry it created or changed. */
  apply(event: AgentEvent): TranscriptEntry {
    switch (event.type) {
      case "text": {
        const last = this.entries.at(-1);
        if (last && last.kind === event.channel) {
          last.text += event.text;
          return last;
        }
        return this.push({ kind: event.channel, text: event.text });
      }
      case "tool": {
        const existing = this.tools.get(event.id);
        if (existing) {
          if (event.title) existing.text = event.title;
          if (event.status) existing.status = event.status;
          if (event.kind) existing.toolKind = event.kind;
          return existing;
        }
        const entry = this.push({ kind: "tool", text: event.title || event.kind, status: event.status, toolKind: event.kind });
        this.tools.set(event.id, entry);
        return entry;
      }
      case "blocked": {
        const tool = this.tools.get(event.id);
        if (tool) {
          tool.kind = "blocked";
          return tool;
        }
        return this.push({ kind: "blocked", text: event.title, toolKind: event.kind });
      }
      case "steer":
        return this.push({ kind: "steer", text: event.text });
      case "notice":
        return this.push({ kind: "notice", text: event.text });
    }
  }

  private push(entry: Omit<TranscriptEntry, "id">): TranscriptEntry {
    const full = { id: `e${this.count++}`, ...entry };
    this.entries.push(full);
    return full;
  }
}
