import { AcpSession } from "./acp-session.ts";
import { ClaudeSession } from "./claude-session.ts";
import type { AgentSession, StartOptions } from "./session.ts";

export { AgentError, AgentSession, StoppedError, type AgentEvent, type StartOptions } from "./session.ts";

/** Launches the agent and opens a read-only session in `cwd`. */
export function startAgent(options: StartOptions): Promise<AgentSession> {
  return options.harness.protocol === "claude" ? ClaudeSession.start(options) : AcpSession.start(options);
}
