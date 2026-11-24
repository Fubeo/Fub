// La sezione «Tavole» del Design nel Disegno completo: il pannello Artboards di VectorCraft
// (`vendor/vectorcraft/crates/engine/src/cmd/panelcmds.rs`, `layer.rs`). Si vede senza oggetti
// scelti, quando l'ispettore mostra il documento.
//
// - L'elenco delle tavole, nell'ordine del disegno: la tavola attuale (dove sta la vista) è
//   segnata; un clic porta la vista su una tavola e la fa scegliere per i campi sotto.
// - I campi della tavola scelta: il nome (`artboard.setProps {index, name}`), X e Y
//   (`artboard.move {index, dx, dy, moveArt}`: il disegno va con lei se la casella lo dice, come
//   «Move/Copy Artwork with Artboard»), larghezza e altezza (`artboard.setProps`).
// - I pulsanti: Nuova, Duplica, Elimina, Elimina le vuote, Sposta su e giù (`artboard.reorder`),
//   Copia e Taglia (poi Modifica › Incolla).
//
// Il colore, il blocco e i segni di una tavola non ci sono: il file non li tiene ancora. Le
// regole (`regoleTavole`) sono pure; il resto è DOM.

import { languageCurrent } from "../../../../../i18n/strings";
import { numberField } from "../../../../../kit/number-field";
import type { ContestoCompleto } from "../../carica";
import { chiediNuovaTavola, nuovaTavolaDiSerie, valoriNuovaTavola } from "./nuova";
import { problemaDelNumero, type Etichette } from "../../opzioni";
import type { ContestoSezione, Sezione, TavoleDocumento } from "../../sezioni";

/// L'id della sezione nella scheda Design.
export const SEZIONE_TAVOLE = "artboards";

/// I comandi del motore che la sezione manda, per id della riga dell'indice.
export const COMANDI_TAVOLE = {
  nuova: "artboard.new",
  duplica: "artboard.duplicate",
  elimina: "artboard.delete",
  eliminaVuote: "artboard.deleteEmpty",
  ordine: "artboard.reorder",
  copia: "artboard.copy",
  taglia: "artboard.cut",
  opzioni: "artboard.setProps",
  sposta: "artboard.move",
} as const;

export type AzioneTavola = "nuova" | "duplica" | "elimina" | "eliminaVuote" | "su" | "giu" | "copia" | "taglia";

/// I pulsanti, nell'ordine del pannello di VectorCraft.
const AZIONI: readonly AzioneTavola[] = ["nuova", "duplica", "elimina", "eliminaVuote", "su", "giu", "copia", "taglia"];

/// Perché un pulsante è spento per la tavola di posto `indice` (la chiave del testo), o `null`.
export function regoleTavole(tavole: TavoleDocumento | undefined, indice: number | null): Readonly<Record<AzioneTavola, string | null>> {
  const n = tavole?.elenco.length ?? 0;
  const senza = n === 0 || indice === null ? "tavole.nessuna" : null;
  return {
    nuova: null,
    duplica: senza,
    elimina: senza ?? (n <= 1 ? "tavole.ultima" : null),
    eliminaVuote: n === 0 ? "tavole.nessuna" : null,
    su: senza ?? (indice === 0 ? "" : null),
    giu: senza ?? (indice === n - 1 ? "" : null),
    copia: senza,
    taglia: senza ?? (n <= 1 ? "tavole.ultima" : null),
  };
}

/// Il comando e i valori di un pulsante per la tavola `indice`; `art` dice se il disegno va con lei.
export function comandoDi(azione: AzioneTavola, indice: number, art: boolean): { readonly id: string; readonly valori: Readonly<Record<string, unknown>> } {
  switch (azione) {
    case "nuova":
      return { id: COMANDI_TAVOLE.nuova, valori: {} };
    case "eliminaVuote":
      return { id: COMANDI_TAVOLE.eliminaVuote, valori: {} };
    case "duplica":
      return { id: COMANDI_TAVOLE.duplica, valori: { index: indice, art } };
    case "copia":
      return { id: COMANDI_TAVOLE.copia, valori: { index: indice, art } };
    case "taglia":
      return { id: COMANDI_TAVOLE.taglia, valori: { index: indice, art } };
    case "elimina":
      return { id: COMANDI_TAVOLE.elimina, valori: { index: indice } };
    case "su":
      return { id: COMANDI_TAVOLE.ordine, valori: { index: indice, to: indice - 1 } };
    case "giu":
      return { id: COMANDI_TAVOLE.ordine, valori: { index: indice, to: indice + 1 } };
  }
}

/// Il posto della tavola che i campi mostrano: quella scelta nell'elenco se c'è ancora, poi
/// l'attuale, poi la prima.
export function tavolaScelta(tavole: TavoleDocumento | undefined, scelta: string | null): number | null {
  const elenco = tavole?.elenco ?? [];
  if (elenco.length === 0) return null;
  for (const id of [scelta, tavole?.attuale ?? null]) {
    const i = id === null ? -1 : elenco.findIndex((t) => t.id === id);
    if (i >= 0) return i;
  }
  return 0;
}

let identificativi = 0;

/// La sezione coi testi `testi` della famiglia; `esegui` è il percorso unico dei comandi del
/// Completo (`ContestoCompleto.esegui`).
export function sezioneTavole(testi: Etichette, esegui: ContestoCompleto["esegui"]): Sezione {
  const parola = (chiave: string): string => {
    const voce = testi[chiave];
    if (voce === undefined) return chiave;
    return languageCurrent().startsWith("en") ? voce.en : voce.it;
  };
  // Ciò che resta fra un giro e l'altro: la tavola scelta nell'elenco e la casella del disegno.
  const ricordo = { scelta: null as string | null, art: true };
  return {
    id: SEZIONE_TAVOLE,
    scheda: "design",
    titolo: parola("tavole.titolo"),
    // Il documento: nessun oggetto scelto.
    quando: (sel) => sel.numero === 0,
    disegna: (contesto) => disegna(contesto, parola, esegui, ricordo),
  };
}

function disegna(
  contesto: ContestoSezione,
  parola: (chiave: string) => string,
  esegui: ContestoCompleto["esegui"],
  ricordo: { scelta: string | null; art: boolean },
): () => void {
  const { corpo, vita, tavole } = contesto;
  const elenco = tavole?.elenco ?? [];
  const indice = tavolaScelta(tavole, ricordo.scelta);
  const tavola = indice === null ? null : elenco[indice]!;
  const n = ++identificativi;
  const manda = (id: string, valori: Readonly<Record<string, unknown>>): void => {
    if (vita.closed) return;
    void esegui(id, valori).then(() => contesto.aggiorna());
  };

  // L'elenco: una lista di pulsanti, uno per tavola.
  const lista = document.createElement("ul");
  lista.className = "draw-artboards-list";
  lista.setAttribute("aria-label", parola("tavole.elenco"));
  const voci = elenco.map((t, i) => {
    const riga = document.createElement("li");
    const voce = document.createElement("button");
    voce.type = "button";
    voce.className = "draw-artboards-item";
    voce.dataset.board = t.id;
    voce.tabIndex = i === indice ? 0 : -1;
    voce.setAttribute("aria-pressed", String(i === indice));
    if (t.id === tavole?.attuale) voce.setAttribute("aria-current", "true");
    const numero = document.createElement("span");
    numero.className = "draw-artboards-number";
    numero.textContent = String(i + 1);
    const nome = document.createElement("span");
    nome.className = "draw-artboards-name";
    nome.textContent = t.nome;
    voce.append(numero, nome);
    if (t.id === tavole?.attuale) {
      const segno = document.createElement("span");
      segno.className = "draw-artboards-current";
      segno.textContent = parola("tavole.attiva");
      voce.append(segno);
    }
    vita.listen(voce, "click", () => {
      ricordo.scelta = t.id;
      tavole?.visita(i);
      contesto.aggiorna();
    });
    riga.append(voce);
    lista.append(riga);
    return voce;
  });
  // Su e giù si muovono fra le tavole; Tab ne prende una sola.
  vita.listen(lista, "keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const adesso = voci.indexOf(document.activeElement as HTMLButtonElement);
    if (adesso < 0) return;
    event.preventDefault();
    const dopo = voci[Math.min(voci.length - 1, Math.max(0, adesso + (event.key === "ArrowDown" ? 1 : -1)))]!;
    for (const v of voci) v.tabIndex = v === dopo ? 0 : -1;
    dopo.focus();
  });

  const vuota = document.createElement("p");
  vuota.className = "draw-properties-note";
  vuota.hidden = elenco.length > 0;
  vuota.textContent = parola("tavole.nessuna");

  // I campi della tavola scelta.
  const campi = document.createElement("div");
  campi.className = "draw-artboards-fields";
  campi.hidden = tavola === null;
  if (tavola !== null && indice !== null) {
    const etichetta = document.createElement("label");
    etichetta.className = "kit-number-label";
    etichetta.textContent = parola("tavole.nome");
    const nome = document.createElement("input");
    nome.type = "text";
    nome.className = "draw-properties-input draw-artboards-name-input";
    nome.id = `draw-artboards-name-${n}`;
    nome.value = tavola.nome;
    etichetta.htmlFor = nome.id;
    const confermaNome = (): void => {
      const testo = nome.value.trim();
      if (testo === "" || testo === tavola.nome) {
        nome.value = tavola.nome;
        return;
      }
      manda(COMANDI_TAVOLE.opzioni, { index: indice, name: testo });
    };
    vita.listen(nome, "change", confermaNome);
    vita.listen(nome, "keydown", (event) => {
      if (event.key === "Escape") nome.value = tavola.nome;
    });
    const rigaNome = document.createElement("div");
    rigaNome.className = "draw-artboards-name-field";
    rigaNome.append(etichetta, nome);
    campi.append(rigaNome);

    const [x, y, w, h] = tavola.rect;
    const campo = (chiave: string, valore: number, conferma: (v: number) => string | void, min?: number): void => {
      const f = numberField({
        label: parola(chiave),
        value: valore,
        unit: "px",
        places: 2,
        ...(min === undefined ? {} : { min }),
        mixedText: "",
        problem: problemaDelNumero,
        onCommit: conferma,
        lifetime: vita,
      });
      f.element.dataset.field = chiave;
      campi.append(f.element);
    };
    const sposta = (dx: number, dy: number): void => {
      if (dx !== 0 || dy !== 0) manda(COMANDI_TAVOLE.sposta, { index: indice, dx, dy, moveArt: ricordo.art });
    };
    const misura = (chiave: "width" | "height", prima: number) => (v: number): string | void => {
      if (!(v > 0)) return parola("tavole.misura");
      if (v !== prima) manda(COMANDI_TAVOLE.opzioni, { index: indice, [chiave]: v });
    };
    campo("tavole.x", x, (v) => sposta(v - x, 0));
    campo("tavole.y", y, (v) => sposta(0, v - y));
    campo("tavole.larghezza", w, misura("width", w), 0.001);
    campo("tavole.altezza", h, misura("height", h), 0.001);
  }

  // La casella del disegno: vale per Sposta (X e Y), Duplica, Copia e Taglia.
  const casella = document.createElement("label");
  casella.className = "draw-artboards-art";
  const spunta = document.createElement("input");
  spunta.type = "checkbox";
  spunta.checked = ricordo.art;
  vita.listen(spunta, "change", () => {
    ricordo.art = spunta.checked;
  });
  casella.append(spunta, document.createTextNode(` ${parola("tavole.conDisegno")}`));

  // I pulsanti.
  const regole = regoleTavole(tavole, indice);
  const barra = document.createElement("div");
  barra.className = "draw-properties-bar draw-artboards-bar";
  barra.setAttribute("role", "toolbar");
  barra.setAttribute("aria-label", parola("tavole.titolo"));
  const nota = document.createElement("p");
  nota.className = "draw-properties-note";
  nota.id = `draw-artboards-note-${n}`;
  nota.hidden = true;
  const nuovaConOpzioni = (): void => {
    const diSerie = nuovaTavolaDiSerie(tavole);
    const posto = elenco.length;
    void chiediNuovaTavola(diSerie, parola).then((campi) => {
      if (campi === null || vita.closed) return;
      ricordo.scelta = null;
      void esegui(COMANDI_TAVOLE.nuova, valoriNuovaTavola(campi, diSerie)).then(() => {
        // La tavola nuova è l'ultima: diventa quella attuale, con la vista su di lei.
        tavole?.visita(posto);
        contesto.aggiorna();
      });
    });
  };
  const pulsanti = AZIONI.map((azione, i) => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "draw-button draw-artboards-action";
    control.dataset.action = azione;
    control.tabIndex = i === 0 ? 0 : -1;
    control.textContent = parola(`tavole.${azione}`);
    const perche = regole[azione];
    if (perche !== null) {
      control.setAttribute("aria-disabled", "true");
      if (perche !== "") {
        control.title = `${parola(`tavole.${azione}`)} — ${parola(perche)}`;
        nota.textContent = parola(perche);
        nota.hidden = false;
        control.setAttribute("aria-describedby", nota.id);
      }
    }
    vita.listen(control, "click", (event) => {
      if (perche !== null || vita.closed) return;
      // Alt+clic su Nuova: le Opzioni della tavola nuova, come in VectorCraft.
      if (azione === "nuova" && event.altKey) {
        nuovaConOpzioni();
        return;
      }
      const { id, valori } = comandoDi(azione, indice ?? 0, ricordo.art);
      // La tavola spostata resta quella scelta; una nuova, una copia o una tagliata no.
      if (azione !== "su" && azione !== "giu") ricordo.scelta = null;
      manda(id, valori);
    });
    barra.append(control);
    return control;
  });
  vita.listen(barra, "keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const adesso = pulsanti.indexOf(document.activeElement as HTMLButtonElement);
    if (adesso < 0) return;
    event.preventDefault();
    const dopo = pulsanti[(adesso + (event.key === "ArrowRight" ? 1 : pulsanti.length - 1)) % pulsanti.length]!;
    for (const p of pulsanti) p.tabIndex = p === dopo ? 0 : -1;
    dopo.focus();
  });

  const tutto = document.createElement("div");
  tutto.className = "draw-artboards";
  tutto.dataset.column = "all";
  tutto.append(lista, vuota, campi, casella, barra, nota);
  corpo.append(tutto);
  return () => corpo.replaceChildren();
}
