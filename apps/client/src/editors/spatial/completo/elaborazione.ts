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
//
// I metodi forma e le forme composte (K6 T13), come il pannello Elaborazione tracciati
// di VectorCraft e di Illustrator: un metodo forma con Alt fa degli oggetti scelti una
// forma composta in quel metodo (`object.compoundShape.make`); con una forma composta fra
// gli oggetti scelti il metodo va ai suoi membri (`object.compoundShape.setMode`), e i
// metodi forma sono accesi anche con lei sola; se no parte l'elaborazione che toglie gli
// oggetti di prima. Se c'è una forma composta lo dice il motore (Metodo forma vale),
// una volta per giro della sezione: il pannello la rifà quando la selezione cambia.

import { iconEl } from "../../../ui/icons";
import { ensureDrawIcons } from "../icons";
import { t, type DrawKey } from "../strings";
import { METODI_FORMA, OPERAZIONI_ELABORAZIONE } from "./comandi";
import type { Lifetime } from "../../../ui/lifetime";
import { registraSezione, type ContestoSezione, type Sezione, type Sezioni } from "./sezioni";

/// L'id della sezione nella scheda Design: l'ultimo pezzo del posto della mappa
/// (`ispettore/design/pathfinder`).
export const SEZIONE_ELABORAZIONE = "pathfinder";

/// Ciò che la sezione usa del Completo.
export interface AzioniElaborazione {
  /// Manda la voce `id` dell'indice coi valori `valori`, senza finestra.
  readonly esegui: (id: string, valori?: Readonly<Record<string, unknown>>) => void;
  /// Se fra gli oggetti scelti c'è una forma composta. `false` senza motore o se
  /// non risponde.
  readonly composta: () => Promise<boolean>;
}

/// Il metodo di una forma composta per ogni metodo forma (lo schema di
/// `object.compoundShape.make` e `setMode`).
export const METODO_DI: Readonly<Record<string, string>> = {
  "object.pathfinder.unite": "add",
  "object.pathfinder.minusFront": "subtract",
  "object.pathfinder.intersect": "intersect",
  "object.pathfinder.exclude": "exclude",
};

/// La voce che un clic su un metodo forma manda: con Alt la forma composta nuova, con
/// una forma composta fra gli oggetti scelti il suo metodo, se no l'elaborazione.
export function voceDelMetodo(id: string, alt: boolean, composta: boolean): { readonly id: string; readonly valori: Readonly<Record<string, unknown>> } {
  const mode = METODO_DI[id];
  if (mode === undefined) return { id, valori: {} };
  if (alt) return { id: "object.compoundShape.make", valori: { mode } };
  if (composta) return { id: "object.compoundShape.setMode", valori: { mode } };
  return { id, valori: {} };
}

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

/// Spegne o accende un pulsante: spento resta raggiungibile, col perché nel titolo e
/// nella nota.
function metti(control: HTMLButtonElement, spento: boolean, titolo: string, perche: string, nota: string): void {
  if (spento) {
    control.title = `${titolo} — ${perche}`;
    control.setAttribute("aria-disabled", "true");
    control.setAttribute("aria-describedby", nota);
  } else {
    control.title = titolo;
    control.removeAttribute("aria-disabled");
    control.removeAttribute("aria-describedby");
  }
}

/// Chiede al motore se c'è una forma composta, una volta: `false` senza motore, o
/// chiusa la vita della sezione.
function chiediComposta(contesto: ContestoSezione, azioni: AzioniElaborazione, vita: Lifetime): Promise<boolean> {
  if (contesto.motore === null) return Promise.resolve(false);
  return azioni.composta().then(
    (si) => si && !vita.closed,
    () => false,
  );
}

function disegna(contesto: ContestoSezione, azioni: AzioniElaborazione): () => void {
  const { corpo, vita } = contesto;
  ensureDrawIcons();
  const pochi = contesto.sel.numero < OGGETTI_MINIMI;
  const perche = t("draw.disabled.needs_two");
  const numero = ++identificativi;
  // Se c'è una forma composta: finché il motore non risponde, no.
  let composta = false;
  const risposta = chiediComposta(contesto, azioni, vita);
  // Lo stato dei metodi forma, rifatto quando il motore risponde.
  const metodi: Array<() => void> = [];

  const nota = document.createElement("p");
  nota.className = "draw-properties-note";
  nota.id = `draw-pathfinder-note-${numero}`;
  nota.hidden = !pochi;
  if (pochi) nota.textContent = perche;

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
      const metodo = METODO_DI[id] !== undefined;
      // Un metodo forma vale anche con una forma composta sola; un'operazione no.
      const spento = (): boolean => pochi && !(metodo && composta);
      const titolo = (): string =>
        !metodo ? parola(id) : t(composta ? "draw.elaborazione.metodoComposta" : "draw.elaborazione.conAlt", { nome: parola(id) });
      const aggiorna = (): void => metti(control, spento(), titolo(), perche, nota.id);
      aggiorna();
      if (metodo) metodi.push(aggiorna);
      vita.listen(control, "click", (event) => {
        // Spento: la nota dice già perché, e il clic non manda niente.
        if (spento() || vita.closed) return;
        const alt = event.altKey;
        void risposta.then((adesso) => {
          if (vita.closed) return;
          const voce = voceDelMetodo(id, alt, adesso);
          azioni.esegui(voce.id, voce.valori);
        });
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
  void risposta.then((si) => {
    if (!si || vita.closed) return;
    composta = true;
    for (const aggiorna of metodi) aggiorna();
  });
  return () => corpo.replaceChildren();
}

/// La sezione per la scheda Design, con un oggetto scelto o più. Non tocca nessuna
/// famiglia: `esegui` è il percorso unico dei comandi, che carica la famiglia al clic.
export function sezioneElaborazione(azioni: AzioniElaborazione): Sezione {
  return {
    id: SEZIONE_ELABORAZIONE,
    scheda: "design",
    titolo: t("draw.elaborazione.titolo"),
    quando: (sel) => sel.numero > 0,
    disegna: (contesto) => disegna(contesto, azioni),
  };
}

/// Registra la sezione nel registro del Completo aperto. `false` se c'è già.
export function registraElaborazione(sezioni: Sezioni, azioni: AzioniElaborazione): boolean {
  return registraSezione({ sezioni }, sezioneElaborazione(azioni));
}
