// Il selettore del colore del Disegno completo (K6 T14, selettore; riga `ui.colorPicker` della mappa):
// la voce Modifica › Modifica colori › «Selettore colore…» apre il selettore del kit
// (`kit/color/picker.ts`), lo stesso del pozzo della sezione Colore, e lo parte dal lato attivo: il
// riempimento, o il contorno se è quello che il pozzo mostra attivo. OK manda `paint.setFill` o
// `paint.setStroke` col colore scelto, in un solo passo di Annulla.
//
// - **Il pozzo, non un comando nuovo.** Gli stessi comandi del pozzo, con `{none: true}` per nessun
//   colore. La famiglia `colore` si prepara prima, come per ogni comando del menu (`eseguiPerId`).
// - **Il colore di partenza** è l'ultimo che il pannello ha dato alla sezione Colore (`ColoriVisti`),
//   cioè la vista del pozzo. Un colore misto, una sfumatura o un motivo partono senza colore, e una
//   nota lo dice: il pozzo mostra «Misto» o il nome della sfumatura.
// - **Spenta come il pozzo.** Senza selezione, o senza il colore del lato attivo, la voce è spenta con
//   la frase del pozzo (`draw.colore.vuota`, `draw.colore.manca`).
// - **Una finestra per volta.** Un secondo comando mentre la finestra è aperta non ne apre un'altra.
// - **Un rifiuto resta nella finestra.** Un oggetto bloccato (un livello o un gruppo) dice il suo
//   perché, il colore non cambia, e la finestra resta aperta per scegliere un'altra cosa.
// - **Vita.** Ogni finestra ha una sua vita, figlia di quella del Completo: chiuso il Completo, o il
//   disegno, si chiude con i suoi ascolti, e nessun ascoltatore resta.

import { createColorPicker, type ColorPicker } from "../../../kit/color/picker";
import { openDialog } from "../../../kit/dialog";
import { formBody, formError, formNote } from "../../../kit/form";
import { identifier } from "../../../ui/a11y";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { motivoDelRifiuto } from "../motore/rifiuto";
import { t, type DrawKey } from "../strings";
import { drawPickerText } from "../tools/color-text";
import { nomeDi, type ColoriVisti, type Lato, type LatoAttivo } from "./colore-sezione";
import { applicaEsito, chiama, type DipendenzeComando } from "./esegui";
import type { ColoreSelezione, ColoriSelezione, VoceDelCompleto } from "./sezioni";

/// L'id della voce del client (`chiamata.client` dell'indice) del selettore.
export const VOCE_SELETTORE_COLORE = "ui.colorPicker";

/// Un colore `#rrggbb`, come lo scrive il pozzo.
const ESADECIMALE = /^#[0-9a-f]{6}$/i;

/// Il colore con cui il selettore parte: un colore pieno in minuscolo, `none` per nessun colore, o
/// `null` se non c'è un colore solo (un valore misto, una sfumatura, un motivo).
export function partenzaDel(colore: ColoreSelezione | undefined): string | null {
  if (colore === undefined) return null;
  // Un campione del disegno dà il suo colore pieno, come nel pozzo.
  const valore = colore.campione?.kind === "swatch" ? colore.campione.color : colore.valore;
  if (valore === "none") return "none";
  return valore !== null && ESADECIMALE.test(valore) ? valore.toLowerCase() : null;
}

/// Il colore di un lato, come lo dà il pannello.
const coloreDel = (colori: ColoriSelezione, lato: Lato): ColoreSelezione | undefined =>
  lato === "fill" ? colori.riempimento : colori.contorno;

/// Manda il colore del lato dal percorso del pozzo: `paint.setFill` o `paint.setStroke`, con `{none: true}`
/// per nessun colore. Risolve con il perché in italiano se il motore lo rifiuta; `null` se è andata, o se
/// non c'è niente da dire. Le risposte che arrivano a finestra chiusa non cambiano niente.
async function applicaColore(dipendenze: DipendenzeComando, lato: Lato, colore: string, finestra: Lifetime): Promise<DrawKey | null> {
  // La famiglia `colore` è pronta prima del comando, come per ogni voce del menu (`eseguiPerId`).
  const famiglia =
    dipendenze.carica.stato("colore").kind === "errore" ? await dipendenze.carica.riprova("colore") : await dipendenze.carica.famiglia("colore");
  if (finestra.closed) return null;
  if (famiglia.kind !== "pronta") return "draw.window.failed";
  const id = lato === "fill" ? "disegno.paint.setFill" : "disegno.paint.setStroke";
  const esito = await chiama(dipendenze, id, colore === "none" ? { none: true } : { color: colore }, false);
  if (finestra.closed) return null;
  if (esito === null) return "draw.window.unanswered";
  if (esito.refused !== null) return motivoDelRifiuto(esito.refused);
  return applicaEsito(esito, nomeDi(lato), dipendenze) ? null : "draw.completo.key.failed";
}

/// La finestra: il selettore del kit con Annulla e OK. Il colore parte da `partenza` (`null`: nessun colore,
/// e la nota lo dice). OK manda il colore scelto; un rifiuto resta nella finestra, col suo perché.
function apriFinestraSelettore(dipendenze: DipendenzeComando, lato: Lato, partenza: string | null, finestra: Lifetime): void {
  /// Il colore scelto e lasciato sul selettore; `null` se non se n'è scelto nessuno, e OK non manda niente.
  let scelto: string | null = null;
  const etichetta = document.createElement("p");
  etichetta.className = "kit-form-label";
  etichetta.id = identifier("draw-colorpicker-lato");
  etichetta.textContent = nomeDi(lato);
  const nota = formNote(t("draw.colorPicker.misto"));
  nota.hidden = partenza !== null;
  const errore = formError("");
  errore.hidden = true;
  const selettore: ColorPicker = createColorPicker({
    value: partenza,
    text: drawPickerText(),
    allowNone: true,
    onChange: (colore) => {
      scelto = colore;
      nota.hidden = true;
      errore.hidden = true;
    },
    lifetime: finestra,
  });
  selettore.element.setAttribute("aria-labelledby", etichetta.id);
  const dialogo = openDialog<string>({
    title: t("draw.colorPicker.title"),
    body: formBody([etichetta, selettore.element, nota, errore]),
    actions: [
      { id: "cancel", label: t("draw.resources.swatches.annulla"), value: "annulla" },
      { id: "ok", label: t("draw.resources.swatches.ok"), kind: "primary", value: "ok" },
    ],
    dismissValue: "annulla",
    lifetime: finestra,
    className: "draw-colorpicker-dialog",
    submit: "ok",
    confirm: (azione) => {
      const colore = scelto;
      if (azione === "annulla" || colore === null) return true;
      // Un errore del motore non lascia il dialogo occupato per sempre: dice che non ha risposto.
      return applicaColore(dipendenze, lato, colore, finestra).catch((): DrawKey => "draw.window.unanswered").then((rifiuto) => {
        if (rifiuto === null) return true;
        errore.textContent = t(rifiuto);
        errore.hidden = false;
        return false;
      });
    },
  });
  void dialogo.result.then(() => finestra.close());
}

/// La voce `ui.colorPicker` del Completo: lo stato (il perché se è spenta, come il pozzo) e l'apertura.
/// `vita` è quella del Completo: chiusa, chiude tutte le finestre aperte, e non ne apre altre.
export function voceSelettoreColore(opzioni: {
  readonly dipendenze: DipendenzeComando;
  readonly lato: LatoAttivo;
  readonly colori: ColoriVisti;
  readonly vita: Lifetime;
}): VoceDelCompleto {
  const aperte = new Set<Lifetime>();
  opzioni.vita.add(() => {
    for (const finestra of [...aperte]) finestra.close();
    aperte.clear();
  });
  const stato = (): string | null => {
    const lato = opzioni.lato.lato;
    if (opzioni.dipendenze.selezione().length === 0) return t("draw.colore.vuota", { lato: nomeDi(lato) });
    const colori = opzioni.colori.valore;
    if (colori !== null && coloreDel(colori, lato) === undefined) return t("draw.colore.manca", { lato: nomeDi(lato) });
    return null;
  };
  return {
    stato,
    esegui() {
      if (opzioni.vita.closed || aperte.size > 0) return;
      const perche = stato();
      if (perche !== null) {
        opzioni.dipendenze.annuncia(perche);
        return;
      }
      const lato = opzioni.lato.lato;
      const colori = opzioni.colori.valore;
      const finestra = openLifetime();
      aperte.add(finestra);
      finestra.add(() => aperte.delete(finestra));
      apriFinestraSelettore(opzioni.dipendenze, lato, colori === null ? null : partenzaDel(coloreDel(colori, lato)), finestra);
    },
  };
}
