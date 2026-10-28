// Le marche del carattere di Scrittura: l'enfasi (grassetto, corsivo,
// sottolineato, barrato, apice, pedice) e l'aspetto (carattere, misura,
// colore, evidenziatore). Le usa lo schema del documento
// (`editors/rich/schema.ts`), e i comandi di `look.ts` valgono per ogni
// schema che le monta. Il profilo a righe (`profiles/lines.ts`) usa gli
// stessi nomi (`b`, `i`, `u`, `s`, `font`, `size`, `color`), con marche sue
// che tengono il valore com'era scritto nel disegno.
//
// L'aspetto si scrive come variabile CSS (`--file-font`, `--file-size`,
// `--file-color`, `--file-hl`) e non come proprietà: chi monta lo schema
// decide se e come la pelle la usa (ADR 0222).
import type { MarkSpec } from "prosemirror-model";
import { fontStack } from "./fonts";

/// Un colore come lo scrivono le marche: `#rrggbb` minuscolo.
export function colorValue(value: string | null): string | null {
  if (!value) return null;
  const lower = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(lower) ? lower : null;
}

export interface WritingMarksOptions {
  /// Il colore dell'evidenziatore senza un colore scritto.
  readonly highlight: string;
  /// Il colore che vuol dire «quello di chi contiene il testo».
  readonly auto: string;
}

/// Le marche dell'enfasi e dell'aspetto, per uno schema.
export function writingMarks(options: WritingMarksOptions): Record<string, MarkSpec> {
  return {
    b: { parseDOM: [{ tag: "strong" }, { tag: "b" }, { style: "font-weight=bold" }], toDOM: () => ["strong", 0] },
    i: { parseDOM: [{ tag: "em" }, { tag: "i" }, { style: "font-style=italic" }], toDOM: () => ["em", 0] },
    u: { parseDOM: [{ tag: "u" }], toDOM: () => ["u", 0] },
    s: { parseDOM: [{ tag: "s" }, { tag: "del" }, { tag: "strike" }], toDOM: () => ["s", 0] },
    /// L'evidenziatore; `color` nullo è quello di serie.
    h: {
      attrs: { color: { default: null } },
      parseDOM: [{ tag: "mark", getAttrs: (dom) => ({ color: colorValue((dom as HTMLElement).getAttribute("data-rich-hl")) }) }],
      toDOM: (mark) => {
        const color = mark.attrs.color as string | null;
        return ["mark", { ...(color ? { "data-rich-hl": color } : {}), style: `--file-hl: ${color ?? options.highlight}` }, 0];
      },
    },
    sup: { excludes: "sup sub", parseDOM: [{ tag: "sup" }], toDOM: () => ["sup", 0] },
    sub: { excludes: "sup sub", parseDOM: [{ tag: "sub" }], toDOM: () => ["sub", 0] },
    font: {
      attrs: { family: {} },
      parseDOM: [{ tag: "span[data-rich-font]", getAttrs: (dom) => ({ family: (dom as HTMLElement).getAttribute("data-rich-font") }) }],
      toDOM: (mark) => {
        const family = mark.attrs.family as string;
        return ["span", { "data-rich-font": family, style: `--file-font: ${fontStack(family)}` }, 0];
      },
    },
    size: {
      attrs: { pt: {} },
      parseDOM: [
        {
          tag: "span[data-rich-size]",
          getAttrs: (dom) => {
            const pt = Number((dom as HTMLElement).getAttribute("data-rich-size"));
            return Number.isFinite(pt) && pt > 0 ? { pt } : false;
          },
        },
      ],
      toDOM: (mark) => {
        const pt = mark.attrs.pt as number;
        return ["span", { "data-rich-size": String(pt), style: `--file-size: ${pt}pt` }, 0];
      },
    },
    color: {
      attrs: { value: {} },
      parseDOM: [{ tag: "span[data-rich-color]", getAttrs: (dom) => ({ value: (dom as HTMLElement).getAttribute("data-rich-color") }) }],
      toDOM: (mark) => {
        const value = mark.attrs.value as string;
        const attrs: Record<string, string> = { "data-rich-color": value };
        if (value !== options.auto) attrs.style = `--file-color: ${value}`;
        return ["span", attrs, 0];
      },
    },
  };
}
