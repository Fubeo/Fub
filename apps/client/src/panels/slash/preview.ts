// Il disegno del blocco scelto, in fondo al «/»: una miniatura della sua forma
// (96 × 60, a tratti e fondi del tema), che cosa fa e come lo si scrive senza
// menu, con gli argomenti rapidi. Sopra una selezione dice il dopo. Tutto col
// DOM, senza toccare la nota.
//
// Le miniature sono quelle del prototipo dell'editor (`slThumb`), rifatte coi
// nodi SVG e con le classi della pelle al posto dei colori.
import type { SlashMenuEntry, SlashTransform } from "../../editors/core/editor-menu";
import { t, type Key } from "../../i18n/strings";
import { iconEl } from "../../ui/icons";
import { COLOR_ENTRY, markdownHint } from "./entries";

/// I colori della tavolozza, nell'ordine dei campioni del passo del colore.
export const PALETTE = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;

const NS = "http://www.w3.org/2000/svg";

/// Le tinte della miniatura, come le veste la pelle (`.slash-thumb-<tinta>`).
type Tint = "line" | "ink" | "accent" | "wash" | "tray" | "stroke" | "stroke-accent" | "text" | "check" | "formula";

type Attrs = Readonly<Record<string, string | number>>;

function node(tag: string, tint: Tint, attrs: Attrs, text?: string): SVGElement {
  const out = document.createElementNS(NS, tag);
  out.setAttribute("class", `slash-thumb-${tint}`);
  for (const [name, value] of Object.entries(attrs)) out.setAttribute(name, String(value));
  if (text !== undefined) out.textContent = text;
  return out;
}

type Shape = SVGElement[];

/// Un rettangolo pieno (le righe di testo sono alte 4).
const R = (x: number, y: number, width: number, height = 4, tint: Tint = "line", rx = 2): Shape =>
  [node("rect", tint, { x, y, width, height, rx })];
/// Righe di testo, una ogni 10 px.
const L = (x: number, y: number, widths: readonly number[]): Shape => widths.flatMap((width, i) => R(x, y + i * 10, width));
/// Un rettangolo a tratto.
const B = (x: number, y: number, width: number, height: number, tint: Tint = "stroke", rx = 3): Shape =>
  [node("rect", tint, { x, y, width, height, rx })];
const P = (d: string, tint: Tint = "stroke", extra: Attrs = {}): Shape => [node("path", tint, { d, ...extra })];
const C = (cx: number, cy: number, r: number, tint: Tint): Shape => [node("circle", tint, { cx, cy, r })];
/// La griglia di una tabella, con la testata `head`.
const G = (head: Tint): Shape => [...R(10.6, 10.6, 74.8, 12.4, head, 3.4), ...B(10, 10, 76, 40, "stroke", 4), ...P("M10 23h76M10 36.5h76M35 10v40M60 10v40")];

const TASK: Shape = [
  ...B(10, 13, 10, 10), ...R(26, 16, 54),
  ...R(10, 33, 10, 10, "accent", 3), ...P("M12.6 38.2l2 2 3.2-4", "check"), ...R(26, 36, 38),
];
const PARAGRAPH: Shape = L(10, 15, [76, 76, 48]);
const heading = (y: number, width: number, height: number, below: number): Shape => [...R(10, y, width, height, "ink", 3), ...L(10, below, [76, 58])];
const NOTE_LINK: Shape = [...R(10, 16, 22), ...R(36, 16, 30, 4, "accent"), ...P("M36 24h30", "stroke-accent", { "stroke-width": 1 }), ...R(70, 16, 16), ...L(10, 34, [76, 40])];

/// La forma di ogni blocco, per id. Un titolo da 4 a 6 è quella del 3.
const SHAPES: Readonly<Record<string, () => Shape>> = {
  "markdown.paragraph": () => PARAGRAPH,
  "markdown.heading.1": () => heading(12, 52, 10, 32),
  "markdown.heading.2": () => heading(14, 42, 8, 32),
  "markdown.heading.3": () => heading(15, 32, 6, 31),
  "markdown.quote": () => [...R(10, 12, 3, 36, "accent", 1.5), ...L(20, 16, [62, 66, 40])],
  "markdown.list.bullet": () => [16, 28, 40].flatMap((y, i) => [...C(13, y, 2, "ink"), ...R(22, y - 2, [60, 48, 56][i]!)]),
  "markdown.list.ordered": () => [1, 2, 3].flatMap((n, i) => [node("text", "text", { x: 10, y: 19 + i * 12 }, `${n}.`), ...R(22, 14 + i * 12, [60, 48, 56][i]!)]),
  "markdown.list.task": () => TASK,
  "markdown.callout": () => [...R(10, 12, 76, 36, "wash", 6), ...C(21, 23, 3.5, "accent"), ...R(30, 21, 36, 4, "ink"), ...R(18, 34, 58, 4, "ink")],
  "markdown.details": () => [...P("M12 15l4 4-4 4"), ...R(22, 17, 44, 4, "ink"), ...L(22, 30, [58, 42])],
  "markdown.columns": () => [...L(10, 15, [33, 33, 24]), ...L(53, 15, [33, 33, 18]), ...P("M48 11v38", "stroke", { "stroke-dasharray": "1 4" })],
  "markdown.table": () => G("line"),
  "markdown.rule": () => [...R(10, 15, 76), ...P("M10 30h76"), ...R(10, 41, 50)],
  "markdown.codeblock": () => [...R(10, 10, 76, 40, "tray", 5), ...R(17, 18, 14, 4, "accent"), ...R(35, 18, 30, 4, "ink"), ...R(23, 28, 40, 4, "ink"), ...R(23, 38, 12, 4, "accent"), ...R(39, 38, 24, 4, "ink")],
  "markdown.mathblock": () => [node("text", "formula", { x: 48, y: 36, "text-anchor": "middle" }, "a² + b² = c²")],
  "markdown.math": () => [node("text", "formula", { x: 48, y: 36, "text-anchor": "middle" }, "a² + b² = c²")],
  "markdown.diagram": () => [...B(10, 22, 24, 16, "stroke", 4), ...B(62, 22, 24, 16, "stroke", 4), ...P("M37 30h21M54 26l4 4-4 4", "stroke-accent")],
  "markdown.embed": () => [...R(10, 10, 76, 40, "wash", 5), ...R(10, 10, 3, 40, "accent", 1.5), ...R(20, 18, 36, 4, "ink"), ...R(20, 28, 58, 4, "ink"), ...R(20, 38, 44, 4, "ink")],
  "markdown.wikilink": () => NOTE_LINK,
  "markdown.link": () => NOTE_LINK,
  "markdown.linkcard": () => [
    ...B(10, 14, 76, 32, "stroke", 5), ...C(25, 30, 7, "stroke"), ...P("M18 30h14M25 23c-4 4-4 10 0 14M25 23c4 4 4 10 0 14"),
    ...R(39, 24, 40, 4, "ink"), ...R(39, 33, 28),
  ],
  "markdown.image": () => [...R(10, 10, 76, 40, "tray", 5), ...C(26, 22, 4, "accent"), ...P("M12 48l18-18 14 10 12-8 28 16z", "ink", { opacity: 0.5 })],
  "markdown.mention": () => [...R(10, 18, 22), ...R(36, 13, 42, 14, "wash", 7), ...C(44, 20, 3.5, "accent"), ...R(51, 18, 21, 4, "ink"), ...L(10, 36, [76])],
  "markdown.date": () => [...R(10, 18, 26), ...R(40, 13, 44, 14, "wash", 4), ...B(45, 16.5, 7, 7, "stroke-accent", 1.5), ...R(56, 18, 22, 4, "ink"), ...L(10, 36, [60])],
  // Le voci che il prototipo non disegna, nella stessa lingua.
  "markdown.toc": () => [...R(10, 12, 40, 4, "ink"), ...R(18, 22, 50), ...R(18, 32, 42), ...R(26, 42, 36)],
  "markdown.footnote": () => [...L(10, 15, [70, 52]), ...R(64, 33, 5, 5, "accent", 1), ...P("M10 44h30"), ...R(10, 48, 4, 2, "accent", 1)],
  "markdown.comment": () => [...L(10, 15, [76]), ...B(10, 26, 76, 16, "stroke", 4), ...R(16, 32, 48, 4, "ink")],
  "markdown.property.add": () => [...R(10, 14, 22), ...R(40, 14, 40, 4, "ink"), ...R(10, 26, 18), ...R(40, 26, 30, 4, "ink"), ...R(10, 38, 24), ...R(40, 38, 36, 4, "ink")],
  "markdown.underline": () => [...R(10, 20, 60, 4, "ink"), ...P("M10 30h60", "stroke-accent"), ...L(10, 40, [44])],
  [COLOR_ENTRY]: () => [...R(10, 14, 76, 12, "wash", 4), ...R(14, 18, 50, 4, "accent"), ...L(10, 34, [76, 52])],
};

/// La miniatura di una voce: la forma del blocco, o l'icona di un comando
/// che non mette niente nella nota.
export function thumbOf(entry: SlashMenuEntry): Element {
  const level = /^markdown\.heading\.([4-6])$/.exec(entry.id) ? "markdown.heading.3" : entry.id;
  const draw = SHAPES[level] ?? (/^markdown\.(color|background)\./.test(entry.id) ? SHAPES[COLOR_ENTRY] : undefined);
  if (!draw) {
    const figure = entry.icon ? iconEl(entry.icon) : null;
    if (figure) {
      const box = document.createElement("span");
      box.className = "slash-thumb-icon";
      box.append(figure);
      return box;
    }
  }
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 96 60");
  svg.setAttribute("aria-hidden", "true");
  svg.append(...(draw ?? (() => PARAGRAPH))());
  return svg;
}

/// Gli argomenti rapidi che la voce accetta dopo il «/» (`quick.ts`), da
/// mostrare: «/tab 3x4», «/h2», «/venerdì». `null` se non ne ha, o se in
/// questa lingua non si scrivono.
export function quickHintOf(id: string): string | null {
  const heading = /^markdown\.heading\.([1-6])$/.exec(id);
  if (heading) return `/h${heading[1]}`;
  const keys: Readonly<Record<string, Key>> = {
    "markdown.table": "slash.detail.args.table",
    "markdown.columns": "slash.detail.args.columns",
    "markdown.codeblock": "slash.detail.args.code",
    "markdown.callout": "slash.detail.args.callout",
    "markdown.date": "slash.detail.args.date",
  };
  const key = keys[id];
  const text = key ? t(key) : "";
  return text === "" ? null : text;
}

/// Il segno che spezza una frase del catalogo dove va il suo pezzo.
const MARK = "\u0001";

/// Una frase del catalogo, già scritta con `MARK` al posto del tasto, col
/// tasto disegnato: «Scrivendo [##]».
function withKey(sentence: string, keys: string): Node[] {
  const [before = "", after = ""] = sentence.split(MARK);
  const kbd = document.createElement("kbd");
  kbd.textContent = keys;
  return [document.createTextNode(before), kbd, document.createTextNode(after)].filter((part) => part.textContent !== "");
}

/// Che cosa fa la voce, con la sintassi fra apici inversi (le descrizioni di
/// `fub.formatting`: «in un riquadro `> [!note]`») scritta in monospazio, non
/// coi suoi apici.
export function descriptionOf(text: string): Node[] {
  return text.split(/`([^`]+)`/).flatMap((part, index): Node[] => {
    if (part === "") return [];
    if (index % 2 === 0) return [document.createTextNode(part)];
    const code = document.createElement("code");
    code.textContent = part;
    return [code];
  });
}

/// Come la si scrive senza menu: la sintassi Markdown (o la scorciatoia) e
/// gli argomenti rapidi, divisi da « · ». Sopra una selezione, il dopo.
export function syntaxOf(entry: SlashMenuEntry, transform?: SlashTransform): Node[] {
  if (transform) {
    const after = entry.action ? transform.after(entry.id) : null;
    const text = after === null ? t("slash.panel.after.command") : after.replace(/\s*\n\s*/g, " ⏎ ");
    return [document.createTextNode(t("slash.detail.after", { text }))];
  }
  const parts: Node[][] = [];
  const markdown = markdownHint(entry.id);
  if (markdown) parts.push(withKey(t("slash.detail.typing", { syntax: MARK }), markdown));
  else if (entry.hint) parts.push(withKey(t("slash.detail.chord", { keys: MARK }), entry.hint));
  const quick = entry.quick ? null : quickHintOf(entry.id);
  if (quick) parts.push(withKey(parts.length ? t("slash.detail.also", { quick: MARK }) : t("slash.detail.also.first", { quick: MARK }), quick));
  return parts.flatMap((part, index) => (index === 0 ? part : [document.createTextNode(" · "), ...part]));
}
