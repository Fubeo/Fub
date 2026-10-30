// «Oggetto in tracciato» (livello Esperto): gli oggetti scelti diventano
// `path`, che i nodi sanno modificare. Il comando diventa un `batch` solo,
// come quelli di «Disponi».
//
// - **Ciò che si vede resta.** Rettangoli, ellissi, cerchi, linee, spezzate
//   e poligoni diventano il tracciato con cui SVG 2 li definisce: stesso
//   punto di partenza e stesso verso, così anche un tratteggio comincia dove
//   cominciava. Una freccia, un poligono regolare, una stella e una linea a
//   spessore variabile perdono `fub:shape` e `fub:geom`, un connettore anche
//   gli agganci, e non segue più gli oggetti; un tratto a penna l'inchiostro
//   e il pennello: resta il `d` che si vedeva.
// - **L'oggetto resta lui.** Stesso id, stesso posto fra i fratelli, stessi
//   attributi tranne la geometria che `d` sostituisce: colori, contorno,
//   trasformazione, titolo e gli attributi di altri programmi.
// - **Un gruppo o un collegamento** passano il comando alle parti. Un
//   blocco estraneo non è un oggetto: resta com'è, e non si conta.
// - **Testi e immagini** non hanno un tracciato, e nemmeno una forma che non
//   si disegna, come un rettangolo largo zero: restano come sono, e il
//   comando lo dice.

import { pathOf, scopeOf, type ElementPart } from "../scene/model";
import { elemToOut, type Elem } from "../scene/serialize";
import { Plan, type Arranged } from "./arrange";

/// «Oggetto in tracciato» pronto: le operazioni, quanti oggetti diventano
/// tracciati, e quanti non possono.
export interface Traced extends Arranged {
  readonly changed: number;
  readonly refused: number;
}

/// Mette `elem`, senza id, al posto di `node`: prende il suo id e il suo
/// posto fra i fratelli. `at` è il percorso di `node` quando le operazioni
/// arrivano, se quelle prima lo cambiano. Falso, senza operazioni, se `elem`
/// ha nomi che un'operazione non sa scrivere.
export function replaceElem(plan: Plan, node: ElementPart, elem: Elem, at: readonly number[] = pathOf(node)): boolean {
  // Un id che nessuno ha ancora, finché il vecchio elemento c'è; poi
  // l'elemento nuovo prende il suo, al suo posto.
  const id = plan.idOf(node);
  const stand: Elem = { ...elem, attrs: { ...elem.attrs, id: plan.ids.next("object") } };
  // Un'operazione non dichiara namespace: un attributo di un altro
  // programma col prefisso dichiarato sull'elemento stesso non si
  // riscrive, e l'elemento resta com'è.
  try {
    elemToOut(stand, scopeOf(node.parent!));
  } catch {
    return false;
  }
  plan.ops.push(
    { op: "add", parent: plan.parentOf(node), pos: { after: id }, elem: stand },
    { op: "remove", target: id },
    { op: "ident", path: at, tag: elem.tag, id: null },
    { op: "ident", path: at, tag: elem.tag, id },
  );
  return true;
}
