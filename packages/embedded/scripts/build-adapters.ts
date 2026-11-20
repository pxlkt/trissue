/**
 * Copies the Codex ACP adapter into dist/adapters. The adapter's published
 * file is already a single self-contained bundle (Apache-2.0); trissue ships it
 * unmodified with its license and notices, and runs it with the user's own
 * `codex`, so the copy of Codex the adapter would install is never needed.
 */
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const out = join(import.meta.dir, "..", "dist", "adapters");
await mkdir(out, { recursive: true });

const pkgJson = Bun.resolveSync("@agentclientprotocol/codex-acp/package.json", import.meta.dir);
const pkgDir = dirname(pkgJson);
const pkg = await Bun.file(pkgJson).json();
const entry = typeof pkg.bin === "string" ? pkg.bin : Object.values(pkg.bin as Record<string, string>)[0]!;

await Bun.write(join(out, "codex.mjs"), Bun.file(join(pkgDir, entry)));
await Bun.write(join(out, "codex.LICENSE"), Bun.file(join(pkgDir, "LICENSE")));

// The bundle inlines its dependencies; list them with their license texts.
const sections: string[] = [];
for (const name of Object.keys(pkg.dependencies ?? {})) {
  if (name === "@openai/codex") continue; // Only located at runtime when CODEX_PATH is unset; trissue always sets it.
  const depJson = Bun.resolveSync(`${name}/package.json`, pkgDir);
  const dep = await Bun.file(depJson).json();
  const license = (await readdir(dirname(depJson))).find((file) => /^licen[sc]e(\.(md|txt))?$/i.test(file));
  if (!license) throw new Error(`${name} has no license file to include.`);
  sections.push(`## ${name}@${dep.version} (${dep.license})\n\n${(await Bun.file(join(dirname(depJson), license)).text()).trim()}`);
}

await Bun.write(
  join(out, "THIRD_PARTY_NOTICES.md"),
  `# Third-party notices\n\ncodex.mjs is ${pkg.name}@${pkg.version}, unmodified, under the ${pkg.license} license in codex.LICENSE.\nIt includes the packages below.\n\n${sections.join("\n\n")}\n`,
);
console.log(`Copied ${pkg.name}@${pkg.version}`);
