import type { Lifetime } from "../../ui/lifetime";
import { notify } from "../../ui/notify";
import { declareVaultPicker } from "../../platform/vault-picker";
import type { MobileBridge, MobileTreeGrant } from "./bridge";
import {
  decideStorage,
  inspectSharedStorage,
  inspectStorageHealth,
  loadStorageChoice,
  mobileGrantStore,
  saveStorageChoice,
  registerPersistedGrant,
  type GrantStore,
  type SharedStoragePorts,
  type StorageDecision,
} from "./storage";
import { t } from "../../i18n/strings";
import { errorText } from "../../host/errors";

export interface MobileStorageMountPorts extends SharedStoragePorts {
  store: GrantStore;
  mount: (decision: StorageDecision) => Promise<void>;
  /** Close the actual shared Host mount when a native OS permission is revoked. */
  unmountShared: () => Promise<void>;
  estimatePrivate?: () => Promise<{ quota?: number; usage?: number }>;
  requestTreeGrant?: () => Promise<MobileTreeGrant | null>;
}

/**
 * The mount ports mobile can honour today. The private space mounts: the
 * backend resolves and verifies its path (`open_vault` accepts only that
 * one). A shared folder needs a native grant verifier that does not exist
 * yet: its permission stays unknown, the proposal NeedGrant, and mounting it
 * is a stated error, never a silent fallback to the private space.
 */
export function privateStoragePorts(
  bridge: MobileBridge,
  open: (dir: string) => Promise<void>,
): MobileStorageMountPorts {
  return {
    store: mobileGrantStore(bridge),
    mount: async (decision) => {
      if (decision.choice !== "private" || decision.dir === null) {
        throw new Error(t("mobile.storage.shared_unavailable"));
      }
      await open(decision.dir);
    },
    // No shared mount is ever active, so there is nothing to close.
    unmountShared: () => Promise.resolve(),
    verifyGrant: () => Promise.resolve("unknown"),
    backendCas: () => Promise.resolve(false),
  };
}

/** Mount callbacks are injected by the app; no path or grant becomes a vault implicitly. */
export function mountMobileStorageStatus(
  lifetime: Lifetime,
  bridge: MobileBridge,
  ports?: MobileStorageMountPorts,
): void {
  const region = document.createElement("details");
  region.className = "mobile-storage";
  const heading = document.createElement("summary");
  heading.textContent = t("mobile.storage.heading");
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const privateButton = document.createElement("button");
  privateButton.type = "button";
  privateButton.textContent = t("mobile.storage.private");
  const sharedButton = document.createElement("button");
  sharedButton.type = "button";
  sharedButton.textContent = t("mobile.storage.shared");
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = t("mobile.storage.copy");
  copyButton.hidden = true;
  region.append(heading, status, privateButton, sharedButton, copyButton);
  document.body.append(region);
  lifetime.add(() => region.remove());
  // "Open vault…" leads here: choosing between the private space and a shared
  // folder is explicit, and this panel makes that choice. The picker shows it
  // and never chooses on the person's behalf.
  lifetime.add(declareVaultPicker(() => {
    region.open = true;
    region.scrollIntoView({ block: "nearest" });
    (privateButton.disabled ? heading : privateButton).focus();
    return Promise.resolve(null);
  }));
  if (!ports) {
    privateButton.disabled = sharedButton.disabled = true;
    region.open = true;
    status.textContent = t("mobile.storage.not_connected");
    return;
  }

  let activeShared = false;
  let busy = false;
  async function inspect(choice: "private" | "shared", copyAccepted = false): Promise<StorageDecision> {
    if (choice === "shared") return inspectSharedStorage(bridge, ports!.store, ports!, copyAccepted);
    return decideStorage(await bridge.storageRoots(), "private");
  }
  async function render(decision: StorageDecision): Promise<void> {
    if (lifetime.closed) return;
    const health = await inspectStorageHealth(decision, navigator.onLine, ports!.estimatePrivate);
    const free = health.availableBytes === null ? "quota sconosciuta" : `${Math.floor(health.availableBytes / 1024 / 1024)} MiB disponibili`;
    status.textContent = `${decision.choice}: ${decision.mount} · ${decision.warning} · ${free} · ${health.online ? "online" : "offline"} · offline ${health.offlineAccess}`;
    copyButton.hidden = decision.mount !== "read_only" || decision.choice !== "shared";
  }
  async function open(choice: "private" | "shared", copyAccepted = false): Promise<void> {
    if (busy || lifetime.closed) return;
    busy = true;
    try {
      let decision = await inspect(choice, copyAccepted);
      if (decision.needsGrant && choice === "shared" && ports!.requestTreeGrant) {
        const grant = await ports!.requestTreeGrant();
        if (grant) {
          await registerPersistedGrant(bridge, ports!.store, grant);
          decision = await inspect(choice, copyAccepted);
        }
      }
      await render(decision);
      if (decision.needsGrant) { region.open = true; return; }
      // A shared read-only mount is allowed; it cannot become a writer.
      if (activeShared && (choice !== "shared" || copyAccepted)) await ports!.unmountShared();
      await ports!.mount(decision);
      activeShared = choice === "shared" && decision.mount !== "copy_import";
      await saveStorageChoice(ports!.store, decision.mount === "copy_import" ? "private" : choice);
    } catch (error) {
      notify(errorText(error), "guasto");
    } finally {
      busy = false;
    }
  }
  lifetime.listen(privateButton, "click", () => { void open("private"); });
  lifetime.listen(sharedButton, "click", () => { void open("shared"); });
  lifetime.listen(copyButton, "click", () => { void open("shared", true); });
  const refresh = () => {
    void (async () => {
      const choice = await loadStorageChoice(ports.store);
      if (!choice) {
        status.textContent = t("mobile.storage.choose");
        region.open = true;
        return;
      }
      const decision = await inspect(choice);
      if (activeShared && decision.needsGrant) {
        await ports.unmountShared();
        activeShared = false;
      }
      if (decision.needsGrant) region.open = true;
      await render(decision);
    })().catch((error: unknown) => notify(errorText(error), "guasto"));
  };
  lifetime.listen(window, "online", refresh);
  lifetime.listen(window, "offline", refresh);
  lifetime.listen(window, "focus", refresh);
  lifetime.listen(document, "visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });
  void bridge.onResumed(refresh).then((off) => lifetime.add(off))
    .catch((error: unknown) => notify(errorText(error), "guasto"));
  refresh();
}
