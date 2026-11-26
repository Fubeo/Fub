// La fila delle opzioni degli strumenti dei simboli nel Disegno completo: lo Spruzzo e cinque
// strumenti Simbolismo di VectorCraft (Colorazione e Stile aspettano una scelta sul formato) (`vendor/vectorcraft/crates/tools/src/symbolism.rs`,
// `options`/`set_option`; `docs/product/drawing-symbols.md`). Le opzioni sono del motore e passano
// da `disegno.strumento.opzione`:
//
// - lo Spruzzo ha il **Simbolo** da spruzzare, il **Diametro** del pennello e la **Densità**
//   (quanto vicine le istanze nuove);
// - gli altri hanno il **Diametro** e l'**Intensità** (quanto cambia un passaggio).
//
// Il simbolo è il simbolo corrente del Completo (`SimboloCorrente`), lo stesso che si sceglie
// nella sezione «Simboli» di Risorse: sceglierlo qui lo cambia anche lì, e viceversa. Senza un
// simbolo corrente la fila prende il primo del documento. Le regole (`opzioniSimbolismo`) sono
// pure; la fila è DOM.

import type { DrawingToolState } from "../../../host/contract";
import { numberField } from "../../../kit/number-field";
import type { Lifetime } from "../../../ui/lifetime";
import { problemaDelNumero, type AzioniFila, type FilaOpzioni } from "./opzioni";
import { nomiDi, poniSimbolo, type SimboloCorrente } from "./simboli-sezione";
import { t } from "../strings";

/// Gli strumenti che hanno questa fila: lo Spruzzo per primo.
export const STRUMENTI_SIMBOLISMO = [
  "symbolSprayer",
  "symbolShifter",
  "symbolScruncher",
  "symbolSizer",
  "symbolSpinner",
  "symbolScreener",
] as const;

/// La lettura della lista dei simboli del documento.
export const COMANDO_LISTA_SIMBOLI = "disegno.symbol.list";

export interface OpzioniSimbolismo {
  readonly diametro: number;
  readonly intensita: number;
  readonly densita: number;
  readonly simbolo: string | null;
}

/// I valori di serie e i limiti di VectorCraft (`SymbolismTool::new`, `set_option`).
export const SIMBOLISMO_DI_SERIE: OpzioniSimbolismo = { diametro: 80, intensita: 5, densita: 5, simbolo: null };
const LIMITI = { diametro: [2, 2000], intensita: [1, 10], densita: [1, 10] } as const;

function nelLimite(v: unknown, [min, max]: readonly [number, number], altrimenti: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : altrimenti;
}

/// Le opzioni lette dallo stato dello strumento: ogni chiave che manca o è sbagliata vale quella di
/// serie, ogni numero sta nei limiti del motore.
export function opzioniSimbolismo(opzioni: unknown): OpzioniSimbolismo {
  const o = opzioni !== null && typeof opzioni === "object" && !Array.isArray(opzioni) ? (opzioni as Record<string, unknown>) : {};
  const s = o["symbol"];
  return {
    diametro: nelLimite(o["diameter"], LIMITI.diametro, SIMBOLISMO_DI_SERIE.diametro),
    intensita: nelLimite(o["intensity"], LIMITI.intensita, SIMBOLISMO_DI_SERIE.intensita),
    densita: nelLimite(o["density"], LIMITI.densita, SIMBOLISMO_DI_SERIE.densita),
    simbolo: typeof s === "string" && s !== "" ? s : null,
  };
}

function gruppo(nome: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "draw-group kit-bar-group";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", nome);
  return el;
}

/// La fila dello strumento `strumento`. `null` se la fila è già chiusa.
export function filaSimbolismo(
  strumento: string,
  corrente: SimboloCorrente,
  stato: DrawingToolState | null,
  azioni: AzioniFila,
  vita: Lifetime,
): FilaOpzioni | null {
  if (vita.closed) return null;
  const spruzzo = strumento === "symbolSprayer";
  const element = document.createElement("div");
  element.className = "draw-options-row";
  let opzioni = opzioniSimbolismo(stato?.options ?? null);
  const voci: { element: HTMLElement; priorita: number }[] = [];

  const campo = (chiave: "diameter" | "intensity" | "density", etichetta: string, valore: number, limiti: readonly [number, number], unita?: string): HTMLElement => {
    const box = gruppo(etichetta);
    const f = numberField({
      label: etichetta,
      value: valore,
      ...(unita === undefined ? {} : { unit: unita }),
      places: chiave === "diameter" ? 1 : 0,
      min: limiti[0],
      max: limiti[1],
      mixedText: "",
      problem: problemaDelNumero,
      onCommit: (v) => azioni.opzione(chiave, v),
      lifetime: vita,
    });
    box.append(f.element);
    return box;
  };

  if (spruzzo) {
    const box = gruppo(t("draw.simbolismo.simbolo"));
    const etichetta = document.createElement("label");
    etichetta.className = "kit-number-label";
    etichetta.textContent = t("draw.simbolismo.simbolo");
    const scelta = document.createElement("select");
    scelta.className = "draw-properties-input draw-simbolismo-simbolo";
    scelta.id = `draw-simbolismo-simbolo-${Math.random().toString(36).slice(2, 8)}`;
    etichetta.htmlFor = scelta.id;
    scelta.disabled = true;
    box.append(etichetta, scelta);
    voci.push({ element: box, priorita: 3 });

    /// Manda il simbolo al motore, se non è già quello dello strumento.
    const manda = (nome: string | null): void => {
      if (nome === null || nome === opzioni.simbolo) return;
      opzioni = { ...opzioni, simbolo: nome };
      azioni.opzione("symbol", nome);
    };
    const mostra = (nomi: readonly string[]): void => {
      scelta.replaceChildren();
      if (nomi.length === 0) {
        const vuota = document.createElement("option");
        vuota.value = "";
        vuota.textContent = t("draw.simbolismo.nessuno");
        scelta.append(vuota);
        scelta.disabled = true;
        scelta.title = t("draw.simbolismo.nessuno.perche");
        return;
      }
      for (const nome of nomi) {
        const voce = document.createElement("option");
        voce.value = nome;
        voce.textContent = nome;
        scelta.append(voce);
      }
      scelta.disabled = false;
      scelta.title = "";
      // Il simbolo corrente, se c'è ancora; altrimenti il primo del documento.
      const nome = corrente.nome !== null && nomi.includes(corrente.nome) ? corrente.nome : nomi[0]!;
      scelta.value = nome;
      poniSimbolo(corrente, nome);
      manda(nome);
    };
    scelta.addEventListener("change", () => {
      if (scelta.value === "") return;
      poniSimbolo(corrente, scelta.value);
    });
    // Il simbolo cambiato altrove (la sezione «Simboli») arriva qui e al motore.
    const ascolto = (nome: string | null): void => {
      if (nome === null || vita.closed) return;
      if ([...scelta.options].some((o) => o.value === nome)) scelta.value = nome;
      manda(nome);
    };
    corrente.ascolti?.add(ascolto);
    vita.add(() => corrente.ascolti?.delete(ascolto));
    void azioni.leggi(COMANDO_LISTA_SIMBOLI, {}).then(
      (letto) => {
        if (!vita.closed) mostra(nomiDi(letto, "symbols"));
      },
      () => undefined,
    );
    voci.push({ element: campo("diameter", t("draw.simbolismo.diametro"), opzioni.diametro, LIMITI.diametro, "pt"), priorita: 2 });
    voci.push({ element: campo("density", t("draw.simbolismo.densita"), opzioni.densita, LIMITI.densita), priorita: 1 });
  } else {
    voci.push({ element: campo("diameter", t("draw.simbolismo.diametro"), opzioni.diametro, LIMITI.diametro, "pt"), priorita: 2 });
    voci.push({ element: campo("intensity", t("draw.simbolismo.intensita"), opzioni.intensita, LIMITI.intensita), priorita: 1 });
  }
  element.append(...voci.map((v) => v.element));
  return {
    element,
    voci,
    aggiorna: (nuove) => {
      opzioni = opzioniSimbolismo(nuove);
      return true;
    },
  };
}
