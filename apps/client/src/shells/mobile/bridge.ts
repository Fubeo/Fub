// Cucitura mobile verso l'host: nessuna importazione del bridge nativo qui.
// Questo modulo dichiara solo la forma (DI boundary): l'iniezione concreta di
// invoke/listen vive in host/ipc.ts (FrontendIntegration), l'unico posto che
// può importare il bridge Tauri oltre a host/dialog.ts. Così il presidio
// no-tauri-outside-host resta verde e la shell non ha rami globali isMobile.

export type MobileGrantPlatform = "android" | "ios";
export type MobilePermissionState = "unknown" | "granted" | "denied" | "revoked";

export interface MobileTreeGrant {
  platform: MobileGrantPlatform;
  uri: string;
  display_name?: string | null;
  persisted: boolean;
  read_write: boolean;
  bookmark_b64?: string;
}

export type MobileMountMode = "read_write" | "read_only" | "copy_import" | "need_grant";

export interface MobileStorageInfo {
  private_dir: string | null;
  shared_grant: MobileTreeGrant | null;
  shared_permission: MobilePermissionState;
  offline_reliable_private: boolean;
  offline_reliable_shared: boolean;
  shared_mount: MobileMountMode;
}

export interface MobileStoragePreference {
  version: 1;
  revision: string;
  choice: "private" | "shared" | null;
  grant: MobileTreeGrant | null;
}

export interface MobileWasmReport {
  requested_backend: "native" | "pulley";
  active_backend: "native" | "pulley" | null;
  pulley_selected: boolean;
  epoch_armed: boolean;
}

export interface MobileOpenedUrl {
  kind: "fub" | "tree_grant" | "http_share" | "mobile_switcher" | "mobile_search";
  raw: string;
}

export interface MobileCaptureTarget {
  vault?: string;
  folder?: string;
  note?: string;
  mode: "create" | "append" | "prepend" | "daily";
}

export interface MobileCapturePayload {
  v: 1;
  title: string;
  markdown: string;
  source_url?: string;
  properties?: Record<string, string | number | boolean | string[]>;
  target: MobileCaptureTarget;
}
/// L'esito di `mobile_copy_tree`: il vault da aprire (il privato), la
/// cartella nuova e ciò che non si è potuto copiare.
export interface MobileTreeCopy {
  vault: string;
  folder: string;
  files: number;
  bytes: number;
  truncated: boolean;
  skipped: string[];
}

export interface MobileBridge {
  validateCapture: (payload: MobileCapturePayload) => Promise<void>;
  submitCapture: (
    payload: MobileCapturePayload,
    vault?: string,
    template?: string,
  ) => Promise<string>;
  storageRoots: () => Promise<MobileStorageInfo>;
  storagePreference: () => Promise<MobileStoragePreference>;
  setStoragePreference: (preference: MobileStoragePreference) => Promise<MobileStoragePreference>;
  wasmReport: () => Promise<MobileWasmReport>;
  classifyOpenedUrl: (raw: string) => Promise<MobileOpenedUrl>;
  registerTreeGrant: (grant: MobileTreeGrant) => Promise<MobileTreeGrant>;
  sharedMountMode: (
    grant: MobileTreeGrant | null,
    backendCas: boolean,
    copyAccepted: boolean,
  ) => Promise<MobileMountMode>;
  /** Il selettore di cartella del sistema; `null` se la persona lo chiude. */
  pickTree: () => Promise<MobileTreeGrant | null>;
  /** Il permesso del sistema adesso, non quello ricordato. */
  verifyTree: (grant: MobileTreeGrant) => Promise<MobilePermissionState>;
  /** iOS: il path della cartella, che da qui `open_vault` accetta. */
  openSharedTree: (grant: MobileTreeGrant) => Promise<string>;
  closeSharedTree: () => Promise<unknown[]>;
  /** Android: la copia in una sottocartella nuova del vault privato. */
  copyTree: (grant: MobileTreeGrant) => Promise<MobileTreeCopy>;
  onSuspended: (handler: () => void) => Promise<() => void>;
  onResumed: (handler: () => void) => Promise<() => void>;
  onOpenedUrl: (handler: (url: MobileOpenedUrl) => void) => Promise<() => void>;
}

/// Primitive di trasporto iniettate da host/ipc.ts (FrontendIntegration).
export interface MobileInvoker {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
}

export interface MobileEventBus {
  listen: <T>(event: string, handler: (payload: T) => void) => Promise<() => void>;
}

export function createMobileBridge(
  invoker: MobileInvoker,
  bus: MobileEventBus,
): MobileBridge {
  return {
    validateCapture: (payload) =>
      invoker.invoke<void>("mobile_validate_capture", { payload }),
    submitCapture: (payload, vault, template) =>
      invoker.invoke<string>("mobile_submit_capture", {
        payload,
        vault: vault ?? null,
        template: template ?? null,
      }),
    storageRoots: () => invoker.invoke<MobileStorageInfo>("mobile_storage_roots"),
    storagePreference: () => invoker.invoke<MobileStoragePreference>("mobile_storage_preference"),
    setStoragePreference: (preference) =>
      invoker.invoke<MobileStoragePreference>("mobile_set_storage_preference", { preference }),
    wasmReport: () => invoker.invoke<MobileWasmReport>("mobile_wasm_report"),
    classifyOpenedUrl: (raw) =>
      invoker.invoke<MobileOpenedUrl>("mobile_classify_opened_url", { raw }),
    registerTreeGrant: (grant) =>
      invoker.invoke<MobileTreeGrant>("mobile_register_tree_grant", { grant }),
    sharedMountMode: (grant, backendCas, copyAccepted) =>
      invoker.invoke<MobileMountMode>("mobile_shared_mount_mode", {
        grant,
        backendCas,
        copyAccepted,
      }),
    pickTree: () => invoker.invoke<MobileTreeGrant | null>("mobile_pick_tree"),
    verifyTree: (grant) => invoker.invoke<MobilePermissionState>("mobile_verify_tree", { grant }),
    openSharedTree: (grant) => invoker.invoke<string>("mobile_open_shared", { grant }),
    closeSharedTree: () => invoker.invoke<unknown[]>("mobile_close_shared"),
    copyTree: (grant) => invoker.invoke<MobileTreeCopy>("mobile_copy_tree", { grant }),
    onSuspended: (handler) => bus.listen("tauri://suspended", () => handler()),
    onResumed: (handler) => bus.listen("tauri://resumed", () => handler()),
    onOpenedUrl: (handler) =>
      bus.listen<MobileOpenedUrl>("fub://opened-url", (event) => handler(event)),
  };
}
