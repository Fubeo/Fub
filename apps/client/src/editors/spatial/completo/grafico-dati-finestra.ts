// La finestra «Dati del grafico» del Disegno completo (K6, riga `graph.setData`): la tabella dei
// dati del grafico scelto, come quella di VectorCraft (`Dialog("graphData")`). Si apre da Oggetto ›
// Grafico › Dati, dopo un grafico disegnato trascinando uno strumento Grafico e dopo il clic che lo
// crea.
//
// - **Tabella.** La prima riga ha i nomi delle serie, la prima colonna le categorie; le altre celle
//   sono numeri, e una cella vuota è un valore che manca. Una riga o una colonna si aggiunge e si
//   toglie in fondo. Un numero si scrive col punto o con la virgola.
// - **Porta.** `creaPortaDatiGrafico` legge i dati (`graph.setData` senza valori) e li manda come
//   testo CSV, con le etichette sempre fra virgolette: un'etichetta che sembra un numero resta
//   un'etichetta. Scambia righe e colonne e Scambia x e y partono insieme ai dati della tabella, che
//   il motore prende prima di scambiarli; poi la tabella si rilegge.
// - **Il grafico.** La finestra lavora sul grafico scelto quando si apre, anche se intanto la
//   selezione cambia; dopo ogni invio segue la selezione che il motore rende.
// - **Risposte vecchie.** Ogni lettura ha un numero: una risposta che non è più l'ultima si butta.
// - **Chiusura.** Chiudi, Esc e il fondo chiudono senza mandare ciò che non è stato applicato; la
//   finestra ha la sua vita, chiusa con lei e con il Completo.

import { openDialog } from "../../../kit/dialog";
import { formBody, formError, formNote } from "../../../kit/form";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { motivoDelRifiuto } from "../motore/rifiuto";
import { t } from "../strings";
import { applicaEsito, chiama, chiamaConArgomenti, type DipendenzeComando } from "./esegui";

/// I dati di un grafico: i nomi delle serie, le categorie, e una riga di valori per categoria
/// (`null` è un valore che manca).
export interface DatiGrafico {
  readonly serie: readonly string[];
  readonly categorie: readonly string[];
  readonly righe: readonly (readonly (number | null)[])[];
}

/// Il tetto di righe e colonne della tabella (VectorCraft: `MAX_GRAPH_CATEGORIES`, `MAX_GRAPH_SERIES`).
export const MAX_RIGHE = 10_000;
export const MAX_COLONNE = 256;

/// I dati dalla lettura di `graph.setData`; `null` se non si legge.
export function datiDi(lettura: unknown): DatiGrafico | null {
  if (typeof lettura !== "object" || lettura === null) return null;
  const { series, categories, rows } = lettura as Record<string, unknown>;
  if (!Array.isArray(series) || !Array.isArray(categories) || !Array.isArray(rows)) return null;
  const testo = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    serie: series.map(testo),
    categorie: categories.map(testo),
    righe: rows.map((riga: unknown) => (Array.isArray(riga) ? riga.map((v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)) : [])),
  };
}

/// Un'etichetta del CSV: sempre fra virgolette, con le virgolette raddoppiate.
function etichetta(testo: string): string {
  return `"${testo.replaceAll('"', '""')}"`;
}

/// Il testo CSV dei dati, come lo legge `graph.setData` (`parse_csv` di VectorCraft): la riga dei nomi
/// delle serie con la prima cella vuota, poi una riga per categoria con la sua etichetta. Le colonne
/// sono tante quante la riga più larga o le serie.
export function csvDi(dati: DatiGrafico): string {
  const colonne = Math.max(dati.serie.length, ...dati.righe.map((r) => r.length), 0);
  const nomi = Array.from({ length: colonne }, (_, i) => etichetta(dati.serie[i] ?? ""));
  const righe = Math.max(dati.categorie.length, dati.righe.length);
  const corpo = Array.from({ length: righe }, (_, r) => {
    const valori = Array.from({ length: colonne }, (_, c) => {
      const v = dati.righe[r]?.[c] ?? null;
      return v === null ? "" : String(v);
    });
    return [etichetta(dati.categorie[r] ?? ""), ...valori].join(",");
  });
  return [["", ...nomi].join(","), ...corpo].join("\n");
}

/// Il numero scritto in una cella: vuoto è `null`, la virgola vale come il punto; `undefined` se non
/// è un numero.
export function numeroDi(testo: string): number | null | undefined {
  const pulito = testo.trim().replace(",", ".");
  if (pulito === "") return null;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(pulito)) return undefined;
  const n = Number(pulito);
  return Number.isFinite(n) ? n : undefined;
}

/// Il motore visto dalla finestra.
export interface PortaDatiGrafico {
  /// I dati e il tipo del grafico; `null` se non c'è un grafico scelto o il motore non risponde.
  leggi(): Promise<{ readonly dati: DatiGrafico; readonly tipo: string | null } | null>;
  /// Manda i dati (e gli scambi). `rifiuto` col perché a parole, o `null` se sono entrati; `null` se il
  /// motore non risponde.
  manda(valore: { readonly csv: string; readonly transpose?: true; readonly switchXY?: true }): Promise<{ readonly rifiuto: string | null } | null>;
}

/// La porta sul motore del Completo aperto: il grafico è quello scelto adesso, e resta quello.
export function creaPortaDatiGrafico(dipendenze: DipendenzeComando, etichettaPasso: string): PortaDatiGrafico {
  let scelti: readonly string[] = [...dipendenze.selezione()];
  const sulGrafico: DipendenzeComando = { ...dipendenze, selezione: () => scelti };
  return {
    async leggi() {
      const esito = await chiama(sulGrafico, "disegno.graph.setData", {}, false);
      if (esito === null || esito.refused !== null) return null;
      const dati = datiDi(esito.reading);
      if (dati === null) return null;
      const tipo = await chiama(sulGrafico, "disegno.graph.setType", {}, false);
      const letto = tipo === null || tipo.refused !== null ? null : (tipo.reading as { readonly type?: unknown } | null | undefined)?.type;
      return { dati, tipo: typeof letto === "string" ? letto : null };
    },
    async manda(valore) {
      const esito = await chiamaConArgomenti(sulGrafico, "disegno.graph.setData", valore, false);
      if (esito === null) return null;
      if ("kind" in esito) return { rifiuto: esito.message };
      if (esito.refused !== null) return { rifiuto: t(motivoDelRifiuto(esito.refused) ?? "draw.reason.engine_stopped") };
      if (esito.selection.length > 0) scelti = [...esito.selection];
      return applicaEsito(esito, etichettaPasso, dipendenze) ? { rifiuto: null } : { rifiuto: t("draw.reason.engine_stopped") };
    },
  };
}

/// La tabella che si modifica: testi delle celle, così una cella sbagliata resta com'è scritta.
interface Foglio {
  serie: string[];
  categorie: string[];
  celle: string[][];
}

function foglioDi(dati: DatiGrafico): Foglio {
  const colonne = Math.max(dati.serie.length, ...dati.righe.map((r) => r.length), 1);
  const righe = Math.max(dati.categorie.length, dati.righe.length, 1);
  return {
    serie: Array.from({ length: colonne }, (_, c) => dati.serie[c] ?? ""),
    categorie: Array.from({ length: righe }, (_, r) => dati.categorie[r] ?? ""),
    celle: Array.from({ length: righe }, (_, r) =>
      Array.from({ length: colonne }, (_, c) => {
        const v = dati.righe[r]?.[c] ?? null;
        return v === null ? "" : String(v);
      }),
    ),
  };
}

/// I dati del foglio, o la prima cella che non è un numero (riga e colonna da 1).
export function datiDelFoglio(foglio: Foglio): DatiGrafico | { readonly riga: number; readonly colonna: number } {
  const righe: (number | null)[][] = [];
  for (const [r, riga] of foglio.celle.entries()) {
    const valori: (number | null)[] = [];
    for (const [c, testo] of riga.entries()) {
      const n = numeroDi(testo);
      if (n === undefined) return { riga: r + 1, colonna: c + 1 };
      valori.push(n);
    }
    righe.push(valori);
  }
  return { serie: [...foglio.serie], categorie: [...foglio.categorie], righe };
}

/// Le parole della finestra: quelle della famiglia «grafici» (`dati:*`), o la chiave.
export type ParoleDati = (chiave: string, valori?: Readonly<Record<string, string>>) => string;

/// Apre la finestra. `vita` è quella del Completo: chiuso il disegno, la finestra si chiude da sola.
export function apriFinestraDatiGrafico(porta: PortaDatiGrafico, parola: ParoleDati, vita: Lifetime): void {
  const own = openLifetime();
  vita.add(() => own.close());

  let foglio: Foglio = { serie: [""], categorie: [""], celle: [[""]] };
  let tipo: string | null = null;
  let generazione = 0;
  let occupato = false;

  const tabella = document.createElement("table");
  tabella.className = "draw-graph-data-table";
  const scorre = document.createElement("div");
  scorre.className = "draw-graph-data-scroll";
  scorre.append(tabella);
  const info = formNote("", true);
  const errore = formError("");
  errore.hidden = true;

  const tasto = (azione: string, testo: string, fai: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "kit-button";
    b.dataset["action"] = azione;
    b.textContent = testo;
    b.addEventListener("click", fai);
    own.add(() => b.removeEventListener("click", fai));
    return b;
  };
  const dimmi = (testo: string | null): void => {
    errore.textContent = testo ?? "";
    errore.hidden = testo === null;
  };
  const dire = (testo: string): void => {
    info.textContent = testo;
    info.hidden = testo === "";
  };

  const cella = (valore: string, nome: string, cambia: (v: string) => void): HTMLTableCellElement => {
    const td = document.createElement("td");
    const campo = document.createElement("input");
    campo.type = "text";
    campo.className = "kit-form-input draw-graph-data-cell";
    campo.value = valore;
    campo.setAttribute("aria-label", nome);
    const suInput = (): void => {
      cambia(campo.value);
      dimmi(null);
    };
    campo.addEventListener("input", suInput);
    own.add(() => campo.removeEventListener("input", suInput));
    td.append(campo);
    return td;
  };

  const mostra = (): void => {
    tabella.replaceChildren();
    const testa = document.createElement("tr");
    testa.append(document.createElement("th"));
    foglio.serie.forEach((nome, c) => {
      testa.append(cella(nome, `${parola("dati:serie")} ${c + 1}`, (v) => (foglio.serie[c] = v)));
    });
    tabella.append(testa);
    foglio.categorie.forEach((nome, r) => {
      const tr = document.createElement("tr");
      tr.append(cella(nome, `${parola("dati:categoria")} ${r + 1}`, (v) => (foglio.categorie[r] = v)));
      foglio.celle[r]!.forEach((valore, c) => {
        tr.append(cella(valore, `${foglio.categorie[r] || `${parola("dati:categoria")} ${r + 1}`}, ${foglio.serie[c] || `${parola("dati:serie")} ${c + 1}`}`, (v) => (foglio.celle[r]![c] = v)));
      });
      tabella.append(tr);
    });
    aggiornaTasti();
  };

  const aggiungiRiga = (): void => {
    if (foglio.categorie.length >= MAX_RIGHE) return;
    foglio.categorie.push("");
    foglio.celle.push(foglio.serie.map(() => ""));
    mostra();
  };
  const togliRiga = (): void => {
    if (foglio.categorie.length <= 1) return;
    foglio.categorie.pop();
    foglio.celle.pop();
    mostra();
  };
  const aggiungiColonna = (): void => {
    if (foglio.serie.length >= MAX_COLONNE) return;
    foglio.serie.push("");
    for (const riga of foglio.celle) riga.push("");
    mostra();
  };
  const togliColonna = (): void => {
    if (foglio.serie.length <= 1) return;
    foglio.serie.pop();
    for (const riga of foglio.celle) riga.pop();
    mostra();
  };

  /// Legge il grafico: la risposta che non è più l'ultima si butta.
  const rileggi = async (): Promise<void> => {
    const mia = ++generazione;
    dire("");
    const letto = await porta.leggi();
    if (own.closed || mia !== generazione) return;
    if (letto === null) {
      dire(parola("dati:nessunGrafico"));
      aggiornaTasti();
      return;
    }
    foglio = foglioDi(letto.dati);
    tipo = letto.tipo;
    dimmi(null);
    mostra();
  };

  /// Manda il foglio, con uno scambio se c'è; poi rilegge. `true` se i dati sono entrati.
  const manda = async (scambio?: "transpose" | "switchXY"): Promise<boolean> => {
    const dati = datiDelFoglio(foglio);
    if (!("serie" in dati)) {
      dimmi(parola("dati:nonNumero", { riga: String(dati.riga), colonna: String(dati.colonna) }));
      return false;
    }
    occupato = true;
    aggiornaTasti();
    const esito = await porta.manda({ csv: csvDi(dati), ...(scambio === undefined ? {} : { [scambio]: true as const }) });
    occupato = false;
    if (own.closed) return false;
    if (esito === null || esito.rifiuto !== null) {
      dimmi(parola("dati:errore", { motivo: esito?.rifiuto ?? t("draw.reason.engine_stopped") }));
      aggiornaTasti();
      return false;
    }
    await rileggi();
    return true;
  };

  const piu = tasto("addRow", parola("dati:aggiungiRiga"), aggiungiRiga);
  const meno = tasto("removeRow", parola("dati:togliRiga"), togliRiga);
  const piuColonna = tasto("addColumn", parola("dati:aggiungiColonna"), aggiungiColonna);
  const menoColonna = tasto("removeColumn", parola("dati:togliColonna"), togliColonna);
  const trasponi = tasto("transpose", parola("dati:trasponi"), () => void manda("transpose"));
  const scambia = tasto("switchXY", parola("dati:scambiaXY"), () => void manda("switchXY"));
  const fila = document.createElement("div");
  fila.className = "draw-graph-data-tools";
  fila.append(piu, meno, piuColonna, menoColonna, trasponi, scambia);

  function aggiornaTasti(): void {
    piu.disabled = occupato || foglio.categorie.length >= MAX_RIGHE;
    meno.disabled = occupato || foglio.categorie.length <= 1;
    piuColonna.disabled = occupato || foglio.serie.length >= MAX_COLONNE;
    menoColonna.disabled = occupato || foglio.serie.length <= 1;
    trasponi.disabled = occupato || foglio.categorie.length > MAX_COLONNE;
    // Scambia x e y vale per la dispersione (VectorCraft: «Switch x/y is for scatter graphs»).
    scambia.disabled = occupato || tipo !== "scatter";
    const applica = finestra?.element.querySelector<HTMLButtonElement>('[data-action="apply"]');
    if (applica) applica.disabled = occupato;
  }

  const corpo = document.createElement("div");
  corpo.className = "draw-graph-data-body";
  corpo.append(fila, scorre, info, errore);

  let finestra: ReturnType<typeof openDialog<string>> | null = null;
  finestra = openDialog<string>({
    title: parola("dati:titolo"),
    body: formBody([formNote(parola("dati:descrizione")), corpo]),
    actions: [
      { id: "close", label: parola("dati:chiudi"), value: "chiudi" },
      { id: "revert", label: parola("dati:ripristina"), value: "ripristina" },
      { id: "apply", label: parola("dati:applica"), kind: "primary", value: "applica" },
    ],
    dismissValue: "chiudi",
    lifetime: own,
    className: "draw-graph-data-dialog",
    confirm: (valore) => {
      if (valore === "chiudi") return true;
      if (valore === "ripristina") {
        void rileggi();
        return false;
      }
      // Applica lascia la finestra aperta, come in VectorCraft: si continua a scrivere.
      void manda();
      return false;
    },
  });
  void finestra.result.then(() => own.close());
  aggiornaTasti();
  void rileggi();
}
