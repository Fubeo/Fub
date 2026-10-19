// La scheda «Informazioni» delle preferenze: la versione di questo binario, la
// licenza, il codice sorgente e il controllo degli aggiornamenti.
//
// Il controllo è **solo su richiesta**: il bundle `fub.updates` dell'host
// chiede a GitHub l'ultima release quando la persona preme il pulsante, mai in
// sottofondo. Il comando accoda un job; l'esito arriva con il suo `job_done`,
// riconosciuto dal nome del job. Non scarica e non installa niente: dice se
// c'è di meglio e dove guardarlo.
import { api } from "../host/ipc";
import type { KernelNotice } from "../host/contract";
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import { onAnyEvent } from "../state/kernel";
import { openVaultRoot, vaultArg } from "../state/store";
import type { Lifetime } from "../ui/lifetime";

/// Comando e job del bundle `fub.updates` (`crates/fub-host/src/updates.rs`).
export const UPDATES_CHECK = "updates.check";
export const UPDATES_CHECK_JOB = "updates.check";

export const SOURCE_URL = "https://github.com/Fubeo/Fub";
/// Il link di una release si mostra soltanto se porta qui.
const RELEASES_PAGE = `${SOURCE_URL}/releases/`;

export type UpdateCheck =
  | { kind: "idle" }
  | { kind: "checking"; vault: string }
  | { kind: "no_vault" }
  | { kind: "done"; latest: string | null; newer: boolean; url: string | null }
  | { kind: "failed"; reason: string };

/// L'esito del job come lo consegna `job_done`: `{Ok: {...}}` o `{Err: errore}`.
/// Una forma che non si riconosce è un fallimento detto, non un «aggiornato».
export function readCheck(result: unknown): UpdateCheck {
  if (result && typeof result === "object" && "Ok" in result) {
    const ok = (result as { Ok: unknown }).Ok as Record<string, unknown> | null;
    // GitHub ha risposto, ma con qualcosa che non si usa: l'host dice cosa, e
    // la frase è di questa shell, nella lingua di chi guarda.
    if (ok && typeof ok === "object" && typeof ok.failed === "string") {
      if (ok.failed === "status") return { kind: "failed", reason: t("about.bad_status", { status: String(ok.status) }) };
      if (ok.failed === "version") return { kind: "failed", reason: t("about.bad_version") };
      return { kind: "failed", reason: t("about.unreadable") };
    }
    if (ok && typeof ok === "object" && typeof ok.newer === "boolean") {
      const latest = typeof ok.latest === "string" ? ok.latest : null;
      const url = typeof ok.url === "string" && ok.url.startsWith(RELEASES_PAGE) ? ok.url : null;
      return { kind: "done", latest, newer: ok.newer, url };
    }
  }
  if (result && typeof result === "object" && "Err" in result) {
    return { kind: "failed", reason: errorText((result as { Err: unknown }).Err) };
  }
  return { kind: "failed", reason: t("about.unreadable") };
}

/// Ciò che la riga del controllo dice, per ogni stato.
export function checkMessage(check: UpdateCheck, version: string): string {
  switch (check.kind) {
    case "idle": return t("about.privacy");
    case "checking": return t("about.checking");
    case "no_vault": return t("about.no_vault");
    case "failed": return t("about.failed", { reason: check.reason });
    case "done":
      if (check.latest === null) return t("about.no_release");
      return check.newer
        ? t("about.newer", { latest: check.latest })
        : t("about.up_to_date", { version });
  }
}

export interface UpdateChecker {
  state(): UpdateCheck;
  start(): Promise<void>;
}

/// Il controllo, con un solo ascoltatore posseduto da `lifetime`. `changed`
/// ridisegna chi lo mostra.
export function mountUpdateCheck(lifetime: Lifetime, changed: () => void): UpdateChecker {
  let check: UpdateCheck = { kind: "idle" };
  const set = (next: UpdateCheck): void => {
    check = next;
    changed();
  };
  // L'ascoltatore c'è soltanto mentre un controllo è in volo: chi non preme il
  // pulsante non paga niente, e la chiusura del pannello lo stacca comunque.
  let stop: (() => void) | null = null;
  const quiet = (): void => {
    stop?.();
    stop = null;
  };
  lifetime.add(quiet);
  const settle = (next: UpdateCheck): void => {
    quiet();
    set(next);
  };
  const listen = (): void => {
    if (stop) return;
    stop = onAnyEvent((notice: KernelNotice) => {
      const event = notice.event;
      // Il vault del controllo se n'è andato: il suo job non risponde più qui.
      if (event.type === "vault_opened" || event.type === "vault_closed") settle({ kind: "idle" });
      else if (event.type === "job_done" && event.job === UPDATES_CHECK_JOB) settle(readCheck(event.result));
    });
  };
  return {
    state: () => check,
    async start() {
      if (lifetime.closed || check.kind === "checking") return;
      const vault = openVaultRoot();
      if (!vault) {
        set({ kind: "no_vault" });
        return;
      }
      set({ kind: "checking", vault });
      listen();
      try {
        await api.invokeCommand(UPDATES_CHECK, {}, "apply", ...vaultArg(vault));
      } catch (error) {
        // `check` può essere cambiato mentre si aspettava: si rilegge.
        if (!lifetime.closed && (check as UpdateCheck).kind === "checking") settle({ kind: "failed", reason: errorText(error) });
      }
    },
  };
}
