// La guardia di chiusura della finestra, come servizio.
//
// È l'ultimo momento in cui ciò che è stato battuto può ancora finire sul
// disco o in una bozza: le superfici si fermano, le finestre documento si
// svuotano, la coda di salvataggio si chiude — e se qualcosa resta soltanto
// nella webview la chiusura si rifiuta. Non disegna niente: ciò che ha da dire
// lo dice dalla porta degli avvisi che la shell le passa, e chi la monta
// decide **quando** (subito dopo i documenti, prima del vault) e a quale
// `Lifetime` appendere il disposer che riceve.
import { errorText } from "../host/errors";
import { onClose } from "../host/ipc";
import { t } from "../i18n/strings";
import type { Teardown } from "../ui/lifetime";
import type { Tone } from "../ui/notify";
import { freezeDocumentSurfaces } from "./document-controller";
import { flushBeforeClose } from "./document-session";
import { drainDocumentWindows } from "./document-windows";

/// Ciò che la guardia chiede alla shell che la monta.
export interface CloseGuardPorts {
  /// Un avviso all'utente: la chiusura rifiutata, e perché.
  notify(message: string, tone?: Tone): void;
}

/// Si iscrive alla chiusura della finestra e restituisce chi toglie
/// l'iscrizione.
///
/// L'iscrizione **non si attende**: parte qui, in sincrono, e il disposer la
/// scioglie quando arriva — anche se viene chiamato prima che sia arrivata.
export function mountCloseGuard(ports: CloseGuardPorts): Teardown {
  const closeListener = onClose(async () => {
    freezeDocumentSurfaces(true);
    try {
      if (!await drainDocumentWindows()) {
        freezeDocumentSurfaces(false);
        return false;
      }
      // Un buffer che non è finito né sul disco né in una bozza vive soltanto
      // in questa webview: la chiusura si rifiuta, e il testo resta aperto.
      const unprotected = await flushBeforeClose();
      if (unprotected.length > 0) {
        freezeDocumentSurfaces(false);
        ports.notify(t("document.close_unprotected", { docs: unprotected.join(", ") }), "guasto");
        return false;
      }
      return true;
    } catch (error) {
      freezeDocumentSurfaces(false);
      ports.notify(t("document.close_failed", { reason: errorText(error) }), "guasto");
      return false;
    }
  }, (error) => {
    freezeDocumentSurfaces(false);
    ports.notify(t("document.close_failed", { reason: errorText(error) }), "guasto");
  }).catch(() => {
    ports.notify(t("document.close_unhooked"), "guasto");
    return () => {};
  });
  return () => {
    void closeListener.then(
      (unlisten) => unlisten(),
      () => ports.notify(t("document.close_unhooked"), "guasto"),
    );
  };
}
