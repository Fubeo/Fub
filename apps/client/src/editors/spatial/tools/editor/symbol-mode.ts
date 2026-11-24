// «Modifica simbolo» ed «Esci dalla modalità modifica simbolo» del Disegno
// completo (`symbol.edit`, `symbol.exitEditing` di VectorCraft): sono la
// modifica di un simbolo di Fub, che apre il simbolo dove un'istanza sta,
// come un gruppo isolato, e cambia subito tutte le istanze
// (docs/product/drawing-symbols.md, «Modificare un simbolo»). Il motore non
// tiene uno stato fra le richieste, quindi la modalità è del client.

import { instanceSymbol } from "../symbols";
import { t } from "../../strings";
import type { EditorContext } from "./context";

/// Entra nel simbolo delle istanze scelte, da quella scelta per prima: tutte
/// dello stesso simbolo, come in VectorCraft. Senza un'istanza scelta, o con
/// istanze di simboli diversi, lo dice e non entra.
export function editSymbol(ctx: EditorContext): void {
  const model = ctx.engine.model;
  if (model === null) return;
  const instances = ctx.selectedUnits().filter((unit) => unit.role === "instance");
  const first = instances[0];
  if (first === undefined) {
    ctx.announce(t("draw.symbol.edit.none"));
    return;
  }
  const symbol = instanceSymbol(model, first.node)?.id ?? null;
  if (instances.some((unit) => (instanceSymbol(model, unit.node)?.id ?? null) !== symbol)) {
    ctx.announce(t("draw.symbol.edit.mixed"));
    return;
  }
  if (!ctx.isolate(first, null)) ctx.announce(t("draw.isolate.none"));
}

/// Esce dal simbolo che si modifica, anche da dentro un suo gruppo isolato:
/// l'isolamento torna com'era prima di entrare, e resta scelta l'istanza.
/// Fuori da un simbolo non fa niente, come in VectorCraft.
export function exitSymbol(ctx: EditorContext): void {
  const inside = (): boolean => (ctx.isolationSteps() ?? []).some((step) => step.node.details?.role === "symbol");
  while (inside()) if (!ctx.leaveIsolation(false)) return;
}
