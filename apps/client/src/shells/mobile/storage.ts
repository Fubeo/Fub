// Preferenza mobile app-level: scelta e grant si salvano prima del primo vault.
// Il registry Rust è atomico e rifiuta schemi futuri; nessun default privato
// se la scelta shared ha perso il permesso OS. Il mount resta di SystemStorage.

import type { MobileBridge, MobileMountMode, MobilePermissionState, MobileStorageInfo, MobileStoragePreference, MobileTreeGrant } from "./bridge";

export type MobileStorageChoice = "private" | "shared";


export interface StorageDecision {
  choice: MobileStorageChoice;
  grant: MobileTreeGrant | null;
  mount: MobileMountMode;
  dir: string | null;
  offlineReliable: boolean;
  needsGrant: boolean;
  copyImport: boolean;
  warning: "none" | "need-grant" | "read-only" | "copy-import" | "revoked";
}

export function decideStorage(
  info: MobileStorageInfo,
  preferred: MobileStorageChoice,
): StorageDecision {
  if (preferred === "shared") {
    if (info.shared_permission === "granted" && info.shared_grant && info.shared_mount === "read_write") {
      return {
        choice: "shared",
        grant: info.shared_grant,
        mount: "read_write",
        dir: null,
        offlineReliable: info.offline_reliable_shared,
        needsGrant: false,
        copyImport: false,
        warning: "none",
      };
    }
    if (info.shared_permission === "granted" && info.shared_grant && info.shared_mount === "read_only") {
      return {
        choice: "shared",
        grant: info.shared_grant,
        mount: "read_only",
        dir: null,
        offlineReliable: info.offline_reliable_shared,
        needsGrant: false,
        copyImport: false,
        warning: "read-only",
      };
    }
    if (info.shared_permission === "granted" && info.shared_grant && info.shared_mount === "copy_import") {
      return {
        choice: "shared",
        grant: info.shared_grant,
        mount: "copy_import",
        dir: info.private_dir,
        offlineReliable: info.offline_reliable_private,
        needsGrant: false,
        copyImport: true,
        warning: "copy-import",
      };
    }
    if (info.shared_permission === "denied" || info.shared_permission === "revoked") {
      return {
        choice: "shared",
        grant: info.shared_grant,
        mount: "need_grant",
        dir: null,
        offlineReliable: false,
        needsGrant: true,
        copyImport: false,
        warning: "revoked",
      };
    }
    return {
      choice: "shared",
      grant: info.shared_grant,
      mount: "need_grant",
      dir: null,
      offlineReliable: false,
      needsGrant: true,
      copyImport: false,
      warning: "need-grant",
    };
  }
  return {
    choice: "private",
    grant: null,
    mount: info.private_dir ? "read_write" : "need_grant",
    dir: info.private_dir,
    offlineReliable: info.offline_reliable_private,
    needsGrant: !info.private_dir,
    copyImport: false,
    warning: info.private_dir ? "none" : "need-grant",
  };
}

export interface GrantStore {
  read: () => Promise<MobileStoragePreference>;
  update: (patch: Partial<Pick<MobileStoragePreference, "choice" | "grant">>) => Promise<void>;
}

/** App-level registry, not vault view-state: the vault does not yet exist. */
export function mobileGrantStore(bridge: MobileBridge): GrantStore {
  return {
    read: bridge.storagePreference,
    update: async (patch) => {
      const previous = await bridge.storagePreference();
      if (previous.version !== 1) throw new Error("Schema storage mobile non supportato");
      await bridge.setStoragePreference({ ...previous, ...patch });
    },
  };
}

/** Nessuna scelta salvata equivale a chiedere, non a scegliere \"private\". */
export async function loadStorageChoice(store: GrantStore): Promise<MobileStorageChoice | null> {
  const { choice } = await store.read();
  if (choice !== null && choice !== "private" && choice !== "shared") {
    throw new Error("Scelta storage mobile non riconosciuta");
  }
  return choice;
}

export function saveStorageChoice(store: GrantStore, choice: MobileStorageChoice): Promise<void> {
  return store.update({ choice });
}

export interface SharedStoragePorts {
  verifyGrant: (grant: MobileTreeGrant) => Promise<MobilePermissionState>;
  backendCas: (grant: MobileTreeGrant) => Promise<boolean>;
}

/** Un grant persistito è solo una ricevuta, non una prova d'accesso odierno. */
export async function inspectSharedStorage(
  bridge: MobileBridge,
  store: GrantStore,
  ports: SharedStoragePorts,
  copyAccepted = false,
): Promise<StorageDecision> {
  const info = await bridge.storageRoots();
  const grant = await loadTreeGrant(store);
  if (!grant) return decideStorage(info, "shared");
  const permission = await ports.verifyGrant(grant).catch(() => "unknown" as const);
  if (permission !== "granted") {
    return decideStorage({ ...info, shared_grant: grant, shared_permission: permission }, "shared");
  }
  const backendCas = await ports.backendCas(grant).catch(() => false);
  const mount = await bridge.sharedMountMode(grant, backendCas, copyAccepted);
  return decideStorage({
    ...info,
    shared_grant: grant,
    shared_permission: permission,
    shared_mount: mount,
  }, "shared");
}

export interface MobileStorageHealth {
  online: boolean;
  quota: "ok" | "low" | "unknown";
  availableBytes: number | null;
  offlineAccess: "reliable" | "unverified" | "unavailable";
}

export async function inspectStorageHealth(
  decision: StorageDecision,
  online: boolean,
  estimate?: () => Promise<{ quota?: number; usage?: number }>,
): Promise<MobileStorageHealth> {
  // No WebStorage estimate: it describes the webview origin, not the vault.
  const availableBytes = decision.choice === "private" && estimate
    ? await estimate().then(({ quota, usage }) =>
        typeof quota === "number" && typeof usage === "number"
          ? Math.max(0, quota - usage)
          : null,
      ).catch(() => null)
    : null;
  return {
    online,
    availableBytes,
    quota: availableBytes === null ? "unknown" : availableBytes < 10 * 1024 * 1024 ? "low" : "ok",
    offlineAccess: decision.needsGrant ? "unavailable"
      : decision.offlineReliable ? "reliable" : "unverified",
  };
}

export async function registerPersistedGrant(
  bridge: MobileBridge,
  store: GrantStore,
  grant: MobileTreeGrant,
): Promise<void> {
  const accepted = await bridge.registerTreeGrant(grant);
  await saveTreeGrant(store, accepted);
}

export async function loadTreeGrant(store: GrantStore): Promise<MobileTreeGrant | null> {
  const { grant } = await store.read();
  return grant;
}

export function saveTreeGrant(store: GrantStore, grant: MobileTreeGrant | null): Promise<void> {
  return store.update({ grant });
}
