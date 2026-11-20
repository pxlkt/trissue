/**
 * The `trissue` command. It checks the runtime before loading anything else,
 * so an old Node fails with a message instead of a syntax error.
 */
const MIN_NODE = 20;

const major = Number(process.versions.node.split(".")[0]);
if (!process.versions.bun && major < MIN_NODE) {
  process.stderr.write(`trissue: needs Node ${MIN_NODE} or newer, or Bun. This is Node ${process.versions.node}.\n`);
  process.exit(1);
}

await import("./cli.ts");
