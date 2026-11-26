// «Modalità di disegno» (`view.drawMode`, K6 T11): la voce di ≡ › Visualizza apre la scelta di
// tre modi. Normale e Dietro li manda al motore col loro `mode`; Dentro è una riga spenta col suo
// perché, perché il file non sa ancora scrivere il gruppo di ritaglio che il motore ne fa (la
// riga `view.drawMode` resta «da fare» in mappa). Il modo sta nella sessione del motore: il Completo
// lo tiene per il segno e lo rilegge dal valore che il motore ha accettato, non dal clic.
import { openDialog } from "../../../kit/dialog";
import { textButton } from "../../../kit/button";
import { openLifetime } from "../../../ui/lifetime";
import { t } from "../strings";

/// I modi che la scelta manda al motore (Dentro non c'è ancora).
export type ModoDisegno = "normal" | "behind";

/// Ciò che la scelta usa del Completo: il modo accettato adesso, e l'invio di un modo nuovo.
export interface PortaModoDisegno {
  leggi(): ModoDisegno;
  /// Manda il modo al motore; `true` se il motore l'ha accettato e il segno è cambiato.
  imposta(modo: ModoDisegno): Promise<boolean>;
}

/// Apre la scelta. Annulla e Esc non cambiano niente; scegliere il modo già attivo non manda niente;
/// una scelta nuova manda un solo comando, perché il dialogo si chiude alla prima risposta.
export function apriModoDisegno(porta: PortaModoDisegno): Promise<void> {
  const vita = openLifetime();
  const attivo = porta.leggi();
  // Dentro è nella scelta, spenta: il pulsante è disabilitato, e sotto c'è il perché.
  const corpo = document.createElement("div");
  const dentro = textButton({ label: t("draw.view.modo.inside"), onPress: () => undefined, lifetime: vita });
  dentro.dataset.action = "inside";
  dentro.disabled = true;
  const perche = document.createElement("p");
  perche.textContent = t("draw.view.modo.dentroPerche");
  corpo.append(dentro, perche);
  const etichetta = (modo: ModoDisegno, chiave: "draw.view.modo.normal" | "draw.view.modo.behind"): string =>
    modo === attivo ? t("draw.view.modo.attivo", { nome: t(chiave) }) : t(chiave);
  const dialogo = openDialog<"annulla" | ModoDisegno>({
    title: t("draw.view.modo.title"),
    description: t("draw.view.modo.description"),
    body: corpo,
    actions: [
      { id: "cancel", label: t("draw.view.modo.cancel"), value: "annulla" },
      {
        id: "normal",
        label: etichetta("normal", "draw.view.modo.normal"),
        kind: attivo === "normal" ? "primary" : "normal",
        value: "normal",
      },
      {
        id: "behind",
        label: etichetta("behind", "draw.view.modo.behind"),
        kind: attivo === "behind" ? "primary" : "normal",
        value: "behind",
      },
    ],
    dismissValue: "annulla",
    lifetime: vita,
  });
  return dialogo.result.then(async (scelta) => {
    vita.close();
    if (scelta === "annulla" || scelta === attivo) return;
    await porta.imposta(scelta);
  });
}
