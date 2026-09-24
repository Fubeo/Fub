// Bootstrap mobile: stessa shell, chrome touch, lifecycle OS.
// Non duplica desktop-shell: riusa mount, router, comandi, sessioni.
// Entry: apps/client/src/entrypoints/mobile.ts (solo Main lo collega).

import { documentSessions, flushPendingSave } from "../../state/document-session";
import { recoverDrafts } from "../../panels/document";
import { openCommandPalette } from "../../ui/palette";
import { applyIntent } from "../../ui/intents";
import { notify } from "../../ui/notify";
import { t } from "../../i18n/strings";
import { openQuickSwitcher } from "../../panels/quick-switcher";
import { createNote } from "../../state/vault";
import { vaultEntries } from "../../host/query";
import { openLifetime, type Lifetime, type Teardown } from "../../ui/lifetime";
import { MOBILE_SHELL } from "./index";
import { createLifecycleFlush, defaultLifecyclePorts, type LifecycleFlush } from "./lifecycle";
import type { MobileBridge } from "./bridge";
import { mountMobileChrome, openMobileSearch } from "./touch";
import { mountMobileViewport } from "./viewport";
import { mountMobileOpenedActions, type MobileExternalPorts } from "./opened";
import { mountMobileStorageStatus, type MobileStorageMountPorts } from "./storage-ui";
import { mobileGrantStore } from "./storage";

export interface MobileShellOptions extends MobileExternalPorts {
  storage?: MobileStorageMountPorts;
}
export interface MobileBootstrapPorts {
  bridge: MobileBridge;
  flush: () => Promise<string[]>;
  dirtyIds: () => string[];
}

export function defaultMobilePorts(bridge: MobileBridge): MobileBootstrapPorts {
  return {
    bridge,
    flush: () => flushPendingSave(),
    // If the flush itself rejects, report owners that still retain unsaved text.
    dirtyIds: () => documentSessions.dirtyIds(),
  };
}

export function mountMobileLifecycle(
  lifetime: Lifetime,
  ports: MobileBootstrapPorts,
): LifecycleFlush {
  document.documentElement.dataset.clientShell = MOBILE_SHELL.id;
  const suspend = createLifecycleFlush(
    defaultLifecyclePorts({ flush: ports.flush, dirtyIds: ports.dirtyIds }),
  );

  const onHidden = () => {
    if (document.visibilityState === "hidden") void suspend();
  };
  const onPageHide = () => {
    void suspend();
  };
  lifetime.listen(document, "visibilitychange", onHidden);
  lifetime.listen(window, "pagehide", onPageHide);

  const listen = (registration: Promise<Teardown>) => {
    void registration.then((off) => lifetime.add(off)).catch((error: unknown) => {
      notify(String(error), "guasto");
    });
  };
  listen(ports.bridge.onSuspended(() => { void suspend(); }));
  listen(ports.bridge.onResumed(() => {
    void suspend().then(async (outcome) => {
      const recovered = await recoverDrafts();
      const pending = Math.max(outcome.drafts, recovered) + outcome.remaining.length;
      if (pending > 0) notify(t("draft.found", { count: pending }), "info");
    }).catch((error: unknown) => notify(String(error), "guasto"));
  }));

  return suspend;
}

export function mobilePaletteHost(): Parameters<typeof openCommandPalette>[0] {
  return {
    onEffect: (effect) => applyIntent(effect),
    notify,
    flushPendingSave,
    listDocuments: () =>
      vaultEntries({ offset: 0, limit: 200 }, "document")
        .then((page) => page.items.map((entry) => entry.id))
        .catch(() => []),
  };
}

export async function mobileQuickNote(): Promise<string | null> {
  return createNote();
}

export function mobileOpenPalette(): Promise<void> {
  return openCommandPalette(mobilePaletteHost());
}

export function mobileOpenSwitcher(): void {
  openQuickSwitcher();
}

export function mobileOpenSearch(): void {
  openMobileSearch();
}

export function mountMobileShell(bridge: MobileBridge, options: MobileShellOptions = {}): Teardown {
  const lifetime = openLifetime();
  mountMobileLifecycle(lifetime, defaultMobilePorts(bridge));
  mountMobileChrome(lifetime);
  mountMobileViewport(lifetime);
  const grantStore = options.grantStore ?? options.storage?.store ?? mobileGrantStore(bridge);
  mountMobileOpenedActions(lifetime, bridge, {
    ...options,
    grantStore,
    requestTreeGrant: options.requestTreeGrant ?? options.storage?.requestTreeGrant,
  });
  mountMobileStorageStatus(lifetime, bridge, options.storage);
  const backend = document.createElement("p");
  backend.className = "mobile-backend";
  backend.setAttribute("role", "status");
  document.body.append(backend);
  lifetime.add(() => backend.remove());
  const report = () => {
    void bridge.wasmReport().then((wasm) => {
      if (lifetime.closed) return;
      backend.textContent = t("mobile.wasm.backend", { requested: wasm.requested_backend, active: wasm.active_backend ?? t("mobile.wasm.not_started") });
    }).catch((error: unknown) => { backend.textContent = `WASM: ${String(error)}`; });
  };
  void bridge.onResumed(report).then((off) => lifetime.add(off))
    .catch((error: unknown) => notify(String(error), "guasto"));
  report();
  return () => lifetime.close();
}
