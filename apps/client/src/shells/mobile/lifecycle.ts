// Stato lifecycle mobile: flush/coalescing locale, niente duplicati shell.
// La verità resta nel DOM/DocumentSession di ShellOwner; qui solo porte.

import { unsavedDrafts } from "../../host/query";

export interface LifecyclePorts {
  flushPendingSave: () => Promise<string[]>;
  dirtyIds: () => string[];
  countDrafts: () => Promise<number>;
}

export interface LifecycleOutcome {
  flushed: string[];
  remaining: string[];
  drafts: number;
  at: number;
}
export type LifecycleFlush = () => Promise<LifecycleOutcome>;
export function defaultLifecyclePorts(deps: {
  flush: () => Promise<string[]>;
  dirtyIds: () => string[];
}): LifecyclePorts {
  return {
    flushPendingSave: () => deps.flush(),
    dirtyIds: () => deps.dirtyIds(),
    countDrafts: () =>
      unsavedDrafts()
        .then((drafts) => drafts.length)
        .catch(() => 0),
  };
}

// Coalescing: un flush alla volta; le chiamate durante il flush si accodano.
export function createLifecycleFlush(ports: LifecyclePorts): LifecycleFlush {
  let running: Promise<LifecycleOutcome> | null = null;
  let queued = false;

  async function once(): Promise<LifecycleOutcome> {
    const remaining = await ports.flushPendingSave().catch(() => ports.dirtyIds());
    const drafts = await ports.countDrafts().catch(() => 0);
    return { flushed: [], remaining, drafts, at: Date.now() };
  }

  return function suspend(): Promise<LifecycleOutcome> {
    if (running) {
      queued = true;
      return running;
    }
    running = (async () => {
      let outcome: LifecycleOutcome;
      do {
        queued = false;
        outcome = await once();
      } while (queued);
      return outcome;
    })().finally(() => { running = null; });
    return running;
  };
}
