// La fila delle opzioni della Trasformazione libera nel Disegno completo (piano K6, T13), come
// il riquadro di VectorCraft (`crates/ui-egui/src/free_transform.rs`): **Vincola** sopra i tre
// modi dello strumento, Trasformazione libera, Distorsione prospettica e Distorsione libera.
// Le due opzioni sono dello strumento (`options` del motore: `mode` e `constrain`) e si
// cambiano con `disegno.strumento.opzione`, come la fila generica; questa fila serve perché
// `mode` è un testo, non una scelta che la fila generica sa disegnare.
//
// - Vincola vale solo nel modo libero: negli altri due la casella è spenta, come il pulsante
//   grigio di VectorCraft.
// - Un valore del motore uguale a quello mostrato non rifà i controlli, così il fuoco resta
//   sul pulsante appena premuto; un valore diverso (un altro strumento, un'altra finestra) li
//   rifà.

import type { DrawingToolState } from "../../../../../host/contract";
import { languageCurrent } from "../../../../../i18n/strings";
import { formCheck, formChoice } from "../../../../../kit/form";
import type { Lifetime } from "../../../../../ui/lifetime";
import type { AzioniFila, Etichette, FilaOpzioni } from "../../opzioni";

/// Lo strumento che ha questa fila.
export const STRUMENTO_LIBERA = "freeTransform";

/// I modi come li nomina l'opzione `mode` del motore, nell'ordine di VectorCraft.
export const MODI_LIBERA = ["free", "perspective", "distort"] as const;
export type ModoLibera = (typeof MODI_LIBERA)[number];

/// Le opzioni lette dallo stato: un modo che il motore non nomina vale «free», come in
/// `FreeTransformTool::set_option`; `constrain` che manca vale `false`.
export function opzioniLibera(opzioni: unknown): { readonly modo: ModoLibera; readonly vincola: boolean } {
  const o = opzioni !== null && typeof opzioni === "object" ? (opzioni as Record<string, unknown>) : {};
  const modo = MODI_LIBERA.find((m) => m === o["mode"]) ?? "free";
  return { modo, vincola: o["constrain"] === true };
}

function parola(testi: Etichette, chiave: string): string {
  const e = testi[chiave];
  if (e === undefined) return chiave;
  return languageCurrent().startsWith("en") ? e.en : e.it;
}

export function filaLibera(testi: Etichette, stato: DrawingToolState | null, azioni: AzioniFila, vita: Lifetime): FilaOpzioni | null {
  if (vita.closed) return null;
  const element = document.createElement("div");
  element.className = "draw-options-row";
  const gruppo = (chiave: string): HTMLDivElement => {
    const el = document.createElement("div");
    el.className = "draw-group kit-bar-group";
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", parola(testi, chiave));
    return el;
  };
  const vincolaBox = gruppo("libera.vincola");
  const modoBox = gruppo("libera.modo");
  element.append(vincolaBox, modoBox);

  let mostrato = opzioniLibera(stato?.options ?? null);
  const disegna = (): void => {
    const casella = formCheck({
      label: parola(testi, "libera.vincola"),
      checked: mostrato.vincola,
      onChange: (acceso) => {
        mostrato = { ...mostrato, vincola: acceso };
        azioni.opzione("constrain", acceso);
      },
      lifetime: vita,
    });
    const input = casella.element.querySelector("input");
    if (input !== null) input.disabled = mostrato.modo !== "free";
    const scelta = formChoice({
      label: parola(testi, "libera.modo"),
      choices: MODI_LIBERA.map((m) => ({ value: m, label: parola(testi, `libera.modo.${m}`) })),
      value: mostrato.modo,
      onChange: (valore) => {
        const modo = MODI_LIBERA.find((m) => m === valore) ?? "free";
        if (modo === mostrato.modo) return;
        mostrato = { ...mostrato, modo };
        if (input !== null) input.disabled = modo !== "free";
        azioni.opzione("mode", modo);
      },
      lifetime: vita,
    });
    vincolaBox.replaceChildren(casella.element);
    modoBox.replaceChildren(scelta.element);
  };
  disegna();

  return {
    element,
    voci: [
      { element: vincolaBox, priorita: 1 },
      { element: modoBox, priorita: 2 },
    ],
    aggiorna(opzioni) {
      if (vita.closed) return false;
      const letto = opzioniLibera(opzioni);
      if (letto.modo !== mostrato.modo || letto.vincola !== mostrato.vincola) {
        mostrato = letto;
        disegna();
      }
      return true;
    },
  };
}
