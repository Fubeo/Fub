// Lo schema ProseMirror della superficie ricca e le due conversioni con la
// proiezione: `toDoc` e `fromDoc`.
//
// Lo schema non inventa niente che la proiezione non porti:
//
// - un paragrafo ha `role` (ciò che chi scrive cambia), `k`, `align`, la
//   disposizione `p` e lo stile `s`; la
//   sezione che chiude non è un suo attributo ma un blocco `section` subito
//   dopo, visibile e cancellabile soltanto apposta: un attributo nascosto lo
//   porterebbe via un Backspace qualunque che unisce due paragrafi;
// - un tratto di testo ha la marca `run` con il suo `k`, l'enfasi (`b`, `i`,
//   …), l'aspetto (`font`, `size`, `color` e il colore di `h`) e il link; gli a-capo, i salti pagina e di colonna sono foglie `brk`
//   con le stesse marche, perché ProseMirror normalizza gli spazi che legge
//   dal DOM e un `\n` dentro un nodo di testo non sopravvivrebbe;
// - un oggetto è una foglia `atom` con il suo `k`, non modificabile dentro;
// - una tabella ha righe e celle, ciascuna col suo `k`.
//
// `fromDoc` riscrive il documento nella forma della proiezione; un blocco già
// scritto si ritrova nella cache per nodo (i nodi sono immutabili), così una
// battuta riscrive un paragrafo e non il documento.
import { t, type Key } from "../../i18n/strings";
import { Fragment, Schema, type Mark as PmMark, type Node as PmNode, type NodeSpec, type MarkSpec } from "prosemirror-model";
import {
  BODY,
  canonicalMarks,
  COLOR_AUTO,
  HIGHLIGHT_DEFAULT,
  MARKS,
  plainLayout,
  plainLook,
  writeBlock,
  type AtomKind,
  type Block,
  type Inline,
  type Layout,
  type Look,
  type Mark,
  type Para,
  type Projection,
  type Role,
} from "./projection";

/// I caratteri del testo di WordCraft che diventano una foglia `brk`.
export const BREAKS = ["\n", "\u000c", "\u000e"] as const;
export type BreakChar = (typeof BREAKS)[number];
const BREAK_SPLIT = /([\n\u000c\u000e])/;

/// Le specie di oggetto che occupano una storia del documento o ne segnano un
/// intervallo: due copie dello stesso non si scrivono (una nota mostrata due
/// volte, un segnalibro che comincia due volte).
export const UNIQUE_ATOMS: ReadonlySet<AtomKind> = new Set<AtomKind>(["note", "shape", "group", "marker"]);

function roleAttr(dom: HTMLElement): Role | null {
  const raw = dom.getAttribute("data-rich-role");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Role;
  } catch {
    return null;
  }
}

function baseAttr(dom: HTMLElement): Look | null {
  const raw = dom.getAttribute("data-rich-f");
  if (!raw) return null;
  try {
    return plainLook(JSON.parse(raw) as Look) ?? null;
  } catch {
    return null;
  }
}

function jsonAttr<T>(dom: HTMLElement, name: string): T | null {
  const raw = dom.getAttribute(name);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/// Lo stile in linea di una disposizione: lunghezze in punti, un multiplo
/// d'interlinea rispetto alla riga singola del tema.
export function layoutStyle(layout: Layout): string[] {
  const style: string[] = [];
  if (layout.left !== undefined) style.push(`margin-left: ${layout.left}pt`);
  if (layout.right !== undefined) style.push(`margin-right: ${layout.right}pt`);
  if (layout.first !== undefined) style.push(`text-indent: ${layout.first}pt`);
  if (layout.before !== undefined) style.push(`margin-top: ${layout.before}pt`);
  if (layout.after !== undefined) style.push(`margin-bottom: ${layout.after}pt`);
  const line = layout.line;
  if (line) {
    if ("multiple" in line) style.push(`line-height: calc(1.2 * ${line.multiple})`);
    else if ("at_least" in line) style.push(`line-height: max(1.2em, ${line.at_least}pt)`);
    else style.push(`line-height: ${line.exactly}pt`);
  }
  return style;
}

/// Un colore che la proiezione accetta: `#rrggbb` minuscolo.
export function colorValue(value: string | null): string | null {
  if (!value) return null;
  const lower = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(lower) ? lower : null;
}

function headingTag(level: number): string {
  return level <= 6 ? `h${level}` : "p";
}

const para: NodeSpec = {
  group: "block",
  content: "inline*",
  attrs: {
    role: { default: BODY },
    align: { default: null },
    k: { default: null },
    p: { default: null },
    s: { default: null },
    f: { default: null },
  },
  parseDOM: [
    {
      tag: "[data-rich-role]",
      getAttrs: (dom) => ({
        role: roleAttr(dom as HTMLElement) ?? BODY,
        k: (dom as HTMLElement).getAttribute("data-rich-k"),
        align: (dom as HTMLElement).getAttribute("data-rich-align"),
        p: jsonAttr<Layout>(dom as HTMLElement, "data-rich-p"),
        s: (dom as HTMLElement).getAttribute("data-rich-s"),
        f: baseAttr(dom as HTMLElement),
      }),
    },
    ...[1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { role: { kind: "heading", level } } })),
    { tag: "li", getAttrs: (dom) => ({ role: { kind: "list", ordered: (dom as HTMLElement).parentElement?.tagName === "OL", level: 0 } }) },
    { tag: "blockquote", attrs: { role: { kind: "quote" } } },
    { tag: "p" },
  ],
  toDOM(node) {
    const role = node.attrs.role as Role;
    const tag = role.kind === "heading" ? headingTag(role.level) : "p";
    const attrs: Record<string, string> = {
      class: `rich-para rich-${role.kind}`,
      "data-rich-role": JSON.stringify(role),
    };
    if (role.kind === "heading") {
      attrs["data-level"] = String(role.level);
      if (role.level > 6) {
        attrs.role = "heading";
        attrs["aria-level"] = String(role.level);
      }
    }
    if (role.kind === "list") {
      attrs["data-level"] = String(role.level);
      attrs["data-list"] = role.ordered ? "ordered" : "bullet";
    }
    if (node.attrs.k) attrs["data-rich-k"] = node.attrs.k as string;
    const style: string[] = [];
    if (node.attrs.align) {
      attrs["data-rich-align"] = node.attrs.align as string;
      style.push(`text-align: ${node.attrs.align as string}`);
    }
    const layout = node.attrs.p as Layout | null;
    if (layout) {
      attrs["data-rich-p"] = JSON.stringify(layout);
      style.push(...layoutStyle(layout));
    }
    // La dimensione del paragrafo non si disegna (la dà il tema), ma un tratto
    // di altra dimensione la misura rispetto a questa. Un paragrafo di corpo
    // con uno stile suo la disegna, rispetto a quella del documento.
    const base = node.attrs.f as Look | null;
    const named = node.attrs.s as string | null;
    if (named) attrs["data-rich-s"] = named;
    if (base) {
      attrs["data-rich-f"] = JSON.stringify(base);
      if (base.size !== undefined) style.push(`--rich-base-pt: ${base.size}`);
      if (named && role.kind === "body") {
        if (base.font !== undefined) style.push(`font-family: ${JSON.stringify(base.font)}, serif`);
        if (base.size !== undefined) style.push(`font-size: calc(1em * ${base.size} / var(--rich-doc-pt, ${base.size}))`);
      }
    }
    if (style.length > 0) attrs.style = style.join("; ");
    return [tag, attrs, 0];
  },
};

/// Il nome di ogni specie di oggetto, per chi legge con la sintesi vocale.
const ATOM_NAMES: Readonly<Record<AtomKind, Key>> = {
  image: "rich.atom.image",
  graphic: "rich.atom.graphic",
  shape: "rich.atom.shape",
  group: "rich.atom.group",
  field: "rich.atom.field",
  note: "rich.atom.note",
  equation: "rich.atom.equation",
  ruby: "rich.atom.ruby",
  opaque: "rich.atom.opaque",
  marker: "rich.atom.opaque",
};

/// Il segno di un oggetto senza etichetta.
const ATOM_GLYPHS: Readonly<Record<AtomKind, string>> = {
  image: "▣",
  graphic: "◇",
  shape: "◇",
  group: "◇",
  field: "{ }",
  note: "*",
  equation: "∑",
  ruby: "ア",
  opaque: "◆",
  marker: "",
};

const nodes: Record<string, NodeSpec> = {
  doc: { content: "(block | section)+" },
  para,
  /// La fine di una sezione: chiude il paragrafo prima di lei.
  section: {
    attrs: { sect: {} },
    atom: true,
    selectable: true,
    parseDOM: [{ tag: "hr[data-rich-sect]", getAttrs: (dom) => ({ sect: (dom as HTMLElement).getAttribute("data-rich-sect") }) }],
    toDOM: (node) => ["hr", { class: "rich-section", "data-rich-sect": node.attrs.sect as string }],
  },
  table: {
    group: "block",
    content: "row+",
    attrs: { k: {} },
    isolating: true,
    parseDOM: [{ tag: "table[data-rich-k]", getAttrs: (dom) => ({ k: (dom as HTMLElement).getAttribute("data-rich-k") }) }],
    toDOM: (node) => ["table", { class: "rich-table", "data-rich-k": node.attrs.k as string }, ["tbody", 0]],
  },
  // Riga e cella hanno un `k` che ProseMirror può lasciare vuoto quando ripara
  // una tabella (una selezione che taglia righe intere): lo riempie dai vicini
  // `fillTableKeys` (`commands.ts`), come fa Word con una riga inserita.
  row: {
    content: "cell+",
    attrs: { k: { default: null } },
    parseDOM: [{ tag: "tr[data-rich-k]", getAttrs: (dom) => ({ k: (dom as HTMLElement).getAttribute("data-rich-k") }) }],
    toDOM: (node) => ["tr", { "data-rich-k": node.attrs.k as string }, 0],
  },
  cell: {
    content: "(block | section)+",
    attrs: { k: { default: null } },
    isolating: true,
    parseDOM: [{ tag: "td[data-rich-k]", getAttrs: (dom) => ({ k: (dom as HTMLElement).getAttribute("data-rich-k") }) }],
    toDOM: (node) => ["td", { class: "rich-cell", "data-rich-k": node.attrs.k as string }, 0],
  },
  text: { group: "inline" },
  brk: {
    group: "inline",
    inline: true,
    attrs: { ch: { default: "\n" } },
    parseDOM: [
      {
        tag: "[data-rich-ch]",
        getAttrs: (dom) => {
          const ch = (dom as HTMLElement).getAttribute("data-rich-ch");
          return ch !== null && (BREAKS as readonly string[]).includes(ch) ? { ch } : false;
        },
      },
      { tag: "br" },
    ],
    toDOM(node) {
      const ch = node.attrs.ch as BreakChar;
      if (ch === "\n") return ["br", { "data-rich-ch": ch }];
      // Un salto pagina o di colonna: un filo a tutta riga, che va a capo e
      // lo dice.
      return ["span", { class: ch === "\u000c" ? "rich-break rich-break-page" : "rich-break rich-break-column", "data-rich-ch": ch }];
    },
  },
  atom: {
    group: "inline",
    inline: true,
    atom: true,
    attrs: { k: {}, kind: {}, label: { default: "" }, w: { default: null }, h: { default: null } },
    selectable: true,
    parseDOM: [
      {
        tag: "span[data-rich-atom]",
        getAttrs(dom) {
          const el = dom as HTMLElement;
          const number = (name: string) => {
            const value = el.getAttribute(name);
            return value === null ? null : Number(value);
          };
          return {
            k: el.getAttribute("data-rich-atom"),
            kind: el.getAttribute("data-kind"),
            label: el.getAttribute("data-label") ?? "",
            w: number("data-w"),
            h: number("data-h"),
          };
        },
      },
    ],
    toDOM(node) {
      const kind = node.attrs.kind as AtomKind;
      const attrs: Record<string, string> = {
        class: `rich-atom rich-atom-${kind}`,
        "data-rich-atom": node.attrs.k as string,
        "data-kind": kind,
        contenteditable: "false",
      };
      const label = node.attrs.label as string;
      if (label) attrs["data-label"] = label;
      const w = node.attrs.w as number | null;
      const h = node.attrs.h as number | null;
      if (w !== null) attrs["data-w"] = String(w);
      if (h !== null) attrs["data-h"] = String(h);
      if (w !== null && h !== null && (kind === "image" || kind === "graphic" || kind === "shape" || kind === "group")) {
        // Punti tipografici in pixel CSS, entro la colonna del testo.
        attrs.style = `width: ${Math.max(8, w * (4 / 3))}px; aspect-ratio: ${Math.max(w, 1)} / ${Math.max(h, 1)}`;
      }
      if (kind === "marker") return ["span", attrs];
      // Un oggetto si annuncia per specie (e per testo alternativo, se ne ha);
      // senza un'etichetta si vede un segno della sua specie.
      const name = t(ATOM_NAMES[kind]);
      attrs.role = "img";
      attrs["aria-label"] = label ? `${name}: ${label}` : name;
      attrs.title = attrs["aria-label"];
      return ["span", attrs, label || ATOM_GLYPHS[kind]];
    },
  },
};

const marks: Record<string, MarkSpec> = {
  link: {
    attrs: { href: {} },
    inclusive: false,
    parseDOM: [
      { tag: "a[data-rich-href]", getAttrs: (dom) => ({ href: (dom as HTMLElement).getAttribute("data-rich-href") }) },
      { tag: "a[href]", getAttrs: (dom) => ({ href: (dom as HTMLElement).getAttribute("href") }) },
    ],
    // Senza `href`: dentro la superficie un collegamento è testo del
    // documento, e un clic non porta la finestra altrove.
    toDOM: (mark) => ["a", { "data-rich-href": mark.attrs.href as string, title: mark.attrs.href as string, class: "rich-link" }, 0],
  },
  /// Le proprietà opache di un tratto. Una sola per volta (si escludono da sé).
  run: {
    attrs: { k: {} },
    parseDOM: [{ tag: "span[data-rich-run]", getAttrs: (dom) => ({ k: (dom as HTMLElement).getAttribute("data-rich-run") }) }],
    toDOM: (mark) => ["span", { "data-rich-run": mark.attrs.k as string }, 0],
  },
  b: { parseDOM: [{ tag: "strong" }, { tag: "b" }, { style: "font-weight=bold" }], toDOM: () => ["strong", 0] },
  i: { parseDOM: [{ tag: "em" }, { tag: "i" }, { style: "font-style=italic" }], toDOM: () => ["em", 0] },
  u: { parseDOM: [{ tag: "u" }], toDOM: () => ["u", 0] },
  s: { parseDOM: [{ tag: "s" }, { tag: "del" }, { tag: "strike" }], toDOM: () => ["s", 0] },
  /// L'evidenziatore; `color` nullo è il giallo.
  h: {
    attrs: { color: { default: null } },
    parseDOM: [{ tag: "mark", getAttrs: (dom) => ({ color: colorValue((dom as HTMLElement).getAttribute("data-rich-hl")) }) }],
    toDOM: (mark) => {
      const color = mark.attrs.color as string | null;
      return color ? ["mark", { "data-rich-hl": color, style: `background-color: ${color}` }, 0] : ["mark", 0];
    },
  },
  sup: { excludes: "sup sub", parseDOM: [{ tag: "sup" }], toDOM: () => ["sup", 0] },
  sub: { excludes: "sup sub", parseDOM: [{ tag: "sub" }], toDOM: () => ["sub", 0] },
  caps: {
    parseDOM: [{ tag: "span[data-rich-caps]" }],
    toDOM: () => ["span", { "data-rich-caps": "", style: "text-transform: uppercase" }, 0],
  },
  small_caps: {
    parseDOM: [{ tag: "span[data-rich-small-caps]" }],
    toDOM: () => ["span", { "data-rich-small-caps": "", style: "font-variant-caps: small-caps" }, 0],
  },
  /// L'aspetto dove differisce da quello del paragrafo: valori, non enfasi.
  font: {
    attrs: { family: {} },
    parseDOM: [{ tag: "span[data-rich-font]", getAttrs: (dom) => ({ family: (dom as HTMLElement).getAttribute("data-rich-font") }) }],
    toDOM: (mark) => {
      const family = mark.attrs.family as string;
      return ["span", { "data-rich-font": family, style: `font-family: ${JSON.stringify(family)}, serif` }, 0];
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
    // In proporzione al paragrafo, che il tema disegna alla sua misura.
    toDOM: (mark) => {
      const pt = mark.attrs.pt as number;
      return ["span", { "data-rich-size": String(pt), style: `font-size: calc(1em * ${pt} / var(--rich-base-pt, 11))` }, 0];
    },
  },
  color: {
    attrs: { value: {} },
    parseDOM: [{ tag: "span[data-rich-color]", getAttrs: (dom) => ({ value: (dom as HTMLElement).getAttribute("data-rich-color") }) }],
    toDOM: (mark) => {
      const value = mark.attrs.value as string;
      const attrs: Record<string, string> = { "data-rich-color": value };
      if (value !== COLOR_AUTO) attrs.style = `color: ${value}`;
      return ["span", attrs, 0];
    },
  },
};

export const richSchema = new Schema({ nodes, marks });

const EMPHASIS: readonly Mark[] = MARKS;

function marksOf(inline: { k?: string; m?: readonly Mark[]; href?: string; f?: Look }): PmMark[] {
  const out: PmMark[] = [];
  if (inline.href !== undefined) out.push(richSchema.marks.link.create({ href: inline.href }));
  if (inline.k !== undefined) out.push(richSchema.marks.run.create({ k: inline.k }));
  for (const mark of inline.m ?? []) {
    out.push(richSchema.marks[mark].create(mark === "h" ? { color: inline.f?.hl ?? null } : null));
  }
  const f = inline.f;
  if (f?.font !== undefined) out.push(richSchema.marks.font.create({ family: f.font }));
  if (f?.size !== undefined) out.push(richSchema.marks.size.create({ pt: f.size }));
  if (f?.color !== undefined) out.push(richSchema.marks.color.create({ value: f.color }));
  return out;
}

function inlineNodes(c: readonly Inline[]): PmNode[] {
  const out: PmNode[] = [];
  for (const inline of c) {
    if (inline.t === "atom") {
      out.push(
        richSchema.nodes.atom.create({
          k: inline.k,
          kind: inline.kind,
          label: inline.label ?? "",
          w: inline.w ?? null,
          h: inline.h ?? null,
        }),
      );
      continue;
    }
    const marks = marksOf(inline);
    for (const piece of inline.x.split(BREAK_SPLIT)) {
      if (piece === "") continue;
      if ((BREAKS as readonly string[]).includes(piece)) {
        out.push(richSchema.nodes.brk.create({ ch: piece }, null, marks));
      } else {
        out.push(richSchema.text(piece, marks));
      }
    }
  }
  return out;
}

function blockNodes(blocks: readonly Block[]): PmNode[] {
  const out: PmNode[] = [];
  for (const block of blocks) {
    if (block.t === "para") {
      out.push(
        richSchema.nodes.para.create(
          {
            role: block.role,
            align: block.align ?? null,
            k: block.k ?? null,
            p: block.p ?? null,
            s: block.s ?? null,
            f: block.f ?? null,
          },
          inlineNodes(block.c ?? []),
        ),
      );
      if (block.sect !== undefined) out.push(richSchema.nodes.section.create({ sect: block.sect }));
      continue;
    }
    const rows = block.rows.map((row) =>
      richSchema.nodes.row.create(
        { k: row.k },
        row.cells.map((cell) => {
          const content = blockNodes(cell.blocks);
          // Una cella vuota nella proiezione ha comunque un paragrafo in Word.
          return richSchema.nodes.cell.create({ k: cell.k }, content.length > 0 ? content : [richSchema.nodes.para.create()]);
        }),
      ),
    );
    out.push(richSchema.nodes.table.create({ k: block.k }, rows));
  }
  return out;
}

/// Il documento ProseMirror di una proiezione.
export function toDoc(projection: Projection): PmNode {
  const content = blockNodes(projection.blocks);
  return richSchema.nodes.doc.create(null, content.length > 0 ? content : [richSchema.nodes.para.create()]);
}

interface Segment {
  k?: string;
  m: Mark[];
  href?: string;
  f?: Look;
  x: string;
}

/// L'aspetto che le marche di un tratto dicono.
export function lookOf(marks: readonly PmMark[]): Look | undefined {
  let font: string | undefined;
  let size: number | undefined;
  let color: string | undefined;
  let hl: string | undefined;
  for (const mark of marks) {
    const name = mark.type.name;
    if (name === "font") font = mark.attrs.family as string;
    else if (name === "size") size = mark.attrs.pt as number;
    else if (name === "color") color = mark.attrs.value as string;
    else if (name === "h") hl = (mark.attrs.color as string | null) ?? undefined;
  }
  return plainLook({ font, size, color, hl: hl === HIGHLIGHT_DEFAULT ? undefined : hl });
}

function segmentOf(node: PmNode): Omit<Segment, "x"> {
  let k: string | undefined;
  let href: string | undefined;
  const m: Mark[] = [];
  for (const mark of node.marks) {
    const name = mark.type.name;
    if (name === "run") k = mark.attrs.k as string;
    else if (name === "link") href = mark.attrs.href as string;
    else if ((EMPHASIS as readonly string[]).includes(name)) m.push(name as Mark);
  }
  return { k, m: canonicalMarks(m), href, f: lookOf(node.marks) };
}

function sameLook(a: Look | undefined, b: Look | undefined): boolean {
  return a?.font === b?.font && a?.size === b?.size && a?.color === b?.color && a?.hl === b?.hl;
}

function sameSegment(a: Omit<Segment, "x">, b: Omit<Segment, "x">): boolean {
  return (
    a.k === b.k &&
    a.href === b.href &&
    sameLook(a.f, b.f) &&
    a.m.length === b.m.length &&
    a.m.every((mark, i) => mark === b.m[i])
  );
}

/// Il contenuto di un paragrafo nella forma della proiezione: tratti uguali
/// vicini si uniscono, come li scrive il documento.
export function inlinesOf(paragraph: PmNode): Inline[] {
  const out: Inline[] = [];
  let open: Segment | null = null;
  const close = () => {
    if (open && open.x !== "") {
      out.push({
        t: "text",
        x: open.x,
        ...(open.k !== undefined ? { k: open.k } : {}),
        ...(open.m.length > 0 ? { m: open.m } : {}),
        ...(open.href !== undefined ? { href: open.href } : {}),
        ...(open.f !== undefined ? { f: open.f } : {}),
      });
    }
    open = null;
  };
  paragraph.forEach((child) => {
    if (child.type.name === "atom") {
      close();
      const label = child.attrs.label as string;
      const w = child.attrs.w as number | null;
      const h = child.attrs.h as number | null;
      out.push({
        t: "atom",
        k: child.attrs.k as string,
        kind: child.attrs.kind as AtomKind,
        ...(label ? { label } : {}),
        ...(w !== null ? { w } : {}),
        ...(h !== null ? { h } : {}),
      });
      return;
    }
    const piece = child.isText ? child.text ?? "" : (child.attrs.ch as string);
    const segment = segmentOf(child);
    if (open && sameSegment(open, segment)) open.x += piece;
    else {
      close();
      open = { ...segment, x: piece };
    }
  });
  close();
  return out;
}

function paraOf(node: PmNode, sect: string | undefined): Para {
  const c = inlinesOf(node);
  const align = node.attrs.align as Para["align"] | null;
  const k = node.attrs.k as string | null;
  const p = plainLayout((node.attrs.p as Layout | null) ?? {});
  const s = node.attrs.s as string | null;
  const f = node.attrs.f as Look | null;
  return {
    t: "para",
    role: node.attrs.role as Role,
    ...(align ? { align } : {}),
    ...(k !== null ? { k } : {}),
    ...(sect !== undefined ? { sect } : {}),
    ...(p !== undefined ? { p } : {}),
    ...(s ? { s } : {}),
    ...(f !== null ? { f } : {}),
    ...(c.length > 0 ? { c } : {}),
  };
}

/// I blocchi della proiezione dentro `parent` (il documento o una cella).
/// Una sezione senza un paragrafo prima (in testa, dopo una tabella o
/// un'altra sezione) ne riceve uno vuoto: in Word la porta un segno di fine
/// paragrafo, e non si perde.
export function blocksOf(parent: PmNode): Block[] {
  const out: Block[] = [];
  const children: PmNode[] = [];
  parent.forEach((child) => children.push(child));
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child.type.name === "para") {
      const next = children[i + 1];
      const sect = next?.type.name === "section" ? (next.attrs.sect as string) : undefined;
      out.push(paraOf(child, sect));
      if (sect !== undefined) i += 1;
    } else if (child.type.name === "section") {
      out.push({ t: "para", role: BODY, sect: child.attrs.sect as string });
    } else if (child.type.name === "table") {
      out.push(tableOf(child));
    }
  }
  return out;
}

function tableOf(table: PmNode): Block {
  const rows: { k: string; cells: { k: string; blocks: Block[] }[] }[] = [];
  table.forEach((row) => {
    const cells: { k: string; blocks: Block[] }[] = [];
    row.forEach((cell) => cells.push({ k: cell.attrs.k as string, blocks: blocksOf(cell) }));
    rows.push({ k: row.attrs.k as string, cells });
  });
  return { t: "table", k: table.attrs.k as string, rows };
}

/// I blocchi del documento in JSON, uno per figlio del documento che porta un
/// blocco. La cache tiene il testo per nodo: un nodo non cambiato non si
/// riscrive. Un paragrafo seguito da una sezione dipende da lei, quindi si
/// scrive con la coppia come chiave sul paragrafo e la sezione insieme.
export class BlockWriter {
  readonly #cache = new WeakMap<PmNode, { readonly sect: PmNode | null; readonly json: string }>();

  write(doc: PmNode): string[] {
    const out: string[] = [];
    const children: PmNode[] = [];
    doc.forEach((child) => children.push(child));
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      const next = children[i + 1];
      const sect = child.type.name === "para" && next?.type.name === "section" ? next : null;
      const hit = this.#cache.get(child);
      if (hit && hit.sect === sect) {
        out.push(hit.json);
      } else {
        const blocks = blocksOf(richSchema.nodes.doc.create(null, Fragment.from(sect ? [child, sect] : [child])));
        const json = blocks.map(writeBlock).join(",");
        this.#cache.set(child, { sect, json });
        out.push(json);
      }
      if (sect) i += 1;
    }
    return out;
  }
}
