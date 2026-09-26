// Le view che un riquadro può ospitare: quelle che dichiarano l'area principale.
//
// `views.ts` le scopre dal backend e le scrive qui. Chi le elenca (la palette)
// o le apre (gli intenti, la rail, il menu Vista) le legge da qui, senza
// portarsi dietro il DOM delle superfici che `views.ts` tocca appena importato.
import type { ViewSpec } from "../host/contract";
import { t } from "../i18n/strings";
import { layout, openViewIn } from "../state/layout";
import { notify } from "./notify";

const specs = new Map<string, ViewSpec>();

/// Sostituisce l'elenco, nell'ordine dato: è l'esito di un giro di discovery.
export function setPrimaryViews(next: readonly ViewSpec[]): void {
  specs.clear();
  for (const spec of next) specs.set(spec.id, spec);
}

/// Le view che un riquadro può ospitare, in ordine di dichiarazione.
export function primaryViews(): ViewSpec[] {
  return [...specs.values()];
}

export function primaryView(id: string): ViewSpec | undefined {
  return specs.get(id);
}

/// Si apre senza argomenti: nessuno dei suoi parametri è obbligatorio.
export function opensWithoutParams(spec: ViewSpec): boolean {
  return spec.params.every((param) => !param.required);
}

/// Un'istanza di una view principale nel riquadro col fuoco. È la stessa via
/// per ogni gesto che apre una view dell'area principale — un `OpenView` di un
/// comando, la palette, la rail, il menu — quindi nessuna view ha un posto
/// riservato. Una view che non è (più) dichiarata lo si dice invece di aprire
/// una linguetta che chiede al kernel qualcosa che non c'è. Gli argomenti li
/// convalida il kernel al disegno, contro i `ParamSpec` della view.
export function openPrimaryView(view: string, params: unknown = null): void {
  if (!specs.has(view)) {
    notify(t("views.open_unavailable", { view }), "guasto");
    return;
  }
  openViewIn(layout.focus, view, layout, params);
}
