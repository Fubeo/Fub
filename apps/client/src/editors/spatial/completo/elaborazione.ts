// La sezione «Elaborazione tracciati» dell'ispettore Design (K6 T12, giro 5; id
// `pathfinder`, come il pannello della mappa). La mette il Completo da sé, come Allinea:
// le dieci voci `object.pathfinder.*` sono nell'indice generato, e il clic passa dal
// percorso unico dei comandi (`eseguiPerId` in `index.ts`), che carica la famiglia
// `tracciati` solo allora. Due barre: i quattro metodi forma e le sei operazioni, con le
// figure `draw-pf-*` di Fub e lo stesso ordine di ≡ › Oggetto › Elaborazione tracciati
// (`FILE_ELABORAZIONE` in `comandi.ts`).
//
// Acceso o spento lo dice il client dal numero di oggetti scelti: con meno di due i
// pulsanti restano raggiungibili ma spenti (`aria-disabled`), col perché nel titolo e
// nella nota (`needs_two`). Il resto (un oggetto bloccato, un'immagine) lo dice il
// motore al clic, con le parole del rifiuto. Le parole stanno nel catalogo del Completo,
// così ci sono prima che la famiglia arrivi.

import { iconEl } from "../../../ui/icons";
import { ensureDrawIcons } from "../icons";
import { t, type DrawKey } from "../strings";
import { METODI_FORMA, OPERAZIONI_ELABORAZIONE } from "./comandi";
import { registraSezione, type ContestoSezione, type Sezione, type Sezioni } from "./sezioni";

/// L'id della sezione nella scheda Design: l'ultimo pezzo del posto della mappa
/// (`ispettore/design/pathfinder`).
export const SEZIONE_ELABORAZIONE = "pathfinder";

/// Quello che la sezione manda: l'id della voce `object.pathfinder.*`, senza valori.
export type EseguiElaborazione = (id: string) => void;

/// Quanti oggetti servono a ogni voce: due (`needs_two`).
export const OGGETTI_MINIMI = 2;

/// Le figure delle voci, dal set di Fub (`icons.ts`).
const ICONE: Readonly<Record<string, string>> = {
  "object.pathfinder.unite": "draw-pf-unite",
  "object.pathfinder.minusFront": "draw-pf-minus",
  "object.pathfinder.intersect": "draw-pf-intersect",
  "object.pathfinder.exclude": "draw-pf-exclude",
  "object.pathfinder.divide": "draw-pf-divide",
  "object.pathfinder.trim": "draw-pf-trim",
  "object.pathfinder.merge": "draw-pf-merge",
  "object.pathfinder.crop": "draw-pf-crop",
  "object.pathfinder.outline": "draw-pf-outline",
  "object.pathfinder.minusBack": "draw-pf-minus-back",
};

/// Le due barre: il nome e le voci.
const BARRE: readonly { readonly chiave: DrawKey; readonly ids: readonly string[] }[] = [
  { chiave: "draw.elaborazione.metodi", ids: METODI_FORMA },
  { chiave: "draw.elaborazione.operazioni", ids: OPERAZIONI_ELABORAZIONE },
];

/// La parola di una voce: `draw.elaborazione.<resto dell'id>`.
function parola(id: string): string {
  return t(`draw.elaborazione.${id.slice("object.pathfinder.".length)}` as DrawKey);
}

let identificativi = 0;

function disegna(contesto: ContestoSezione, esegui: EseguiElaborazione): () => void {
  const { corpo, vita } = contesto;
  ensureDrawIcons();
  const spento = contesto.sel.numero < OGGETTI_MINIMI;
  const perche = t("draw.disabled.needs_two");
  const numero = ++identificativi;

  const nota = document.createElement("p");
  nota.className = "draw-properties-note";
  nota.id = `draw-pathfinder-note-${numero}`;
  nota.hidden = !spento;
  if (spento) nota.textContent = perche;

  BARRE.forEach((barra, b) => {
    const campo = document.createElement("div");
    campo.className = "draw-properties-field";
    campo.dataset.column = "all";
    const etichetta = document.createElement("span");
    etichetta.className = "draw-properties-label";
    etichetta.id = `draw-pathfinder-label-${numero}-${b}`;
    etichetta.textContent = t(barra.chiave);
    const fila = document.createElement("div");
    fila.className = "draw-properties-bar";
    fila.setAttribute("role", "toolbar");
    fila.setAttribute("aria-labelledby", etichetta.id);

    const pulsanti = barra.ids.map((id, i) => {
      const control = document.createElement("button");
      control.type = "button";
      control.className = "draw-button draw-properties-segment";
      control.dataset.id = id;
      control.tabIndex = i === 0 ? 0 : -1;
      control.setAttribute("aria-label", parola(id));
      const icona = iconEl(ICONE[id] ?? "");
      if (icona !== null) control.append(icona);
      if (spento) {
        control.title = `${parola(id)} — ${perche}`;
        control.setAttribute("aria-disabled", "true");
        control.setAttribute("aria-describedby", nota.id);
      } else {
        control.title = parola(id);
      }
      vita.listen(control, "click", () => {
        // Spento: la nota dice già perché, e il clic non manda niente.
        if (spento || vita.closed) return;
        esegui(id);
      });
      fila.append(control);
      return control;
    });

    // Le frecce si muovono fra i pulsanti della barra; Tab ne prende uno solo.
    vita.listen(fila, "keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const adesso = pulsanti.indexOf(document.activeElement as HTMLButtonElement);
      if (adesso < 0) return;
      event.preventDefault();
      const passo = event.key === "ArrowRight" ? 1 : pulsanti.length - 1;
      const dopo = pulsanti[(adesso + passo) % pulsanti.length]!;
      for (const p of pulsanti) p.tabIndex = p === dopo ? 0 : -1;
      dopo.focus();
    });

    campo.append(etichetta, fila);
    corpo.append(campo);
  });
  corpo.append(nota);
  return () => corpo.replaceChildren();
}

/// La sezione per la scheda Design, con un oggetto scelto o più. Non tocca nessuna
/// famiglia: `esegui` è il percorso unico dei comandi, che carica la famiglia al clic.
export function sezioneElaborazione(esegui: EseguiElaborazione): Sezione {
  return {
    id: SEZIONE_ELABORAZIONE,
    scheda: "design",
    titolo: t("draw.elaborazione.titolo"),
    quando: (sel) => sel.numero > 0,
    disegna: (contesto) => disegna(contesto, esegui),
  };
}

/// Registra la sezione nel registro del Completo aperto. `false` se c'è già.
export function registraElaborazione(sezioni: Sezioni, esegui: EseguiElaborazione): boolean {
  return registraSezione({ sezioni }, sezioneElaborazione(esegui));
}
