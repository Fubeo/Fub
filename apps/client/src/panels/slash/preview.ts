// L'anteprima del «/»: un campione della voce scelta, nei caratteri della
// nota, e sotto come la si scrive senza menu. Sopra una selezione mostra il
// prima e il dopo. Tutto è disegnato col DOM, senza toccare la nota.
import type { SlashMenuEntry, SlashTransform } from "../../editors/core/editor-menu";
import { t } from "../../i18n/strings";
import { iconEl } from "../../ui/icons";
import { COLOR_ENTRY, markdownHint } from "./entries";
import { calloutLabel, longDay } from "./quick";

export interface PreviewContext {
  /// I titoli della pagina, per l'Indice.
  outline(): readonly { readonly level: number; readonly text: string }[];
  readonly transform?: SlashTransform;
  /// Il giorno di oggi, per la data d'esempio.
  readonly today: Date;
}

export interface Preview {
  /// Il campione, decorativo.
  readonly stage: HTMLElement;
  /// La scorciatoia, o che cosa fa Invio: si legge.
  readonly tip: readonly Node[];
}

/// I colori della tavolozza, nell'ordine dei campioni.
export const PALETTE = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;

/// Le voci che sono un blocco intero: la loro scorciatoia va a inizio riga.
const BLOCK_SECTIONS = new Set(["text", "lists", "blocks", "code"]);

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/// Un blocco d'esempio, `kind` come lo chiama il CSS del pannello.
function block(kind: string, text: string): HTMLElement {
  const node = el("div", "slash-sample", text);
  node.dataset["kind"] = kind;
  return node;
}

/// Il segno che spezza una frase del catalogo dove va il suo pezzo.
const MARK = "\u0001";

type SentenceKey = "slash.sample.date" | "slash.sample.mention" | "slash.sample.note" | "slash.sample.link" | "slash.sample.comment";

/// Una frase con un pezzo in mezzo: «Vedi [Media] per il confronto.».
function sentence(key: SentenceKey, middle: HTMLElement): HTMLElement {
  const [before = "", after = ""] = t(key, { chip: MARK }).split(MARK);
  const node = block("paragraph", "");
  node.append(before, middle, after);
  return node;
}

function chip(kind: string, text: string, icon?: string): HTMLElement {
  const node = el("span", "slash-chip");
  node.dataset["kind"] = kind;
  const figure = icon ? iconEl(icon) : null;
  if (figure) node.append(figure);
  node.append(text);
  return node;
}

function table(rows: number, cols: number): HTMLElement {
  const grid = el("div", "slash-sample-table");
  grid.style.setProperty("--slash-cols", String(cols));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = el("span", r === 0 ? "is-head" : "");
      grid.append(cell);
    }
  }
  return grid;
}

function code(text: string): HTMLElement {
  return block("code", text);
}

const numberParam = (params: Readonly<Record<string, unknown>>, key: string, fallback: number): number => {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

function dateOf(params: Readonly<Record<string, unknown>>, today: Date): Date {
  const iso = params["date"];
  if (typeof iso === "string") {
    const [y, m, d] = iso.split("-").map(Number);
    if (y && m && d) return new Date(y, m - 1, d);
  }
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
}

/// Il campione di una voce.
function sample(entry: SlashMenuEntry, context: PreviewContext): HTMLElement {
  const id = entry.id;
  const params = entry.params;
  const color = /^markdown\.(color|background)\.([a-z]+)$/.exec(id);
  if (color) {
    const node = block("paragraph", t("slash.sample.color"));
    node.dataset[color[1] === "color" ? "color" : "fill"] = color[2]!;
    return node;
  }
  if (id === COLOR_ENTRY) {
    const swatches = el("div", "slash-sample-palette");
    for (const name of PALETTE) {
      const text = el("span", "", "A");
      text.dataset["color"] = name;
      const fill = el("span", "");
      fill.dataset["fill"] = name;
      swatches.append(text, fill);
    }
    return swatches;
  }
  const heading = /^markdown\.heading\.([1-6])$/.exec(id);
  if (heading) {
    const node = block("heading", entry.quick ? t("slash.sample.heading") : entry.label);
    node.dataset["level"] = heading[1]!;
    return node;
  }
  switch (id) {
    case "markdown.paragraph": return block("paragraph", t("slash.sample.paragraph"));
    case "markdown.list.bullet": return block("bullet", t("slash.sample.bullet"));
    case "markdown.list.ordered": return block("ordered", t("slash.sample.ordered"));
    case "markdown.list.task": return block("task", t("slash.sample.task"));
    case "markdown.details": return block("details", t("slash.sample.details"));
    case "markdown.quote": return block("quote", t("slash.sample.quote"));
    case "markdown.rule": return el("hr", "slash-sample-rule");
    case "markdown.mathblock": return block("math", "σ = √σ²");
    case "markdown.math": return block("paragraph", "σ = √σ²");
    case "markdown.callout": {
      const type = typeof params["type"] === "string" ? params["type"] : "note";
      const node = block("callout", "");
      node.dataset["type"] = type;
      node.append(el("b", "", calloutLabel(type)), el("span", "", t("slash.sample.callout")));
      return node;
    }
    case "markdown.table": return table(Math.min(numberParam(params, "rows", 3), 5), Math.min(numberParam(params, "cols", 3), 5));
    case "markdown.columns": {
      const count = Math.min(numberParam(params, "count", 2), 4);
      const node = el("div", "slash-sample-columns");
      for (let i = 0; i < count; i++) node.append(el("span", ""));
      return node;
    }
    case "markdown.date": return sentence("slash.sample.date", chip("date", longDay(dateOf(params, context.today)), "fmt-date"));
    case "markdown.mention": return sentence("slash.sample.mention", chip("person", t("slash.sample.person")));
    case "markdown.wikilink":
    case "markdown.embed": return sentence("slash.sample.note", chip("note", t("slash.sample.note.name"), "fmt-wikilink"));
    case "markdown.link":
    case "markdown.linkcard": return sentence("slash.sample.link", chip("link", t("slash.sample.link.name"), "fmt-webpage"));
    case "markdown.footnote": {
      const node = block("paragraph", t("slash.sample.footnote"));
      node.append(el("sup", "", "1"));
      return node;
    }
    case "markdown.comment": return sentence("slash.sample.comment", chip("comment", "%% " + t("slash.sample.comment.text") + " %%"));
    case "markdown.property.add": {
      const node = el("div", "slash-sample-properties");
      node.append(el("span", "", "tags"), el("b", "", t("slash.sample.property.tags")), el("span", "", t("slash.sample.property.due")), el("b", "", longDay(dateOf({}, context.today))));
      return node;
    }
    case "markdown.codeblock": {
      const language = typeof params["language"] === "string" ? params["language"] : "python";
      return code(language === "python" ? "def varianza(xs):\n    m = sum(xs) / len(xs)" : `${language}…`);
    }
    case "markdown.diagram": return code("graph LR\n  Media --> Varianza");
    case "markdown.toc": {
      const titles = context.outline().filter((heading) => heading.level <= 3);
      if (titles.length === 0) return el("div", "slash-sample-faint", t("slash.panel.toc.empty"));
      const node = el("div", "slash-sample-toc");
      for (const title of titles.slice(0, 6)) {
        const row = el("span", "", title.text);
        row.dataset["level"] = String(title.level);
        node.append(row);
      }
      return node;
    }
  }
  // Un comando del registro: la sua icona, grande.
  const node = el("div", "slash-sample-command");
  const figure = entry.icon ? iconEl(entry.icon) : null;
  if (figure) node.append(figure);
  node.append(el("span", "", entry.label));
  return node;
}

/// Il prima e il dopo, sopra una selezione.
function beforeAfter(entry: SlashMenuEntry, transform: SlashTransform): HTMLElement {
  const node = el("div", "slash-sample-transform");
  const after = entry.action ? transform.after(entry.id) : null;
  node.append(
    el("span", "slash-sample-label", t("slash.panel.before")),
    el("pre", "slash-sample-text", transform.before),
    el("span", "slash-sample-label", t("slash.panel.after")),
    el("pre", "slash-sample-text", after ?? t("slash.panel.after.command")),
  );
  return node;
}

/// La riga sotto il campione.
function tipOf(entry: SlashMenuEntry, transform: boolean): Node[] {
  if (transform) return [];
  if (entry.picker) return [document.createTextNode(t("slash.panel.opens"))];
  const markdown = markdownHint(entry.id);
  if (markdown) {
    const keys = el("code", "", markdown.length < 4 ? `${markdown}␣` : markdown);
    const [before = "", after = ""] = t(BLOCK_SECTIONS.has(entry.section) ? "slash.panel.without" : "slash.panel.without.inline", { hint: MARK }).split(MARK);
    return [document.createTextNode(before), keys, document.createTextNode(after)];
  }
  if (entry.hint) {
    const [before = "", after = ""] = t("slash.panel.without.chord", { hint: MARK }).split(MARK);
    return [document.createTextNode(before), el("kbd", "", entry.hint), document.createTextNode(after)];
  }
  return [];
}

export function previewOf(entry: SlashMenuEntry, context: PreviewContext): Preview {
  const stage = document.createElement("div");
  stage.className = "slash-sample-stage";
  stage.append(context.transform ? beforeAfter(entry, context.transform) : sample(entry, context));
  return { stage, tip: tipOf(entry, context.transform !== undefined) };
}
