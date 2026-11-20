/** Builds the trissue command into dist/cli.js. It runs on Bun. */
import solidPlugin from "@opentui/solid/bun-plugin";
import { $ } from "bun";
import { VERSION } from "../src/version.ts";

const root = new URL("..", import.meta.url).pathname;
process.chdir(root);

const pkg = await Bun.file("package.json").json();
if (pkg.version !== VERSION) throw new Error(`src/version.ts says ${VERSION}, package.json says ${pkg.version}.`);

await $`rm -rf dist`;
const external = ["@opentui/core", "@opentui/solid", "solid-js", "string-width", "trissue-embedded"];
const cli = await Bun.build({ entrypoints: ["src/cli.tsx"], target: "bun", outdir: "dist", naming: "cli.js", plugins: [solidPlugin], external });
if (!cli.success) throw new AggregateError(cli.logs, "Couldn't build the command.");
await $`chmod +x dist/cli.js`;
console.log("Built trissue.");
