// L'editor del disegno: Visualizza › Mostra spazi vuoti della pittura dinamica (K6, come
// VectorCraft `view.livePaintGaps`). Acceso, e coi bordi visibili, sul foglio si vedono gli spazi
// dei gruppi della pittura dinamica scelti, quelli che `livePaint.info` elenca, ciascuno nel
// colore d'anteprima del suo gruppo. Gli spazi li trova il motore: si rileggono quando cambiano la
// scelta o il disegno, e una lettura vecchia non sostituisce mai una più nuova.

import type { OverlayHandle } from "../../painter/overlay";
import type { Point } from "../../scene/matrix";
import type { SceneEngine } from "../../scene/engine";
import type { EditorContext } from "./context";

export interface SpaziPitturaContext {
  /// I segni degli spazi vuoti da mettere sul foglio; vuoto se la voce è spenta o i bordi nascosti.
  /// Se la scelta o il disegno sono cambiati, chiede al motore gli spazi nuovi e rifà i segni.
  spaziPitturaHandles: () => OverlayHandle[];
}

/// Quanto aspettare il motore per una lettura, in millisecondi.
const ATTESA_MS = 2_000;
/// Al più tanti oggetti scelti si leggono: una scelta enorme non diventa mille letture.
const MASSIMO_SCELTI = 64;

/// Gli spazi di una lettura `livePaint.info`: i capi e il colore d'anteprima del gruppo.
export function spaziDellaLettura(lettura: unknown): OverlayHandle[] {
  if (typeof lettura !== "object" || lettura === null) return [];
  const { gaps, gapOptions } = lettura as { readonly gaps?: unknown; readonly gapOptions?: { readonly color?: unknown } };
  const colore = typeof gapOptions?.color === "string" && /^#[0-9a-f]{6}$/iu.test(gapOptions.color) ? gapOptions.color : "#ff4f4f";
  if (!Array.isArray(gaps)) return [];
  const punto = (p: unknown): Point | null =>
    Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [p[0] as number, p[1] as number] : null;
  return gaps.flatMap((gap): OverlayHandle[] => {
    if (!Array.isArray(gap) || gap.length !== 2) return [];
    const from = punto(gap[0]);
    const to = punto(gap[1]);
    return from === null || to === null ? [] : [{ kind: "gap", from, to, color: colore }];
  });
}

export function installSpaziPittura(ctx: EditorContext): void {
  let segni: OverlayHandle[] = [];
  /// La scelta e il disegno degli spazi che ci sono (o che si stanno leggendo).
  let scelta: string | null = null;
  let disegno: SceneEngine | null = null;
  /// Il giro di lettura: solo l'ultimo mette i suoi spazi.
  let giro = 0;

  const leggi = async (ids: readonly string[], questo: number): Promise<void> => {
    const motore = ctx.options.motore ?? null;
    const sessione = motore === null ? null : await motore.pronta(ATTESA_MS);
    if (sessione === null || ctx.owner.closed || questo !== giro) return;
    const trovati: OverlayHandle[] = [];
    for (const id of ids) {
      // Un guasto del motore lascia senza gli spazi di quel gruppo, non senza il disegno.
      const esito = await sessione.comando({ id: "livePaint.info", selection: [id], value: {} }).catch(() => null);
      if (ctx.owner.closed || questo !== giro) return;
      if (esito !== null && !("kind" in esito)) trovati.push(...spaziDellaLettura(esito.reading));
    }
    segni = trovati;
    ctx.showHandles();
  };

  ctx.spaziPitturaHandles = () => {
    if (ctx.grid.livePaintGaps !== true || ctx.grid.hideEdges === true || ctx.selection.length === 0) {
      // Spenta: niente da tenere; alla riaccensione si rilegge.
      if (scelta !== null) giro += 1;
      segni = [];
      scelta = null;
      disegno = null;
      return [];
    }
    const adesso = ctx.selection.slice(0, MASSIMO_SCELTI);
    const chiave = adesso.join("\n");
    if (chiave !== scelta || ctx.engine !== disegno) {
      scelta = chiave;
      disegno = ctx.engine;
      giro += 1;
      void leggi(adesso, giro);
    }
    return segni;
  };
}
