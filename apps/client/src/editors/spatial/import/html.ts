// Il testo HTML delle etichette di draw.io (`html=1`): i paragrafi e i pezzi
// col loro aspetto, per il testo di FubDraw (`diagram.ts`).
//
// - **Gli a capo** sono quelli che il browser disegna: `br`, e il bordo di un
//   blocco (`div`, `p`, `li`, una riga di tabella) fra due righe scritte. Gli
//   spazi si riducono come in HTML; quelli non divisibili restano.
// - **L'aspetto** che FubDraw tiene: grassetto, corsivo, sottolineato,
//   barrato, colore, corpo e carattere, da `b`, `i`, `u`, `s`, `font` e dallo
//   stile in linea; i titoli (`h1`…`h6`) diventano grassetto e più grandi.
// - **Il resto** perde l'aspetto e tiene il testo: un elenco ha i suoi punti
//   o i suoi numeri scritti, una tabella le celle separate da spazi, e la nota
//   dice ciò che non entra: un'immagine, un apice, uno sfondo; un
//   collegamento resta blu e sottolineato, e ha la sua nota.
// - **Le righe orizzontali** (`hr`) prendono il posto di una riga vuota, e
//   la passano a metà.
// - **Il testo che non si vede** (nascosto, o di corpo zero) non entra.
//
// Il testo non diventa mai un documento: si legge a pezzi, come una stringa.

import { hexColor, type Notes, type Rule, type Run, type Type } from "./diagram";

/// Il carattere di un pezzo, rispetto a quello del testo intero.
type Look = Partial<Type>;

/// Ciò che un tag aperto cambia, e l'elenco che apre.
interface Open {
  readonly tag: string;
  readonly look: Look;
  readonly list: { readonly ordered: boolean; next: number } | null;
  /// Vero se il suo testo non si vede: `display: none`, `visibility:
  /// hidden`, o un corpo di zero.
  readonly hidden: boolean;
}

/// I tag che non si chiudono.
const VOID: ReadonlySet<string> = new Set(["br", "img", "hr", "input", "wbr", "meta", "link", "col", "area", "source"]);

/// I tag di blocco: il loro bordo va a capo.
const BLOCK: ReadonlySet<string> = new Set([
  "div", "p", "li", "ul", "ol", "dl", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "table", "tr", "thead", "tbody", "tfoot",
  "section", "article", "header", "footer", "hr", "center", "address", "figure", "figcaption", "caption",
]);

/// Il corpo dei titoli, in volte quello del testo.
const HEADING: Readonly<Record<string, number>> = { h1: 2, h2: 1.5, h3: 1.17, h4: 1, h5: 0.83, h6: 0.67 };

/// Il corpo di `<font size>` da 1 a 7, in pixel.
const FONT_SIZE = [10, 13, 16, 18, 24, 32, 48];

/// Le entità che le etichette scrivono davvero; le altre restano come sono.
const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  times: "×",
  divide: "÷",
  plusmn: "±",
  larr: "←",
  rarr: "→",
  uarr: "↑",
  darr: "↓",
  harr: "↔",
  euro: "€",
};

/// `text` coi riferimenti a carattere risolti.
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/// Gli attributi di un tag, coi nomi minuscoli.
export function attributesOf(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (let match = pattern.exec(raw); match !== null; match = pattern.exec(raw)) {
    out.set(match[1]!.toLowerCase(), decodeEntities(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return out;
}

/// Le dichiarazioni di uno stile in linea, coi nomi minuscoli.
export function declarationsOf(style: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of style.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    out.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim().replace(/\s*!important$/i, ""));
  }
  return out;
}

/// Il corpo di un `font-size` CSS, in pixel, rispetto a `base`; `null` se
/// non si legge.
export function cssSize(value: string, base: number): number | null {
  const match = /^([0-9]*\.?[0-9]+)(px|pt|em|rem|%)?$/i.exec(value.trim());
  if (match === null) return null;
  const n = Number(match[1]);
  switch ((match[2] ?? "px").toLowerCase()) {
    case "pt":
      return (n * 4) / 3;
    case "em":
    case "rem":
      return n * base;
    case "%":
      return (n / 100) * base;
    default:
      return n;
  }
}

/// Il colore di una riga orizzontale nel browser, se lo stile non lo dice.
const RULE_COLOR = "#808080";

/// Il testo di un'etichetta HTML di draw.io, in paragrafi di pezzi, e le sue
/// righe orizzontali. `base` è il carattere dell'etichetta intera; `family`
/// dà la famiglia di FubDraw per un `font-family` o un `face`.
export function htmlParagraphs(html: string, base: Type, family: (name: string) => string, notes: Notes): { paragraphs: Run[][]; rules: Rule[] } {
  const paragraphs: Run[][] = [];
  const rules: Rule[] = [];
  let current: Run[] = [];
  const stack: Open[] = [];
  /// Il carattere di adesso, sopra quello dell'etichetta.
  const look = (): Look => Object.assign({}, ...stack.map((open) => open.look)) as Look;
  const sizeNow = (): number => look().size ?? base.size;
  /// Vero se prima del prossimo testo c'era uno spazio da tenere.
  let pendingSpace = false;
  /// Vero dentro un tag che non si vede.
  const hidden = (): boolean => stack.some((open) => open.hidden);

  const breakLine = (hard: boolean): void => {
    if (hard || current.some((run) => run.text !== "")) {
      paragraphs.push(trimmed(current));
      current = [];
    }
    pendingSpace = false;
  };
  const write = (text: string): void => {
    if (hidden()) return;
    // Gli spazi di HTML si riducono a uno; quelli in testa a una riga cadono.
    let out = "";
    const started = (): boolean => current.length > 0 || out !== "";
    text.split(/[ \t\n\r\f]+/).forEach((piece, i) => {
      if (i > 0) pendingSpace = pendingSpace || started();
      if (piece === "") return;
      if (pendingSpace && started()) out += " ";
      out += piece;
      pendingSpace = false;
    });
    if (out === "") return;
    const kind = look();
    const type = Object.keys(kind).length === 0 ? null : kind;
    const last = current[current.length - 1];
    if (last !== undefined && sameLook(last.type, type)) current[current.length - 1] = { text: last.text + out, type: last.type };
    else current.push({ text: out, type });
  };

  const pattern = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|</g;
  for (let match = pattern.exec(html); match !== null; match = pattern.exec(html)) {
    if (match[4] !== undefined) {
      write(decodeEntities(match[4]));
      continue;
    }
    if (match[2] === undefined) {
      if (match[0] === "<") write("<");
      continue;
    }
    const tag = match[2].toLowerCase();
    const closing = match[1] === "/";
    if (closing) {
      const at = stack.map((open) => open.tag).lastIndexOf(tag);
      const inside = hidden();
      if (at >= 0) stack.splice(at);
      if (inside) continue;
      if (BLOCK.has(tag)) breakLine(false);
      else if (tag === "td" || tag === "th") write(" ");
      continue;
    }
    if (tag === "br") {
      if (!hidden()) breakLine(true);
      continue;
    }
    const attributes = attributesOf(match[3] ?? "");
    const css = declarationsOf(attributes.get("style") ?? "");
    if (hidden() || unseenBy(css)) {
      if (!VOID.has(tag)) stack.push({ tag, look: {}, list: null, hidden: true });
      continue;
    }
    if (BLOCK.has(tag)) breakLine(false);
    if (tag === "img") {
      notes.add("html", "img");
      continue;
    }
    if (tag === "hr") {
      paragraphs.push([]);
      rules.push({ paragraph: paragraphs.length - 1, color: ruleColor(attributes, css), width: Math.min(8, Math.max(1, Number(attributes.get("size")) || 1)) });
      continue;
    }
    if (VOID.has(tag)) continue;
    const next: Record<string, string | number | boolean> = {};
    let list: Open["list"] = null;
    switch (tag) {
      case "b":
      case "strong":
        next.bold = true;
        break;
      case "i":
      case "em":
      case "cite":
      case "var":
        next.italic = true;
        break;
      case "u":
      case "ins":
        next.underline = true;
        break;
      case "s":
      case "strike":
      case "del":
        next.strike = true;
        break;
      case "code":
      case "tt":
      case "kbd":
      case "samp":
      case "pre":
        next.family = family("monospace");
        break;
      case "sup":
      case "sub":
      case "small":
      case "big":
      case "mark":
        notes.add("html", tag);
        break;
      case "a":
        // Un collegamento si vede come lo disegna il browser in draw.io.
        if (attributes.has("href")) {
          notes.add("link", attributes.get("href")!);
          next.underline = true;
          next.color = "#0000ee";
        }
        break;
      case "ul":
      case "ol":
        list = { ordered: tag === "ol", next: Number(attributes.get("start") ?? 1) || 1 };
        break;
      case "li": {
        const owner = [...stack].reverse().find((open) => open.list !== null)?.list ?? null;
        const mark = owner === null || !owner.ordered ? "•" : `${owner.next++}.`;
        stack.push({ tag, look: {}, list: null, hidden: false });
        write(`${mark} `);
        stack.pop();
        break;
      }
      case "font": {
        const color = hexColor(attributes.get("color"));
        if (color !== null) next.color = color;
        const size = Number(attributes.get("size"));
        if (Number.isInteger(size) && size >= 1 && size <= 7) next.size = FONT_SIZE[size - 1]!;
        const face = attributes.get("face");
        if (face !== undefined && face.trim() !== "") next.family = family(face);
        break;
      }
      default:
        if (tag in HEADING) {
          next.bold = true;
          next.size = HEADING[tag]! * sizeNow();
        }
    }
    if (css.size > 0) Object.assign(next, cssLook(css, sizeNow(), family, notes));
    stack.push({ tag, look: next as Look, list, hidden: false });
  }
  breakLine(false);
  if (paragraphs.length === 0) paragraphs.push([]);
  return { paragraphs, rules };
}

/// Il colore di una `hr`: quello del bordo o del testo, se lo dice; se no il
/// grigio del browser.
function ruleColor(attributes: ReadonlyMap<string, string>, css: ReadonlyMap<string, string>): string {
  for (const name of ["border-top-color", "border-color", "border-top", "border", "color"]) {
    const value = css.get(name);
    if (value === undefined) continue;
    const token = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b[a-z]+\b/gi;
    for (const each of value.match(token) ?? []) {
      const color = hexColor(each);
      if (color !== null) return color;
    }
  }
  return hexColor(attributes.get("color")) ?? RULE_COLOR;
}

/// Vero se uno stile in linea nasconde il suo testo: draw.io incolla così,
/// in un corpo di zero, il modello di ciò che si è copiato.
function unseenBy(css: ReadonlyMap<string, string>): boolean {
  if (css.get("display")?.toLowerCase() === "none") return true;
  if (css.get("visibility")?.toLowerCase() === "hidden") return true;
  const size = css.get("font-size");
  return size !== undefined && cssSize(size, 1) === 0;
}

/// Il carattere che uno stile in linea dà al suo testo.
function cssLook(css: ReadonlyMap<string, string>, size: number, family: (name: string) => string, notes: Notes): Look {
  const out: Record<string, string | number | boolean> = {};
  const weight = css.get("font-weight")?.toLowerCase();
  if (weight !== undefined) {
    const n = Number(weight);
    if (weight === "bold" || weight === "bolder" || (Number.isFinite(n) && n >= 600)) out.bold = true;
    else if (weight === "normal" || weight === "lighter" || (Number.isFinite(n) && n < 600)) out.bold = false;
  }
  const style = css.get("font-style")?.toLowerCase();
  if (style === "italic" || style === "oblique") out.italic = true;
  else if (style === "normal") out.italic = false;
  const decoration = (css.get("text-decoration-line") ?? css.get("text-decoration"))?.toLowerCase();
  if (decoration !== undefined) {
    if (decoration.includes("underline")) out.underline = true;
    if (decoration.includes("line-through")) out.strike = true;
    if (decoration.trim() === "none") {
      out.underline = false;
      out.strike = false;
    }
  }
  const color = hexColor(css.get("color"));
  if (color !== null) out.color = color;
  const fontSize = css.get("font-size");
  if (fontSize !== undefined) {
    const px = cssSize(fontSize, size);
    if (px !== null && px > 0) out.size = px;
  }
  const face = css.get("font-family");
  if (face !== undefined && face.trim() !== "" && face.trim().toLowerCase() !== "inherit") out.family = family(face);
  const background = (css.get("background-color") ?? css.get("background"))?.toLowerCase().trim();
  if (background !== undefined && background !== "" && background !== "none" && background !== "transparent" && background !== "initial" && background !== "inherit" && !/rgba\([^)]*,\s*0\s*\)/.test(background)) {
    notes.add("html", "background");
  }
  return out as Look;
}

/// Vero se due pezzi hanno lo stesso aspetto.
function sameLook(a: Look | null, b: Look | null): boolean {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]) as Set<keyof Type>;
  for (const key of keys) if ((a ?? {})[key] !== (b ?? {})[key]) return false;
  return true;
}

/// `runs` senza gli spazi in fondo alla riga, che HTML non disegna.
function trimmed(runs: readonly Run[]): Run[] {
  const out = [...runs];
  while (out.length > 0) {
    const last = out[out.length - 1]!;
    const text = last.text.replace(/[ \t]+$/, "");
    if (text === "") {
      out.pop();
      continue;
    }
    out[out.length - 1] = { text, type: last.type };
    break;
  }
  return out;
}
