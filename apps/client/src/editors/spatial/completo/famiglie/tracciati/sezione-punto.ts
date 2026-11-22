// La sezione «Punto di ancoraggio» del Design (piano K6, T12, giro 4; prototipo
// `pezzo-design-punto` di PLAN-ui). La registra la famiglia `tracciati` quando è
// pronta. Mostra solo ciò che ha un comando dietro: «Converti» in angolo o in
// morbido, `path.convertAnchors` coi punti scelti. Il raggio dell'angolo
// (`addon.pathtools.cornerSet`) non ha ancora un comando, e non compare, come le
// voci senza comando delle altre sezioni (Allinea mostra solo le sue `align.*`).
//
// I punti vengono dalla selezione della sezione (`Selezione.punti`, lo stato dello
// strumento del motore): senza punti i due pulsanti restano raggiungibili ma spenti
// (`aria-disabled`), col perché nel titolo e nella nota sotto. Il motore non dice
// com'è il punto scelto, quindi sono due comandi e non una scelta con uno acceso.
// Dopo il comando lo stato dello strumento si rilegge (`rileggi`), come fa la fila
// dei punti.

import { languageCurrent } from "../../../../../i18n/strings";
import { iconEl } from "../../../../../ui/icons";
import type { ContestoCompleto } from "../../carica";
import type { Etichette } from "../../opzioni";
import type { ContestoSezione, Sezione } from "../../sezioni";
import { COMANDI_PUNTI, regolePunti } from "./opzioni-punto";

/// L'id della sezione nella scheda Design: quello del prototipo (`data-section`).
export const SEZIONE_PUNTO = "anchor";

/// Le due conversioni, nell'ordine del prototipo.
const CONVERSIONI = [
  { to: "corner", nome: "punto.angolo", titolo: "punto.angolo.titolo", icona: "draw-point-corner" },
  { to: "smooth", nome: "punto.morbido", titolo: "punto.morbido.titolo", icona: "draw-point-smooth" },
] as const;

let identificativi = 0;

/// La sezione coi testi `testi` della famiglia; `esegui` è il percorso unico dei
/// comandi del Completo (`ContestoCompleto.esegui`).
export function sezionePunto(testi: Etichette, esegui: ContestoCompleto["esegui"]): Sezione {
  const parola = (chiave: string): string => {
    const voce = testi[chiave];
    if (voce === undefined) return chiave;
    return languageCurrent().startsWith("en") ? voce.en : voce.it;
  };
  return {
    id: SEZIONE_PUNTO,
    scheda: "design",
    titolo: parola("sezione.punto"),
    // Con un oggetto scelto, o dei punti: spenta col perché se non ci sono punti.
    quando: (sel) => sel.numero > 0 || sel.punti.length > 0,
    disegna: (contesto) => disegna(contesto, parola, esegui),
  };
}

function disegna(contesto: ContestoSezione, parola: (chiave: string) => string, esegui: ContestoCompleto["esegui"]): () => void {
  const { corpo, vita } = contesto;
  const punti = [...contesto.sel.punti];
  const perche = regolePunti(punti).converti;

  const campo = document.createElement("div");
  campo.className = "draw-properties-field";
  campo.dataset.column = "all";
  const etichetta = document.createElement("span");
  etichetta.className = "draw-properties-label";
  etichetta.id = `draw-anchor-label-${++identificativi}`;
  etichetta.textContent = parola("punto.converti");
  const barra = document.createElement("div");
  barra.className = "draw-properties-bar";
  barra.setAttribute("role", "toolbar");
  barra.setAttribute("aria-labelledby", etichetta.id);
  const nota = document.createElement("p");
  nota.className = "draw-properties-note";
  nota.id = `draw-anchor-note-${identificativi}`;
  nota.hidden = perche === null;
  if (perche !== null) nota.textContent = parola(`punto.${perche}`);

  const pulsanti = CONVERSIONI.map((conversione, i) => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "draw-button draw-properties-segment";
    control.dataset.to = conversione.to;
    control.tabIndex = i === 0 ? 0 : -1;
    control.setAttribute("aria-label", parola(conversione.nome));
    const icona = iconEl(conversione.icona);
    if (icona !== null) control.append(icona);
    if (perche === null) {
      control.title = parola(conversione.titolo);
    } else {
      control.title = `${parola(conversione.titolo)} — ${parola(`punto.${perche}`)}`;
      control.setAttribute("aria-disabled", "true");
      control.setAttribute("aria-describedby", nota.id);
    }
    vita.listen(control, "click", () => {
      // Spento: la nota dice già perché, e il clic non manda niente.
      if (perche !== null || vita.closed) return;
      void esegui(COMANDI_PUNTI.converti, { to: conversione.to, anchors: punti }).then(() => {
        contesto.rileggi();
      });
    });
    barra.append(control);
    return control;
  });

  // Le frecce si muovono fra i due pulsanti della barra; Tab ne prende uno solo.
  vita.listen(barra, "keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const adesso = pulsanti.indexOf(document.activeElement as HTMLButtonElement);
    if (adesso < 0) return;
    event.preventDefault();
    const dopo = pulsanti[(adesso + (event.key === "ArrowRight" ? 1 : pulsanti.length - 1)) % pulsanti.length]!;
    for (const p of pulsanti) p.tabIndex = p === dopo ? 0 : -1;
    dopo.focus();
  });

  campo.append(etichetta, barra, nota);
  corpo.append(campo);
  return () => corpo.replaceChildren();
}
