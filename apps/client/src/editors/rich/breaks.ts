// I nomi delle interruzioni, come i segni di formattazione di Word: un salto
// pagina o di colonna lo dice da sé (`schema.ts`); la fine di una sezione
// dice anche dove comincia quella dopo, che sta sulla sezione seguente.

import type { Node as PmNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { t, type Key } from "../../i18n/strings";
import type { Page, SectionStart } from "./projection";

const STARTS: Readonly<Record<SectionStart, Key>> = {
  next_page: "rich.break.next_page",
  continuous: "rich.break.continuous",
  even_page: "rich.break.even_page",
  odd_page: "rich.break.odd_page",
  next_column: "rich.break.next_column",
};

/// Il nome della fine di una sezione: «Fine sezione · pagina successiva».
/// Senza una pagina (un formato che non ne ha) dice soltanto la fine.
export function sectionName(next: Page | null): string {
  const end = t("rich.break.section");
  return next ? `${end} · ${t(STARTS[next.start ?? "next_page"])}` : end;
}

const sectionKey = new PluginKey<DecorationSet>("fub-rich-sections");

function names(doc: PmNode): DecorationSet {
  const ends: { pos: number; node: PmNode }[] = [];
  doc.forEach((node, pos) => {
    if (node.type.name === "section") ends.push({ pos, node });
  });
  if (ends.length === 0) return DecorationSet.empty;
  const out = ends.map(({ pos, node }, i) => {
    const next = (i + 1 < ends.length ? ends[i + 1]!.node.attrs.page : doc.attrs.page) as Page | null;
    const name = sectionName(next);
    return Decoration.node(pos, pos + node.nodeSize, { "data-name": name, "aria-label": name });
  });
  return DecorationSet.create(doc, out);
}

/// Ogni fine di sezione porta il suo nome, che cambia con la pagina della
/// sezione dopo.
export const sectionPlugin = new Plugin<DecorationSet>({
  key: sectionKey,
  state: {
    init: (_config, state) => names(state.doc),
    apply: (tr, set) => (tr.docChanged ? names(tr.doc) : set),
  },
  props: {
    decorations: (state) => sectionKey.getState(state),
  },
});
