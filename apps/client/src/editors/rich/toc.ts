// Il sommario di un documento: un paragrafo con il suo titolo (stile
// `TOCHeading`) che finisce con il campo del sommario, seguito da una voce
// per titolo (stili `TOC1`…`TOC9`), come lo scrive Word. Il campo nuovo è un
// oggetto con `toc`: il formato lo segna da rifare, e Word ne calcola le
// pagine aprendo il file.
import type { Node as PmNode } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { BODY, type Role } from "./projection";
import { richSchema } from "./schema";

const ENTRY = /^TOC[1-9]$/;

/// Il titolo del sommario che c'è già: un paragrafo `TOCHeading` con un campo.
function isHead(node: PmNode): boolean {
  if (node.type.name !== "para" || node.attrs.s !== "TOCHeading") return false;
  let field = false;
  node.forEach((child) => {
    if (child.type.name === "atom" && child.attrs.kind === "field") field = true;
  });
  return field;
}

/// I titoli del documento fino al livello `levels`, nel loro ordine.
export function headings(doc: PmNode, levels: number): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  doc.forEach((node) => {
    const role = node.attrs.role as Role | undefined;
    if (node.type.name !== "para" || role?.kind !== "heading" || role.level > levels) return;
    const text = node.textContent.trim();
    if (text) out.push({ level: role.level, text });
  });
  return out;
}

/// Mette il sommario dei titoli fino a `levels` prima del blocco del
/// cursore, o rifà quello che c'è già, con le voci di adesso.
export function insertToc(title: string, levels = 3): Command {
  return (state, dispatch) => {
    const doc = state.doc;
    const entries = headings(doc, levels);
    if (entries.length === 0) return false;
    let from = -1;
    let to = -1;
    let pos = 0;
    doc.forEach((node) => {
      if (from < 0 && isHead(node)) {
        from = pos;
        to = pos + node.nodeSize;
      } else if (from >= 0 && to === pos && node.type.name === "para" && ENTRY.test(String(node.attrs.s))) {
        to = pos + node.nodeSize;
      }
      pos += node.nodeSize;
    });
    if (from < 0) {
      from = to = state.selection.$from.before(1);
    }
    if (!dispatch) return true;
    const { para, atom } = richSchema.nodes;
    const field = atom.create({ kind: "field", toc: levels });
    const nodes = [
      para.create({ role: BODY, s: "TOCHeading" }, title ? [richSchema.text(title), field] : [field]),
      ...entries.map((entry) => para.create({ role: BODY, s: `TOC${entry.level}` }, richSchema.text(entry.text))),
    ];
    dispatch(state.tr.replaceWith(from, to, nodes).scrollIntoView());
    return true;
  };
}
