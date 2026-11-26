// «Cambia unità» (`document.switchUnits`, VectorCraft: Switch Units, Ctrl+Alt+Maiusc+U): l'unità
// del documento passa alla successiva (`nextUnit`). Il motore la dichiara, ma in Fub l'unità è
// `fub:units` sulla radice e la cambia il client, come il campo Unità della sezione Documento: un
// passo di Annulla e l'annuncio. Si chiama dal tasto e dalla ricerca dei comandi.
import { nextUnit } from "../../../scene/rulers";
import type { EditorContext } from "../context";

/// L'id della voce, quello della riga del motore.
export const CAMBIA_UNITA = "document.switchUnits";

/// Cambia l'unità e annuncia il perché se il disegno non l'accetta.
export function cambiaUnita(ctx: Pick<EditorContext, "changeField" | "scene" | "announce">): void {
  const failure = ctx.changeField("unit", nextUnit(ctx.scene.root.units));
  if (failure !== null) ctx.announce(failure);
}
