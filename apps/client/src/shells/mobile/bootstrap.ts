// Bootstrap mobile: stessa shell, chrome touch, lifecycle OS.
// Non duplica desktop-shell: riusa mount, router, comandi, sessioni.
// Entry: apps/client/src/entrypoints/mobile.ts (solo Main lo collega).

import { documentSessions, flushPendingSave } from "../../state/document-session";
import { recoverDrafts } from "../../panels/document";
import { notify } from "../../ui/notify";
import { t } from "../../i18n/strings";
import { openLifetime, type Lifetime, type Teardown } from "../../ui/lifetime";
import { declareShell } from "../../platform/capabilities";
import { MOBILE_SHELL } from "./index";
import { createLifecycleFlush, defaultLifecyclePorts, type LifecycleFlush } from "./lifecycle";
import type { MobileBridge } from "./bridge";
import { mountMobileChrome } from "./touch";
import { mountMobileViewport } from "./viewport";
import { mountMobileOpenedActions, type MobileExternalPorts } from "./opened";
import { mountMobileStorageStatus, type MobileStorageMountPorts } from "./storage-ui";
import { mobileGrantStore } from "./storage";
import { errorText } from "../../host/errors";

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
  declareShell(MOBILE_SHELL);
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
      notify(errorText(error), "guasto");
    });
  };
  listen(ports.bridge.onSuspended(() => { void suspend(); }));
  listen(ports.bridge.onResumed(() => {
    void suspend().then(async (outcome) => {
      const recovered = await recoverDrafts();
      const pending = Math.max(outcome.drafts, recovered) + outcome.remaining.length;
      if (pending > 0) notify(t("draft.found", { count: pending }), "info");
    }).catch((error: unknown) => notify(errorText(error), "guasto"));
  }));

  return suspend;
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
    }).catch((error: unknown) => { backend.textContent = `WASM: ${errorText(error)}`; });
  };
  void bridge.onResumed(report).then((off) => lifetime.add(off))
    .catch((error: unknown) => notify(errorText(error), "guasto"));
  report();
  return () => lifetime.close();
}
