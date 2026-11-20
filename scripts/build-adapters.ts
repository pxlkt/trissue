/**
 * Bundles the Claude and Codex ACP adapters into dist/adapters. trissue runs
 * them with the user's own claude and codex, so the CLIs those packages would
 * install (hundreds of megabytes) are never needed.
 */
for (const [name, entry] of [
  ["claude", "@agentclientprotocol/claude-agent-acp/package.json"],
  ["codex", "@agentclientprotocol/codex-acp/package.json"],
] as const) {
  const pkgDir = Bun.resolveSync(entry, import.meta.dir).replace(/package\.json$/, "");
  const pkg = await Bun.file(`${pkgDir}package.json`).json();
  const main = typeof pkg.bin === "string" ? pkg.bin : Object.values(pkg.bin as Record<string, string>)[0]!;
  const result = await Bun.build({
    entrypoints: [`${pkgDir}${main}`],
    target: "node",
    outdir: "dist/adapters",
    naming: `${name}.mjs`,
  });
  if (!result.success) throw new AggregateError(result.logs, `Couldn't bundle the ${name} adapter.`);
  console.log(`Bundled ${pkg.name}@${pkg.version}`);
}
