/**
 * Builds trissue-embedded into dist/:
 *   dist/index.js     the library, for Node, Bun and Electron
 *   dist/types/       type declarations
 *   dist/adapters/    the Codex ACP adapter and its notices
 */
import { $ } from "bun";
import { VERSION } from "../src/version.ts";

const root = new URL("..", import.meta.url).pathname;
process.chdir(root);

const pkg = await Bun.file("package.json").json();
if (pkg.version !== VERSION) throw new Error(`src/version.ts says ${VERSION}, package.json says ${pkg.version}.`);

await $`rm -rf dist`;
await $`bun scripts/build-adapters.ts`;

const lib = await Bun.build({ entrypoints: ["src/index.ts"], target: "node", outdir: "dist", naming: "index.js", external: ["@agentclientprotocol/sdk"] });
if (!lib.success) throw new AggregateError(lib.logs, "Couldn't build the library.");

await $`bunx tsc -p tsconfig.build.json`;
console.log("Built trissue-embedded.");
