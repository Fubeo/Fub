// Gli intenti che la shell sa eseguire: navigare, rivelare, cercare.
//
// Arrivano da due parti — un `ViewUpdate` di una view e un `CommandEffect` di
// un comando — e sono gli stessi perché sono intenti della **shell**, non di
// chi li manda. Una copia per sorgente sarebbe una copia da tenere allineata:
// il giorno che la si dimentica, un comando naviga e una view no.
import type { CommandEffect, ViewUpdate } from "../host/contract";
import { t } from "../i18n/strings";
import { isOpen, openDocument, revealByteOffset } from "../panels/document";
import { searchFor } from "../panels/search";
import { notify } from "./notify";

/// Il namespace con cui `settings.export` consegna ciò che ha esportato
/// (`fub_features::SETTINGS_NS`). Il comando non scrive un file e non può:
/// nessuna capacità dell'`HostApi` tocca il filesystem fuori dal vault
/// (decisione 0013), e dove salvare lo sa **chi ha il dialogo di sistema**.
export const SETTINGS_EXPORT_NS = "settings.export";

/// Il namespace con cui un provider del core chiede di mettere un testo negli
/// appunti (`fub_abi::ui::CLIPBOARD_TEXT_NS`, payload `{ text }`). Che venga
/// soltanto dal core lo garantisce il kernel, prima che l'intento arrivi qui.
export const CLIPBOARD_TEXT_NS = "fub.clipboard.text";

/// Il vault è stato sostituito da uno snapshot (`fub_abi::ui::VAULT_RESTORED_NS`):
/// ogni buffer, sessione e vista in memoria è del contenuto di prima, e l'unica
/// risposta che non ne salva un pezzo per sbaglio è ricaricare la finestra.
export const VAULT_RESTORED_NS = "fub.vault.restored";

/// La chiave con cui un avviso sopravvive alla ricarica che lo ha causato.
const NOTICE_AFTER_RELOAD = "fub.notice-after-reload";

let reload: () => void = () => window.location.reload();

/// Solo per i banchi: una ricarica vera smonterebbe l'ambiente di test.
export function setReloaderForTests(fn: () => void): void {
  reload = fn;
}

/// L'avviso lasciato da una ricarica voluta, una volta sola.
export function takeNoticeAfterReload(): string | null {
  try {
    const notice = sessionStorage.getItem(NOTICE_AFTER_RELOAD);
    sessionStorage.removeItem(NOTICE_AFTER_RELOAD);
    return notice;
  } catch {
    return null;
  }
}

/// I due tipi veri del confine, meno il caso che qui non c'entra: `replace`
/// riguarda la view che lo ha mandato, e lo gestisce chi la monta. Scritto come
/// unione dei tipi rispecchiati e non a mano, così un caso nuovo in Rust arriva
/// fin qui.
export type ShellIntent = Exclude<ViewUpdate, { kind: "replace" }> | CommandEffect;

export async function applyIntent(intent: ShellIntent): Promise<void> {
  switch (intent.kind) {
    case "navigate":
      await openDocument("doc" in intent ? intent.doc : intent.doc_id);
      break;
    case "reveal": {
      // Apri il documento se non è quello aperto, poi porta la vista
      // sull'intervallo (lo scroll converte byte UTF-8 → posizione editor).
      const doc = "doc" in intent ? intent.doc : intent.doc_id;
      if (!isOpen(doc)) await openDocument(doc);
      revealByteOffset(intent.span.start);
      break;
    }
    case "run_search":
      searchFor(intent.query);
      break;
    case "custom":
      if (intent.ns === SETTINGS_EXPORT_NS) {
        await collectExport(intent.payload);
        break;
      }
      if (intent.ns === CLIPBOARD_TEXT_NS) {
        await copyText(intent.payload);
        break;
      }
      if (intent.ns === VAULT_RESTORED_NS) {
        try {
          sessionStorage.setItem(NOTICE_AFTER_RELOAD, t("vault.restored"));
        } catch {
          // Senza storage la ricarica resta giusta: si perde solo l'avviso.
        }
        reload();
        break;
      }
      // Intento con namespace che questa shell non prevede: da contratto
      // non fa nulla (degrado garbato) — chi lo emette conta su una shell
      // che lo capisce, non su questa.
      console.info(`Fub: intento custom ignorato (ns: ${intent.ns}).`);
      break;
    case "plan":
      // Un piano arrivato fuori dal giro dell'anteprima: non si applica da
      // sé, e la palette lo ha già mostrato quando l'ha chiesto.
      break;
    case "none":
    case "done":
      break;
  }
}

/// Un testo negli appunti, e lo si dice: una copia silenziosa è una copia
/// che l'utente non sa di avere, e una fallita è una che crede di avere.
async function copyText(payload: unknown): Promise<void> {
  const text = (payload as { text?: unknown } | null)?.text;
  if (typeof text !== "string") {
    console.info("Fub: intento appunti senza testo, ignorato.");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    notify(t("clipboard.copied"));
  } catch {
    notify(t("clipboard.failed"), "guasto");
  }
}

/// L'export delle impostazioni: negli appunti, e lo si dice.
///
/// Gli appunti e non un file, perché è ciò che questa shell sa fare senza
/// chiedere niente a nessuno; il giorno che ci sarà un dialogo di salvataggio,
/// il payload che arriva qui è già quello giusto. Quel che conta è che
/// **qualcuno lo raccolga**: un comando che consegna un intento a una shell che
/// lo ignora è un export che finisce nel vuoto, con l'utente convinto di aver
/// esportato.
async function collectExport(payload: unknown): Promise<void> {
  const json = JSON.stringify(payload, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    notify(t("settings.exported_clipboard"));
  } catch {
    // Senza permesso sugli appunti resta la console, che per un JSON di venti
    // righe è più di niente — e il messaggio dice dov'è finito.
    console.info(json);
    notify(t("settings.exported_console"), "guasto");
  }
}
