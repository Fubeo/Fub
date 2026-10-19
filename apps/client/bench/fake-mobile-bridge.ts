// Il ponte mobile del banco: ciò che `nativeMobileBridge` di `src/host/ipc.ts`
// diventa quando a girare è il banco.
//
// È una scenografia come il resto di `fake-ipc.ts`: lo spazio privato è già
// scelto e montabile, non c'è nessuna cartella condivisa, e il sistema non
// sospende, non riprende e non apre indirizzi. Da una foto fatta qui si
// conclude qualcosa sulla resa della shell mobile, mai sul comportamento del
// ponte nativo.
import type {
  MobileBridge,
  MobileStoragePreference,
} from "../src/shells/mobile/bridge";

/// Un ascolto che non scatta mai, con il suo smontaggio.
const silent = (): Promise<() => void> => Promise.resolve(() => {});

export function nativeMobileBridge(): MobileBridge {
  let preference: MobileStoragePreference = {
    version: 1,
    revision: "1",
    choice: "private",
    grant: null,
  };
  return {
    validateCapture: () => Promise.resolve(),
    submitCapture: () => Promise.resolve("Entrata.md"),
    storageRoots: () =>
      Promise.resolve({
        private_dir: "/vault/banco",
        shared_grant: null,
        shared_permission: "unknown",
        offline_reliable_private: true,
        offline_reliable_shared: false,
        shared_mount: "need_grant",
      }),
    storagePreference: () => Promise.resolve(preference),
    setStoragePreference: (next) => {
      preference = { ...next, revision: String(Number(preference.revision) + 1) };
      return Promise.resolve(preference);
    },
    wasmReport: () =>
      Promise.resolve({
        requested_backend: "pulley",
        active_backend: "pulley",
        pulley_selected: true,
        epoch_armed: true,
      }),
    classifyOpenedUrl: (raw) => Promise.resolve({ kind: "fub", raw }),
    registerTreeGrant: (grant) => Promise.resolve(grant),
    sharedMountMode: () => Promise.resolve("need_grant"),
    // Nessuna cartella condivisa: il selettore si chiude senza scelta.
    pickTree: () => Promise.resolve(null),
    verifyTree: () => Promise.resolve("unknown"),
    openSharedTree: () => Promise.reject(new Error("banco: nessuna cartella condivisa")),
    closeSharedTree: () => Promise.resolve([]),
    copyTree: () => Promise.reject(new Error("banco: nessuna cartella condivisa")),
    onSuspended: silent,
    onResumed: silent,
    onOpenedUrl: silent,
  };
}
