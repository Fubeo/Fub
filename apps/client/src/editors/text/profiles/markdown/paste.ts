import { isStrictlyInsideCode } from "./parser";
import { pasteHtml } from "../../paste-html";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, keymap, type Command } from "@codemirror/view";
import type TurndownService from "turndown";
import { inContentSpace, sanitizeFragment, VAULT_SRC_ATTRIBUTE } from "../../../../ui/sanitize";
import { readClipboard } from "../../../../platform/clipboard";
import { escapeLinkLabel, linkDestination } from "./link-syntax";
import { AddressChoiceWidget, bareUrl } from "./link-card";

const markdownSource = /(?:^|\n)[ \t]{0,3}(?:#{1,6}\s|>\s|[-*+]\s|\d+[.)]\s|```|~~~)|\[[^\]\n]+\]\([^\n)]+\)|\*{1,2}[^*\n]+\*{1,2}|_{1,2}[^_\n]+_{1,2}|`[^`\n]+`/u;
const contentAnchorPrefix = `#${inContentSpace("")}`;

// Turndown serve solo a un incolla ricco, e stava nel chunk che le tre
// finestre condividono: ora arriva dopo, in un chunk suo. Lo carica il primo
// editor Markdown montato, così al primo incolla è quasi sempre già qui.
let converter: TurndownService | null = null;
let loading: Promise<TurndownService> | null = null;

function loadConverter(): Promise<TurndownService> {
  loading ??= import("turndown").then(
    ({ default: Turndown }) => (converter = createConverter(Turndown)),
    (error: unknown) => {
      // Un chunk che non arriva non resta fallito per sempre: il prossimo
      // incolla riprova.
      loading = null;
      throw error;
    },
  );
  return loading;
}

function createConverter(Turndown: typeof TurndownService): TurndownService {
  const created = new Turndown({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });
  for (const [key, rule] of rules) created.addRule(key, rule);
  return created;
}

/// Le regole si dichiarano qui sotto, in ordine, e si installano su ogni
/// convertitore creato: Turndown le prova nell'ordine in cui le riceve.
const rules: [string, TurndownService.Rule][] = [];
function addRule(key: string, rule: TurndownService.Rule): void {
  rules.push([key, rule]);
}

// Il sanitizzatore tiene inerte l'`src` di un'immagine del vault in
// `data-vault-src`: il Markdown incollato lo riscrive com'era, senza che
// l'elemento abbia mai chiesto quel path alla webview.
addRule("vault-image", {
  filter: (node) => node.nodeName === "IMG" && node.hasAttribute(VAULT_SRC_ATTRIBUTE),
  replacement: (_content, node) => {
    const element = node as HTMLElement;
    const alt = (element.getAttribute("alt") ?? "").replace(/[[\]]/g, "\\$&");
    const path = element.getAttribute(VAULT_SRC_ATTRIBUTE) ?? "";
    // Spazi e parentesi chiudono la destinazione: fra `< >` resta un path solo.
    const target = /[\s()<>]/.test(path) ? `<${path.replace(/[<>]/g, encodeURIComponent)}>` : path;
    return `![${alt}](${target})`;
  },
});

// Le estensioni GFM che il Markdown di Fub legge e che Turndown da solo non
// scrive: senza, una tabella incollata da una pagina web diventava righe di
// testo senza colonne e un barrato perdeva il barrato.
addRule("gfm-strikethrough", {
  filter: ["del", "s"],
  replacement: (content) => (content.trim() ? `~~${content}~~` : content),
});
// Il Markdown di ogni cella, scritto una volta sola mentre Turndown scende
// l'albero, e ritrovato qui dalla tabella che la contiene. Prima la tabella
// riconvertiva ogni cella dal suo `innerHTML`, tabelle annidate comprese: il
// lavoro raddoppiava a ogni livello, e poche centinaia di byte di tabelle una
// dentro l'altra, incollate da una pagina, bloccavano l'editor.
const cellMarkdown = new WeakMap<Node, string>();
/// Le colonne fino alle quali una riga corta si completa con celle vuote.
const PADDED_COLUMNS = 64;
addRule("gfm-table-cell", {
  filter: ["th", "td"],
  replacement: (content, node, options) => {
    // La cella in Markdown è una riga sola: gli a capo diventano spazi e la
    // barra, che chiuderebbe la colonna, si scrive protetta.
    cellMarkdown.set(node, content.replace(/\s*\n+\s*/g, " ").replace(/\|/g, "\\|").trim());
    return options.defaultReplacement?.(content, node, options) ?? content;
  },
});
/// Le righe e le celle della tabella **stessa**, senza quelle delle tabelle
/// annidate: è ciò che `rows` e `cells` danno in un browser, scritto a mano
/// perché happy-dom, dove girano i test, ci mette anche le annidate.
function ownRows(table: Element): Element[] {
  const sections = Array.from(table.children);
  const rowsOf = (section: Element) => Array.from(section.children).filter((row) => row.nodeName === "TR");
  return [
    ...sections.filter((section) => section.nodeName === "THEAD").flatMap(rowsOf),
    ...sections.flatMap((section) =>
      section.nodeName === "TR" ? [section] : section.nodeName === "TBODY" ? rowsOf(section) : []),
    ...sections.filter((section) => section.nodeName === "TFOOT").flatMap(rowsOf),
  ];
}
function ownCells(row: Element): Element[] {
  return Array.from(row.children).filter((cell) => cell.nodeName === "TD" || cell.nodeName === "TH");
}
addRule("gfm-table", {
  filter: "table",
  replacement: (_content, node) => {
    const rows = ownRows(node as HTMLTableElement).map(ownCells);
    if (rows.length === 0) return "";
    const cell = (el: Element) => cellMarkdown.get(el) ?? "";
    const width = rows.reduce((widest, cells) => Math.max(widest, cells.length), 0);
    // Una riga corta si completa con celle vuote, ma solo in una tabella che
    // si legge: GFM le completa da sé, e su una riga di centomila celle sopra
    // centomila righe corte il completamento costava righe × colonne.
    const padded = width <= PADDED_COLUMNS;
    const line = (cells: string[], pad = padded) =>
      `| ${[...cells, ...Array(pad ? width - cells.length : 0).fill("")].join(" | ")} |`;
    const header = rows[0]!;
    const align = Array.from({ length: width }, (_, i) => {
      const th = header[i] as HTMLElement | undefined;
      const value = (th?.getAttribute("align") ?? th?.style.textAlign ?? "").toLowerCase();
      return value === "center" ? ":---:" : value === "right" ? "---:" : value === "left" ? ":---" : "---";
    });
    const body = rows.slice(1).map((cells) => line(cells.map(cell)));
    // L'intestazione invece si completa sempre: fissa le colonne, e una cella
    // oltre la sua larghezza GFM la scarterebbe.
    return `\n\n${[line(header.map(cell), true), `| ${align.join(" | ")} |`, ...body].join("\n")}\n\n`;
  },
});
// Una casella di un elenco di attività: il sanitizzatore la tiene come
// `input[type=checkbox]` disabilitato, e qui torna `[ ]` o `[x]`.
addRule("gfm-task", {
  filter: (node) => node.nodeName === "INPUT" && (node as HTMLInputElement).type === "checkbox",
  replacement: (_content, node) => ((node as HTMLInputElement).checked ? "[x] " : "[ ] "),
});
// La voce di un elenco come la si scrive a mano: `- voce` e `1. voce`, non il
// `-   voce` di Turndown. Le righe che seguono rientrano quanto il marcatore,
// così un sottoelenco resta figlio della sua voce.
addRule("list-item", {
  filter: "li",
  replacement: (content, node) => {
    const parent = node.parentNode as HTMLElement | null;
    let marker = "-";
    if (parent?.nodeName === "OL") {
      const start = Number(parent.getAttribute("start") ?? "1");
      marker = `${(Number.isFinite(start) ? start : 1) + Array.prototype.indexOf.call(parent.children, node)}.`;
    }
    const indent = " ".repeat(marker.length + 1);
    const body = content
      .replace(/^\n+/, "")
      .replace(/\n+$/, "\n")
      .replace(/\n/gm, `\n${indent}`)
      .replace(/^\[( |x)\]\s+/, "[$1] ");
    return `${marker} ${body}${node.nextSibling && !/\n$/.test(body) ? "\n" : ""}`;
  },
});

/// L'HTML di chi copia usa ancora i tag di presentazione — `<b>`, `<i>`,
/// `align` — che il sanitizzatore condiviso non ammette e scarterebbe col loro
/// significato. Qui diventano i loro equivalenti semantici prima del
/// sanitizzatore, in un documento inerte (`DOMParser` non carica e non esegue
/// niente). Il `<b style="font-weight:normal">` con cui Google Docs avvolge
/// tutto non è un grassetto, e resta testo.
function semanticHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const rename = (from: string, to: string, keep: (el: Element) => boolean = () => true) => {
    for (const el of Array.from(parsed.body.getElementsByTagName(from))) {
      const replacement = keep(el) ? parsed.createElement(to) : parsed.createDocumentFragment();
      replacement.append(...Array.from(el.childNodes));
      el.replaceWith(replacement);
    }
  };
  rename("b", "strong", (el) => !/font-weight:\s*(normal|[1-5]00)\b/i.test(el.getAttribute("style") ?? ""));
  rename("i", "em");
  rename("strike", "del");
  for (const cell of Array.from(parsed.body.querySelectorAll("th[align], td[align]"))) {
    const align = (cell.getAttribute("align") ?? "").toLowerCase();
    if (/^(left|center|right)$/.test(align) && !cell.getAttribute("style")) {
      cell.setAttribute("style", `text-align: ${align}`);
    }
  }
  return parsed.body.innerHTML;
}

/// Cosa fare degli appunti, deciso durante l'evento: `null` lascia
/// l'incolla a CodeMirror, `markdown` è già la sorgente, `html` va convertito.
type RichPaste = { markdown: string } | { html: string };

/** Plain source copied from a Markdown editor takes precedence over rich HTML. */
function richPaste(data: DataTransfer): RichPaste | null {
  const html = data.getData("text/html");
  if (!html) return null;
  const declared = data.getData("text/markdown");
  if (declared) return data.getData("text/plain") ? null : { markdown: declared };
  const plain = data.getData("text/plain");
  if (plain && markdownSource.test(plain)) return null;
  return { html };
}

function convert(html: string, turndown: TurndownService): string | null {
  // Never mount the clipboard DOM. The shared sanitizer removes active elements,
  // event attributes and unsafe URLs before Turndown sees any nodes.
  const safe = sanitizeFragment(semanticHtml(html));
  // The renderer namespaces in-document anchors when mounting HTML; pasted
  // Markdown stays source text and must retain its original fragment name.
  for (const anchor of safe.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href") ?? "";
    if (href.startsWith(contentAnchorPrefix)) {
      anchor.setAttribute("href", `#${href.slice(contentAnchorPrefix.length)}`);
    }
  }
  const markdown = turndown.turndown(safe);
  return markdown || null;
}

export async function markdownFromClipboard(data: DataTransfer): Promise<string | null> {
  const rich = richPaste(data);
  if (rich === null) return null;
  return "markdown" in rich ? rich.markdown : convert(rich.html, await loadConverter());
}

/// Un indirizzo incollato su un testo selezionato diventa un link Markdown,
/// `[testo](url)`, come in Obsidian. Solo un indirizzo intero (niente spazi,
/// `http(s)://` o `mailto:`), una selezione sola su una riga, fuori dal codice,
/// e che non sia già essa stessa un indirizzo. Su una riga vuota vale la
/// scelta di `addressOnBlankLine`.
const PASTED_URL = /^(?:https?:\/\/|mailto:)\S+$/iu;

/// Il Markdown di un link `[testo](indirizzo)`. Un `|` non escapato chiuderebbe
/// la cella se il link finisce in una tabella: nel testo si scrive `\|`, che in
/// un paragrafo è lo stesso carattere, e nell'indirizzo `%7C`.
function linkMarkdown(text: string, url: string): string {
  return `[${escapePipes(escapeLinkLabel(text))}](${linkDestination(url).replace(/\|/gu, "%7C")})`;
}

/// Un `|` preceduto da un numero pari di `\` non è escapato, e lo diventa; uno
/// già escapato resta com'è.
function escapePipes(text: string): string {
  return text.replace(/(\\*)\|/gu, (run, slashes: string) => (slashes.length % 2 === 0 ? `${slashes}\\|` : run));
}

function linkOverSelection(view: EditorView, data: DataTransfer): string | null {
  const { ranges } = view.state.selection;
  if (ranges.length !== 1 || ranges[0]!.empty) return null;
  const url = data.getData("text/plain").trim();
  if (!PASTED_URL.test(url)) return null;
  const { from, to } = ranges[0]!;
  const text = view.state.sliceDoc(from, to);
  if (text.includes("\n") || PASTED_URL.test(text.trim()) || isStrictlyInsideCode(view.state, from)) return null;
  return linkMarkdown(text, url);
}

/// L'indirizzo che si incolla da solo su una riga vuota, o `null`. Solo dagli
/// appunti senza HTML: un HTML porta il suo titolo, e il convertitore ne fa già
/// un link. Il cursore è solo, fuori dal codice, e la riga è vuota per davvero
/// (uno spazio la lascia a testo, com'è sempre stato).
function addressOnBlankLine(view: EditorView, data: DataTransfer): string | null {
  if (data.getData("text/html")) return null;
  const { ranges } = view.state.selection;
  if (ranges.length !== 1 || !ranges[0]!.empty) return null;
  const { from } = ranges[0]!;
  if (view.state.doc.lineAt(from).length !== 0 || isStrictlyInsideCode(view.state, from)) return null;
  const url = data.getData("text/plain").trim();
  return PASTED_URL.test(url) ? url : null;
}

/// La scelta sotto un indirizzo incollato su una riga vuota. `link` è il
/// Markdown scritto a `from`: «Scheda» lo sostituisce con l'indirizzo da solo.
/// La scelta vale finché il testo non cambia e il cursore resta sul link.
interface AddressChoice {
  readonly from: number;
  readonly link: string;
  readonly url: string;
}
const offerAddressChoice = StateEffect.define<AddressChoice | null>();
const addressChoice = StateField.define<AddressChoice | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(offerAddressChoice)) return effect.value;
    }
    // Una battuta, Invio o Annulla tengono il Link: la scelta finisce lì.
    if (value === null || transaction.docChanged) return null;
    const { ranges, main } = transaction.state.selection;
    const to = value.from + value.link.length;
    return ranges.length === 1 && main.from >= value.from && main.to <= to ? value : null;
  },
  provide: (field) => EditorView.decorations.from(field, (choice) => (choice === null
    ? Decoration.none
    : Decoration.set(Decoration.widget({ widget: new AddressChoiceWidget(choice.url), block: true, side: 1 })
      .range(choice.from + choice.link.length)))),
});

/// Il bottone della scelta sotto il puntatore, o `null`.
function choiceButton(event: Event): HTMLElement | null {
  const target = event.target instanceof Element ? event.target : null;
  return target?.closest<HTMLElement>(".cm-fub-address-choice [data-choice]") ?? null;
}

const addressChoiceGestures = EditorView.domEventHandlers({
  // Il pulsante non prende il fuoco e non sposta il cursore.
  mousedown(event) {
    if (event.button !== 0 || choiceButton(event) === null) return false;
    event.preventDefault();
    return true;
  },
  click(event, view) {
    const button = choiceButton(event);
    if (button === null) return false;
    event.preventDefault();
    const choice = view.state.field(addressChoice);
    if (choice !== null && button.dataset.choice === "card" && !view.state.readOnly) {
      const to = choice.from + choice.link.length;
      // Il testo deve essere ancora quello scritto: altrimenti la scelta è vecchia.
      if (view.state.sliceDoc(choice.from, to) === choice.link) {
        view.dispatch({
          changes: { from: choice.from, to, insert: choice.url },
          selection: { anchor: choice.from + choice.url.length },
          userEvent: "input.paste",
        });
        return true;
      }
    }
    // «Link», o una scelta che non c'è più: il link resta com'è.
    if (choice !== null) view.dispatch({ effects: offerAddressChoice.of(null) });
    return true;
  },
});

const pasteHandler = EditorView.domEventHandlers({
  paste(event, view) {
    if (view.state.readOnly || view.compositionStarted || !event.clipboardData) return false;
    const link = linkOverSelection(view, event.clipboardData);
    if (link !== null) {
      event.preventDefault();
      view.dispatch(view.state.replaceSelection(link), { userEvent: "input.paste" });
      return true;
    }
    const address = addressOnBlankLine(view, event.clipboardData);
    if (address !== null) {
      event.preventDefault();
      const { from } = view.state.selection.main;
      const markdown = linkMarkdown(address, address);
      // «Scheda» esiste per le pagine web: un mailto è solo un link, senza scelta.
      const offer = bareUrl(address) === null ? null : { from, link: markdown, url: address };
      view.dispatch(view.state.replaceSelection(markdown), {
        userEvent: "input.paste",
        effects: offerAddressChoice.of(offer),
      });
      return true;
    }
    // Nel codice l'HTML degli appunti resta il loro testo (C4): convertirlo
    // in Markdown scriverebbe segni dentro il codice.
    if (!view.state.facet(pasteHtml) || isStrictlyInsideCode(view.state, view.state.selection.main.from)) return false;
    const rich = richPaste(event.clipboardData);
    if (rich === null) return false;
    const insert = (markdown: string) =>
      view.dispatch(view.state.replaceSelection(markdown), { userEvent: "input.paste" });
    if ("markdown" in rich) {
      event.preventDefault();
      insert(rich.markdown);
      return true;
    }
    if (converter) {
      const markdown = convert(rich.html, converter);
      if (markdown === null) return false;
      event.preventDefault();
      insert(markdown);
      return true;
    }
    // Turndown non è ancora arrivato. Gli appunti si leggono adesso — finito
    // l'evento il `DataTransfer` è vuoto — e il testo entra appena c'è il
    // convertitore, sulla selezione di quel momento. Se la conversione è
    // vuota o il chunk non arriva entra il testo semplice, come avrebbe
    // fatto CodeMirror.
    event.preventDefault();
    const plain = event.clipboardData.getData("text/plain");
    void loadConverter()
      .then((turndown) => convert(rich.html, turndown), () => null)
      .then((markdown) => {
        const text = markdown ?? plain;
        if (text) insert(text);
      });
    return true;
  },
});

/// Il testo semplice degli appunti, o `null` se non ce n'è o il sistema non
/// li lascia leggere.
async function plainClipboardText(): Promise<string | null> {
  try {
    for (const item of await readClipboard()) {
      if (item.types.includes("text/plain")) return await (await item.getType("text/plain")).text();
    }
  } catch {
    // Negati o assenti: l'incolla semplice non incolla niente.
  }
  return null;
}

/// `Mod-Shift-v`: incolla il testo semplice degli appunti, così com'è. Niente
/// conversione dell'HTML e niente link sulla selezione: è il gesto di chi
/// vuole proprio quei caratteri. Gli appunti si leggono dalla porta della
/// shell e non dall'evento `paste`, che non tutti i motori mandano su questo
/// accordo; il testo entra sulla selezione del momento in cui arriva.
export const pastePlainText: Command = (view) => {
  if (view.state.readOnly) return false;
  void plainClipboardText().then((text) => {
    // Un editor smontato o diventato di sola lettura nel frattempo non riceve niente.
    if (!text || !view.dom.isConnected || view.state.readOnly) return;
    view.dispatch(view.state.replaceSelection(text), { userEvent: "input.paste", scrollIntoView: true });
  });
  return true;
};

// Il primo editor Markdown montato fa partire il caricamento di Turndown.
const preloadConverter = ViewPlugin.define(() => {
  loadConverter().catch(() => {});
  return {};
});

export const markdownPaste = [
  pasteHandler,
  addressChoice,
  addressChoiceGestures,
  preloadConverter,
  keymap.of([{ key: "Mod-Shift-v", run: pastePlainText }]),
];
