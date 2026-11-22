// La fila delle opzioni del Contagocce nel Disegno completo (piano K6, T14, giro 7;
// `docs/architecture/disegno-completo.md`, «Il Contagocce»). Le sue opzioni non sono dello
// strumento: sono le preferenze del motore (`eyedropper.setOptions`, in `draw.motore`), e la
// fila le legge con `disegno.prefs.get` e le cambia con `disegno.eyedropper.setOptions`.
//
// - **Campione**: 1, 3 o 5 punti, la media dei pixel di un'immagine (`sampleSize`);
// - **Copia**: riempimento, contorno, opacità e testo. Ogni casella cambia lo stesso
//   ramo di «raccogli» e di «applica» (`pickUp` e `apply`): un bool vale per tutto il
//   ramo che nomina (`appearance.fill` sono colore, opacità e sovrastampa del riempimento).
//
// Le regole sono pure (`campioneDi`, `copiaDi`, i comandi): la fila le usa, e i test le
// provano senza il DOM. Una modifica non ricostruisce la fila: il fuoco resta dov'è. La
// lettura arrivata dopo il montaggio ricostruisce i controlli una volta sola.

import { formCheck, formChoice } from "../../../../../kit/form";
import type { Lifetime } from "../../../../../ui/lifetime";
import type { AzioniFila, FilaOpzioni } from "../../opzioni";
import { t } from "../../../strings";

/// Il comando che legge le preferenze del motore (`prefs.get`) e quello che le cambia.
export const COMANDO_PREFERENZE_LETTURA = "disegno.prefs.get";
export const COMANDO_OPZIONI_CONTAGOCCE = "disegno.eyedropper.setOptions";

/// Le scelte del campione: un numero di punti che il motore accetta, con la sua parola.
const CAMPIONI: readonly { readonly punti: number; readonly chiave: "draw.contagocce.punti.1" | "draw.contagocce.punti.3" | "draw.contagocce.punti.5" }[] = [
  { punti: 1, chiave: "draw.contagocce.punti.1" },
  { punti: 3, chiave: "draw.contagocce.punti.3" },
  { punti: 5, chiave: "draw.contagocce.punti.5" },
];

/// Che cosa copia: riempimento, contorno, opacità e testo, con la loro parola.
export type CopiaContagocce = "riempimento" | "contorno" | "opacita" | "testo";
const COPIE: readonly { readonly voce: CopiaContagocce; readonly chiave: "draw.contagocce.riempimento" | "draw.contagocce.contorno" | "draw.contagocce.opacita" | "draw.contagocce.testo" }[] = [
  { voce: "riempimento", chiave: "draw.contagocce.riempimento" },
  { voce: "contorno", chiave: "draw.contagocce.contorno" },
  { voce: "opacita", chiave: "draw.contagocce.opacita" },
  { voce: "testo", chiave: "draw.contagocce.testo" },
];

/// Le opzioni come le legge il motore: `sampleSize`, `pickUp` e `apply`. Un valore che manca o
/// non è quello atteso vale quello di serie del motore (campione di 1 punto, tutto copiato).
interface OpzioniLette {
  readonly sampleSize?: unknown;
  readonly pickUp?: unknown;
}

function oggetto(valore: unknown): Readonly<Record<string, unknown>> {
  return valore !== null && typeof valore === "object" && !Array.isArray(valore) ? (valore as Record<string, unknown>) : {};
}

/// Il campione acceso, come testo della scelta (`"1"`, `"3"` o `"5"`).
export function campioneDi(prefs: unknown): string {
  const n = (prefs as OpzioniLette | null)?.sampleSize;
  return n === 3 || n === 5 ? String(n) : "1";
}

/// Che cosa si copia, dal ramo che si raccoglie: una copia spenta è una chiave `false`.
export function copiaDi(prefs: unknown): Record<CopiaContagocce, boolean> {
  const raccolto = oggetto((prefs as OpzioniLette | null)?.pickUp);
  const aspetto = oggetto(raccolto.appearance);
  return {
    riempimento: oggetto(aspetto.fill).color !== false,
    contorno: oggetto(aspetto.stroke).color !== false,
    opacita: aspetto.transparency !== false,
    testo: raccolto.character !== false,
  };
}

/// Il valore di `disegno.eyedropper.setOptions` per il campione `punti`.
export function comandoDelCampione(punti: number): { readonly sampleSize: number } {
  return { sampleSize: punti };
}

/// Il valore di `disegno.eyedropper.setOptions` per una copia accesa o spenta: lo stesso
/// ramo in `pickUp` e in `apply`, così raccogliere e applicare dicono la stessa cosa.
export function comandoDellaCopia(copia: CopiaContagocce, acceso: boolean): unknown {
  const ramo =
    copia === "testo"
      ? { character: acceso, paragraph: acceso }
      : { appearance: copia === "opacita" ? { transparency: acceso } : { [copia === "riempimento" ? "fill" : "stroke"]: acceso } };
  return { pickUp: ramo, apply: ramo };
}

/// Il gruppo di una voce della fila: una scelta, o le caselle della copia. Ogni gruppo è una
/// voce della riga delle opzioni, con la sua priorità (come i pezzi dei punti scelti), così il
/// campione resta in vista quando la testata è stretta.
function gruppo(nome: string, classe: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `draw-group kit-bar-group ${classe}`.trim();
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", nome);
  return el;
}

/// Il contenuto dei due gruppi con le parole di adesso e le opzioni `prefs`.
function riempi(campioneBox: HTMLElement, coppiaBox: HTMLElement, prefs: unknown, cambia: (valore: unknown, etichetta: string) => void, vita: Lifetime): void {
  const campione = formChoice({
    label: t("draw.contagocce.campione"),
    choices: CAMPIONI.map((c) => ({ value: String(c.punti), label: t(c.chiave) })),
    value: campioneDi(prefs),
    onChange: (valore) => cambia(comandoDelCampione(Number(valore)), t("draw.contagocce.campione")),
    lifetime: vita,
  });
  const copia = copiaDi(prefs);
  // Una casella per voce, senza la riga del kit (che la allarga nella testata): la sua frase
  // sta nell'etichetta, così chi la sceglie clicca anche sulla parola.
  const caselle = COPIE.map(({ voce, chiave }) => {
    const casella = formCheck({
      label: t(chiave),
      checked: copia[voce],
      onChange: (acceso) => cambia(comandoDellaCopia(voce, acceso), t(chiave)),
      lifetime: vita,
    });
    return casella.element.querySelector<HTMLLabelElement>("label") ?? casella.element;
  });
  campioneBox.replaceChildren(campione.element);
  coppiaBox.replaceChildren(...caselle);
}

/// La fila delle opzioni del Contagocce: parte con le opzioni di serie, e quando il motore
/// dà quelle salvate (`prefs.get`) le mette nei controlli. `null` se la fila è già chiusa.
export function filaContagocce(azioni: AzioniFila, vita: Lifetime): FilaOpzioni | null {
  if (vita.closed) return null;
  const campioneBox = gruppo(t("draw.contagocce.campione"), "draw-contagocce-campione");
  const coppiaBox = gruppo(t("draw.contagocce.copia"), "draw-contagocce-copia");
  const element = document.createElement("div");
  element.className = "draw-options-row";
  let prefs: unknown = null;
  const cambia = (valore: unknown, etichetta: string): void => {
    azioni.esegui(COMANDO_OPZIONI_CONTAGOCCE, valore, `${t("draw.contagocce.opzione")}: ${etichetta}`);
  };
  const mostra = (): void => riempi(campioneBox, coppiaBox, prefs, cambia, vita);
  mostra();
  azioni.leggi(COMANDO_PREFERENZE_LETTURA, { key: "eyedropper" }).then(
    (letto) => {
      if (vita.closed || letto === null) return;
      prefs = letto;
      mostra();
    },
    () => undefined,
  );
  return {
    element,
    voci: [
      { element: campioneBox, priorita: 2 },
      { element: coppiaBox, priorita: 1 },
    ],
    aggiorna: () => true,
  };
}
