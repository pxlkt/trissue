import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The file a repository puts at its root to configure trissue. */
export const CONFIG_FILE = ".trissue.json";

/** A place the user can send the issue by opening a URL. */
export interface LinkTarget {
  /** Button text, like "Discord" or "Email the team". */
  label: string;
  /**
   * The URL to open. `{title}`, `{body}` and `{issue}` are replaced with the
   * URL-encoded issue title, body, or the whole copied issue text.
   */
  url: string;
  /** One sentence that says where the link goes. Shown before it opens. */
  description?: string;
}

export interface ModelFilter {
  /** Only these models may be used. Patterns match `harness/model`, `*` is a wildcard. */
  allow?: string[];
  /** These models may never be used. Checked after `allow`. */
  block?: string[];
}

/** Everything a `.trissue.json` can set. Every field is optional. */
export interface TrissueConfig {
  product?: {
    /** Shown in the header as "<name> Triage". Defaults to the repository name. */
    name?: string;
    /** Hex color of the product name. */
    color?: string;
  };
  /** Background color of the whole interface. Defaults to black. */
  background?: string;
  /** Text above the issue input. */
  prompt?: string;
  /** How the issue should be written. Replaces the default writing guide. */
  instructions?: string;
  /** Which models are allowed. */
  models?: ModelFilter;
  /** The checkmark next to "Use default model". Green unless set to monochrome. */
  checkmark?: "green" | "monochrome";
  /** Where GitHub issues are filed, as `owner/repo`. `false` hides GitHub filing. */
  github?: string | false;
  /** Labels added to GitHub issues. Labels that don't exist on the repo are skipped by GitHub. */
  labels?: string[];
  /** Extra places to send the issue. */
  links?: LinkTarget[];
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function fail(path: string, message: string): never {
  throw new ConfigError(`${CONFIG_FILE}: ${path} ${message}`);
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") fail(path, "must be a non-empty string");
  return value;
}

function optionalColor(value: unknown, path: string): string | undefined {
  const color = optionalString(value, path);
  if (color !== undefined && !HEX.test(color)) fail(path, "must be a hex color like #ff5500");
  return color;
}

function optionalStrings(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item === "")) {
    fail(path, "must be a list of non-empty strings");
  }
  return value as string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Checks untrusted JSON and returns it as a config, or throws a ConfigError naming the bad field. */
export function parseConfig(raw: unknown): TrissueConfig {
  if (!isRecord(raw)) fail("", "must be a JSON object");
  const known = new Set(["$schema", "product", "background", "prompt", "instructions", "models", "checkmark", "github", "labels", "links"]);
  for (const key of Object.keys(raw)) if (!known.has(key)) fail(key, "is not a trissue setting");

  const config: TrissueConfig = {};

  if (raw.product !== undefined) {
    if (!isRecord(raw.product)) fail("product", "must be an object");
    config.product = {
      name: optionalString(raw.product.name, "product.name"),
      color: optionalColor(raw.product.color, "product.color"),
    };
  }
  config.background = optionalColor(raw.background, "background");
  config.prompt = optionalString(raw.prompt, "prompt");
  config.instructions = optionalString(raw.instructions, "instructions");

  if (raw.models !== undefined) {
    if (!isRecord(raw.models)) fail("models", "must be an object");
    config.models = {
      allow: optionalStrings(raw.models.allow, "models.allow"),
      block: optionalStrings(raw.models.block, "models.block"),
    };
  }

  if (raw.checkmark !== undefined) {
    if (raw.checkmark !== "green" && raw.checkmark !== "monochrome") fail("checkmark", 'must be "green" or "monochrome"');
    config.checkmark = raw.checkmark;
  }

  if (raw.github !== undefined) {
    if (raw.github === false) config.github = false;
    else {
      const repo = optionalString(raw.github, "github");
      if (repo === undefined || !/^[\w.-]+\/[\w.-]+$/.test(repo)) fail("github", "must be owner/repo or false");
      config.github = repo;
    }
  }
  config.labels = optionalStrings(raw.labels, "labels");

  if (raw.links !== undefined) {
    if (!Array.isArray(raw.links)) fail("links", "must be a list");
    config.links = raw.links.map((link, index) => {
      const path = `links[${index}]`;
      if (!isRecord(link)) fail(path, "must be an object");
      const label = optionalString(link.label, `${path}.label`);
      const url = optionalString(link.url, `${path}.url`);
      if (label === undefined) fail(`${path}.label`, "is required");
      if (url === undefined) fail(`${path}.url`, "is required");
      if (!/^(https?:|mailto:)/i.test(url)) fail(`${path}.url`, "must start with https:, http: or mailto:");
      return { label, url, description: optionalString(link.description, `${path}.description`) };
    });
  }

  return config;
}

/** Reads `.trissue.json` from a folder. Returns null when the file doesn't exist. */
export async function loadConfig(dir: string): Promise<TrissueConfig | null> {
  let text: string;
  try {
    text = await readFile(join(dir, CONFIG_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${CONFIG_FILE} is not valid JSON: ${(error as Error).message}`);
  }
  return parseConfig(json);
}
