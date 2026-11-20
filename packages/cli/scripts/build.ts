/**
 * Builds the trissue command into dist/. The build runs on Bun; the command
 * it builds runs on Node 20+ and on Bun.
 */
import { $ } from "bun";
import embedded from "../../embedded/package.json" with { type: "json" };
import pkg from "../package.json" with { type: "json" };
import { VERSION } from "../src/version.ts";

const root = new URL("..", import.meta.url).pathname;
process.chdir(root);

if (pkg.version !== VERSION) throw new Error(`src/version.ts says ${VERSION}, package.json says ${pkg.version}.`);
// A plain version, not workspace:*, so npm can install what `npm pack` makes.
// Bun links the workspace as long as the versions match.
if (pkg.dependencies["trissue-embedded"] !== embedded.version) {
  throw new Error(`package.json depends on trissue-embedded ${pkg.dependencies["trissue-embedded"]}, but packages/embedded is ${embedded.version}.`);
}

await $`rm -rf dist`;
const cli = await Bun.build({
  entrypoints: ["src/bin.ts"],
  target: "node",
  format: "esm",
  outdir: "dist",
  // The interface is its own chunk, loaded only when it opens.
  splitting: true,
  naming: { entry: "cli.js", chunk: "[name]-[hash].js" },
  banner: "#!/usr/bin/env node",
  jsx: { runtime: "automatic", importSource: "react", development: false },
  // Dependencies install with the package, not inside the bundle.
  external: Object.keys(pkg.dependencies),
});
if (!cli.success) throw new AggregateError(cli.logs, "Couldn't build the command.");

const bundled = await Promise.all(cli.outputs.map((output) => output.text()));
if (bundled.some((text) => /\bBun\.[a-z]|from ["']bun(:|["'])/.test(text))) throw new Error("The build uses a Bun API, so it wouldn't run on Node.");

await $`chmod +x dist/cli.js`;
console.log("Built trissue.");
