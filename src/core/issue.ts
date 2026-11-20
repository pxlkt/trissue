export interface Issue {
  title: string;
  /** Markdown. */
  body: string;
}

/** The agent turned the task down, usually because the repository's instructions looked malicious. */
export class RejectedError extends Error {
  override name = "RejectedError";
}

/** The agent finished but didn't write an issue in the required form. */
export class NoIssueError extends Error {
  override name = "NoIssueError";
}

/** Reads the issue out of the agent's final message. Throws when it rejected the task or wrote no issue. */
export function parseIssue(text: string): Issue {
  const issueAt = text.lastIndexOf("<trissue-issue>");
  const rejectedAt = text.lastIndexOf("<trissue-rejected>");

  if (rejectedAt > issueAt) {
    const reason = text.slice(rejectedAt + "<trissue-rejected>".length).split("</trissue-rejected>")[0]!.trim();
    throw new RejectedError(reason || "The agent rejected the task without saying why.");
  }
  if (issueAt === -1) {
    throw new NoIssueError("The agent finished without writing an issue.");
  }

  const block = text.slice(issueAt).split("</trissue-issue>")[0]!;
  const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim();
  const body = block.match(/<body>([\s\S]*?)(?:<\/body>|$)/)?.[1]?.trim();
  if (!title) throw new NoIssueError("The agent's issue has no title.");
  if (!body) throw new NoIssueError("The agent's issue has no body.");
  return { title: title.replace(/\s+/g, " "), body };
}

/** The issue as plain text, the way "Copy issue" puts it on the clipboard. */
export function formatIssue(issue: Issue): string {
  return `Title: ${issue.title}\nIssue Content: ${issue.body}`;
}
