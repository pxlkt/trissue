import { useSyncExternalStore } from "react";

/**
 * A small observable store for the controller's state. Values are read with
 * getters and changed with setters, like signals. Every change in the same
 * tick is announced once, so a group of changes renders as one.
 */
export class Store {
  #listeners = new Set<() => void>();
  #version = 0;
  #queued = false;

  /** A value with a getter and a setter. `equals: false` announces every set, even of the same value. */
  value<T>(initial: T, options: { equals?: false } = {}): [get: () => T, set: (next: T | ((previous: T) => T)) => void] {
    let current = initial;
    const get = () => current;
    const set = (next: T | ((previous: T) => T)) => {
      const value = typeof next === "function" ? (next as (previous: T) => T)(current) : next;
      if (options.equals !== false && Object.is(value, current)) return;
      current = value;
      this.#changed();
    };
    return [get, set];
  }

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  };

  version = () => this.#version;

  #changed() {
    this.#version++;
    if (this.#queued) return;
    this.#queued = true;
    queueMicrotask(() => {
      this.#queued = false;
      for (const listener of this.#listeners) listener();
    });
  }
}

/** Renders the component again whenever the store changes. */
export function useStore(store: Store): number {
  return useSyncExternalStore(store.subscribe, store.version);
}
