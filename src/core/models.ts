import type { ModelFilter } from "./config.ts";

export interface ModelOption {
  /** The value the agent uses for this model. */
  id: string;
  name: string;
  description?: string;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * Whether the repository allows a model. Patterns match `harness/model` (for
 * example `claude/*` or `*\/gpt-5*`); a pattern without a slash matches the
 * model id alone.
 */
export function isModelAllowed(filter: ModelFilter | undefined, harnessId: string, modelId: string): boolean {
  if (!filter) return true;
  const matches = (pattern: string) => globToRegExp(pattern).test(pattern.includes("/") ? `${harnessId}/${modelId}` : modelId);
  if (filter.allow && !filter.allow.some(matches)) return false;
  if (filter.block?.some(matches)) return false;
  return true;
}

/** Whether a filter limits models at all. */
export function hasModelFilter(filter: ModelFilter | undefined): boolean {
  return Boolean(filter?.allow?.length || filter?.block?.length);
}

export function filterModels(filter: ModelFilter | undefined, harnessId: string, models: ModelOption[]): ModelOption[] {
  return models.filter((model) => isModelAllowed(filter, harnessId, model.id));
}
