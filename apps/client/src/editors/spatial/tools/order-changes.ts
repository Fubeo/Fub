// Quali spostamenti in ordine cambierebbero qualcosa, senza scriverli.
//
// Il pannello spegne «Porta in primo piano» e le altre tre quando non
// farebbero niente, e deve saperlo a ogni modifica del disegno, con
// centinaia di oggetti scelti. Costruire le operazioni di ciascuno (un id,
// un percorso e una posizione per ogni oggetto che si sposta) per poi
// contarle costa molto più di guardare come stanno gli oggetti scelti fra i
// loro vicini: bastano due passate, una per genitore, per tutte e quattro.
//
// Il conto è lo stesso di `orderOps` (`arrange.ts`): l'ordine cambia se, e
// solo se, `orderOps` scrive almeno uno spostamento. Il test lo confronta
// con lei su ogni scelta di un disegno con livelli, gruppi e oggetti scelti
// in più genitori.

import type { Order } from "./arrange";
import type { SceneIndex, Unit } from "./hit";

/// Gli ordini che spostano qualcosa di `units`, scelti in `index`: ciascuno
/// resta fra i vicini del suo genitore, come per `orderOps`.
///
/// - **Portare avanti o in primo piano** cambia l'ordine se un oggetto
///   scelto ha sopra uno non scelto: subito sopra, per «Porta avanti», o
///   anche più in alto, per «Porta in primo piano».
/// - **Portare indietro o in fondo**, lo stesso, ma con uno non scelto
///   sotto.
export function orderChanges(index: SceneIndex, units: readonly Unit[]): ReadonlySet<Order> {
  const changes = new Set<Order>();
  if (units.length === 0) return changes;
  const chosen = new Set(units.map((unit) => unit.key));
  const seen = new Set<string>();
  for (const first of units) {
    const parent = first.path.slice(0, -1).join(".");
    if (seen.has(parent)) continue;
    seen.add(parent);
    // Dal basso in alto: chi viene prima sta sotto.
    let below: boolean | null = null;
    let anyChosen = false;
    let anyOther = false;
    for (const unit of index.siblings(first)) {
      const picked = chosen.has(unit.key);
      if (picked) {
        // Uno scelto con sotto uno che non lo è: può scendere di un posto,
        // e di quanti ne servono per andare in fondo.
        if (below === false) changes.add("backward");
        if (anyOther) changes.add("back");
      } else {
        // Uno non scelto con sotto uno scelto: quello sale di un posto, e
        // di quanti ne servono per arrivare in cima.
        if (below === true) changes.add("forward");
        if (anyChosen) changes.add("front");
      }
      below = picked;
      if (picked) anyChosen = true;
      else anyOther = true;
    }
    if (changes.size === 4) break;
  }
  return changes;
}
