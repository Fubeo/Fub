// La fila delle opzioni dello strumento Oggetti sul tracciato nel Disegno completo, come le
// Opzioni dello strumento di VectorCraft (`vendor/vectorcraft/crates/tools/src/objects_on_path.rs`,
// `options`/`set_option`): **Perno**, il punto di ogni oggetto che si attacca al tracciato (nove
// quadratini, 4 è il centro), e **Rotazione**, l'angolo di ogni oggetto rispetto al tracciato (da
// −360° a 360°). Valgono per gli oggetti attaccati dopo: i gruppi già fatti tengono i loro (si
// cambiano dalla sezione del Design). Le due opzioni sono dello strumento (`options` del motore) e
// si cambiano con `disegno.strumento.opzione`; questa fila serve perché il perno è un punto di
// riferimento, non un numero.
//
// Un valore del motore uguale a quello mostrato non rifà i controlli, così il fuoco resta sul
// quadratino appena scelto; uno diverso li rifà.

import type { DrawingToolState } from "../../../../../host/contract";
import { numberField } from "../../../../../kit/number-field";
import { referencePoint } from "../../../../../kit/reference-point";
import type { Lifetime } from "../../../../../ui/lifetime";
import { problemaDelNumero, type AzioniFila, type FilaOpzioni } from "../../opzioni";
import { t, type DrawKey } from "../../../strings";

/// Lo strumento che ha questa fila.
export const STRUMENTO_OGGETTI_SUL_TRACCIATO = "objectsOnPath";

/// Le opzioni lette dallo stato, coi valori di serie di VectorCraft (il centro, dritti) dove
/// mancano o non sono quelli attesi.
export function opzioniOggettiSulTracciato(opzioni: unknown): { readonly perno: number; readonly rotazione: number } {
  const o = opzioni !== null && typeof opzioni === "object" ? (opzioni as Record<string, unknown>) : {};
  const p = o["pivot"];
  const r = o["rotate"];
  return {
    perno: typeof p === "number" && Number.isInteger(p) && p >= 0 && p <= 8 ? p : 4,
    rotazione: typeof r === "number" && Number.isFinite(r) ? r : 0,
  };
}

function gruppo(nome: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "draw-group kit-bar-group";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", nome);
  return el;
}

export function filaOggettiSulTracciato(stato: DrawingToolState | null, azioni: AzioniFila, vita: Lifetime): FilaOpzioni | null {
  if (vita.closed) return null;
  const element = document.createElement("div");
  element.className = "draw-options-row";
  const pernoBox = gruppo(t("draw.oggettiTracciato.perno"));
  const rotazioneBox = gruppo(t("draw.oggettiTracciato.rotazione"));
  element.append(pernoBox, rotazioneBox);

  let mostrato = opzioniOggettiSulTracciato(stato?.options ?? null);
  const disegna = (): void => {
    const etichetta = document.createElement("span");
    etichetta.className = "kit-number-label";
    etichetta.textContent = t("draw.oggettiTracciato.perno");
    const perno = referencePoint({
      label: t("draw.oggettiTracciato.perno"),
      pointLabels: Array.from({ length: 9 }, (_, i) => t(`draw.oggettiTracciato.punto.${i}` as DrawKey)),
      value: mostrato.perno,
      onChange: (valore) => {
        mostrato = { ...mostrato, perno: valore };
        azioni.opzione("pivot", valore);
      },
      lifetime: vita,
    });
    const rotazione = numberField({
      label: t("draw.oggettiTracciato.rotazione"),
      value: mostrato.rotazione,
      unit: "°",
      places: 2,
      min: -360,
      max: 360,
      step: 15,
      mixedText: "",
      problem: problemaDelNumero,
      onCommit: (valore) => {
        if (valore === mostrato.rotazione) return;
        mostrato = { ...mostrato, rotazione: valore };
        azioni.opzione("rotate", valore);
      },
      lifetime: vita,
    });
    pernoBox.replaceChildren(etichetta, perno.element);
    rotazioneBox.replaceChildren(rotazione.element);
  };
  disegna();

  return {
    element,
    voci: [
      { element: pernoBox, priorita: 2 },
      { element: rotazioneBox, priorita: 1 },
    ],
    aggiorna(opzioni) {
      if (vita.closed) return false;
      const letto = opzioniOggettiSulTracciato(opzioni);
      if (letto.perno !== mostrato.perno || letto.rotazione !== mostrato.rotazione) {
        mostrato = letto;
        disegna();
      }
      return true;
    },
  };
}
