// I richiami delle note: 1, 2, 3 a piè di pagina, i, ii, iii in chiusura,
// nell'ordine del documento, come li stampa Word. Il numero non è nel file:
// lo dà la posizione, e si rifà a ogni battuta, anche per le note nuove.

import type { Node as PmNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { t } from "../../i18n/strings";

/// Un numero in cifre romane minuscole, come le note di chiusura di Word.
export function roman(n: number): string {
  const steps: readonly [number, string][] = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let out = "";
  for (const [value, digits] of steps) {
    for (; n >= value; n -= value) out += digits;
  }
  return out;
}

/// Il richiamo di ogni nota del documento, per posizione.
export function noteNumbers(doc: PmNode): Map<number, string> {
  const out = new Map<number, string>();
  let foot = 0;
  let end = 0;
  doc.descendants((node, pos) => {
    if (node.type.name !== "atom" || node.attrs.kind !== "note") return true;
    out.set(pos, node.attrs.end ? roman(++end) : String(++foot));
    return false;
  });
  return out;
}

const noteKey = new PluginKey<DecorationSet>("fub-rich-notes");

function calls(doc: PmNode): DecorationSet {
  const out: Decoration[] = [];
  for (const [pos, number] of noteNumbers(doc)) {
    const node = doc.nodeAt(pos)!;
    const name = t(node.attrs.end ? "rich.atom.endnote" : "rich.atom.footnote", { n: number });
    const note = node.attrs.note as string | null;
    const said = note ? `${name}: ${note}` : name;
    out.push(Decoration.node(pos, pos + node.nodeSize, { "data-number": number, "aria-label": said, title: said }));
  }
  return DecorationSet.create(doc, out);
}

/// Ogni nota porta il suo richiamo, e lo dice a chi la legge con la sintesi
/// vocale insieme al suo testo.
export const notePlugin = new Plugin<DecorationSet>({
  key: noteKey,
  state: {
    init: (_config, state) => calls(state.doc),
    apply: (tr, set) => (tr.docChanged ? calls(tr.doc) : set),
  },
  props: {
    decorations: (state) => noteKey.getState(state),
  },
});
