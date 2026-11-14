// I nodi di primo livello che una modifica cambia. Chi ricava qualcosa dai
// nodi di primo livello (i ripiegabili, il posto della riga dei fatti) lo
// rifà soltanto per questi, e del resto tiene quello di prima: una battuta non
// scorre la nota. È la stessa regola della resa della Live (`render.ts`).
import { syntaxTree } from "@codemirror/language";
import type { Transaction } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";

/// I nodi nuovi dopo una modifica.
export interface TopChanges {
  /// Dove comincia il tratto riletto, uguale nei due alberi: prima di qui i
  /// nodi sono quelli di prima, nelle stesse posizioni.
  readonly start: number;
  /// I nodi dell'albero nuovo da `start` al primo che torna uguale, in ordine.
  readonly nodes: readonly SyntaxNode[];
  /// Dove l'albero nuovo torna uguale al vecchio, nelle posizioni del vecchio:
  /// da qui in poi i nodi sono quelli di prima spostati di `delta`. `null`
  /// quando il tratto arriva in fondo.
  readonly resync: number | null;
  readonly delta: number;
}

/// Quanti nodi nuovi si leggono prima che convenga rifare tutto.
const LIMIT = 256;

/// I nodi di primo livello che `tr` cambia: dal nodo prima di quello della
/// modifica (un testo che gli si attacca sotto lo allunga) al primo nodo dopo
/// la modifica che l'albero vecchio ha nello stesso punto, con lo stesso nome
/// e la stessa lunghezza. `null` quando uno dei due alberi non arriva in
/// fondo, quando `before` non è l'albero di partenza o il tratto è troppo
/// lungo: allora si rifà tutto.
export function topChanges(tr: Transaction, before: Tree): TopChanges | null {
  const tree = syntaxTree(tr.state);
  if (before !== syntaxTree(tr.startState) || before.length !== tr.startState.doc.length || tree.length !== tr.state.doc.length) {
    return null;
  }
  let fromB = Infinity;
  let toB = -1;
  tr.changes.iterChangedRanges((_fromA, _toA, from, to) => {
    fromB = Math.min(fromB, from);
    toB = Math.max(toB, to);
  });
  if (toB < 0) return null;
  // Dopo l'ultima modifica le posizioni scalano tutte di `delta`.
  const delta = tr.state.doc.length - tr.startState.doc.length;
  let node = tree.topNode.childBefore(fromB);
  if (node?.prevSibling) node = node.prevSibling;
  node ??= tree.topNode.firstChild;
  const start = node ? node.from : tr.state.doc.length;
  const nodes: SyntaxNode[] = [];
  for (; node; node = node.nextSibling) {
    if (node.from > toB) {
      const at = node.from - delta;
      const was = before.topNode.childAfter(at);
      if (was && was.from === at && was.name === node.name && was.to - was.from === node.to - node.from) {
        return { start, nodes, resync: at, delta };
      }
    }
    if (nodes.length >= LIMIT) return null;
    nodes.push(node);
  }
  return { start, nodes, resync: null, delta };
}
