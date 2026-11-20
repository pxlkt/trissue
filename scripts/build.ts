/**
 * Builds the package into dist/:
 *   dist/cli.js        the trissue command (runs on Bun)
 *   dist/index.js      the library, for Node, Bun and Electron
 *   dist/types/        type declarations for the library
 *   dist/adapters/     the bundled Claude and Codex ACP adapters
 */
import { $ } from "bun";
import solidPlugin from "@opentui/solid/bun-plugin";

await $`rm -rf dist`;
await $`bun scripts/build-adapters.ts`;

const external = ["@opentui/core", "@opentui/solid", "solid-js", "@agentclientprotocol/sdk", "string-width"];

const cli = await Bun.build({ entrypoints: ["src/cli.tsx"], target: "bun", outdir: "dist", naming: "cli.js", plugins: [solidPlugin], external });
if (!cli.success) throw new AggregateError(cli.logs, "Couldn't build the command.");

const lib = await Bun.build({ entrypoints: ["src/index.ts"], target: "node", outdir: "dist", naming: "index.js", external });
if (!lib.success) throw new AggregateError(lib.logs, "Couldn't build the library.");

await $`npx tsc -p tsconfig.build.json`;
console.log("Built dist/.");
