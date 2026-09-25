import { EditorView } from "@codemirror/view";
import TurndownService from "turndown";
import { inContentSpace, sanitizeFragment, VAULT_SRC_ATTRIBUTE } from "../../../../ui/sanitize";

const markdownSource = /(?:^|\n)[ \t]{0,3}(?:#{1,6}\s|>\s|[-*+]\s|\d+[.)]\s|```|~~~)|\[[^\]\n]+\]\([^\n)]+\)|\*{1,2}[^*\n]+\*{1,2}|_{1,2}[^_\n]+_{1,2}|`[^`\n]+`/u;
const contentAnchorPrefix = `#${inContentSpace("")}`;
const converter = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
});
// Il sanitizzatore tiene inerte l'`src` di un'immagine del vault in
// `data-vault-src`: il Markdown incollato lo riscrive com'era, senza che
// l'elemento abbia mai chiesto quel path alla webview.
converter.addRule("vault-image", {
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
converter.addRule("gfm-strikethrough", {
  filter: ["del", "s"],
  replacement: (content) => (content.trim() ? `~~${content}~~` : content),
});
converter.addRule("gfm-table", {
  filter: "table",
  replacement: (_content, node) => {
    const rows = Array.from((node as HTMLTableElement).rows);
    if (rows.length === 0) return "";
    // La cella in Markdown è una riga sola: gli a capo diventano spazi e la
    // barra, che chiuderebbe la colonna, si scrive protetta.
    const cell = (el: HTMLTableCellElement) =>
      converter.turndown(el.innerHTML).replace(/\s*\n+\s*/g, " ").replace(/\|/g, "\\|").trim();
    const width = Math.max(...rows.map((row) => row.cells.length));
    const line = (cells: string[]) =>
      `| ${[...cells, ...Array(width - cells.length).fill("")].join(" | ")} |`;
    const header = rows[0]!;
    const align = Array.from({ length: width }, (_, i) => {
      const value = (header.cells[i]?.getAttribute("align") ?? header.cells[i]?.style.textAlign ?? "").toLowerCase();
      return value === "center" ? ":---:" : value === "right" ? "---:" : value === "left" ? ":---" : "---";
    });
    const body = rows.slice(1).map((row) => line(Array.from(row.cells).map(cell)));
    return `\n\n${[line(Array.from(header.cells).map(cell)), `| ${align.join(" | ")} |`, ...body].join("\n")}\n\n`;
  },
});
// Una casella di un elenco di attività: il sanitizzatore la tiene come
// `input[type=checkbox]` disabilitato, e qui torna `[ ]` o `[x]`.
converter.addRule("gfm-task", {
  filter: (node) => node.nodeName === "INPUT" && (node as HTMLInputElement).type === "checkbox",
  replacement: (_content, node) => ((node as HTMLInputElement).checked ? "[x] " : "[ ] "),
});
// La voce di un elenco come la si scrive a mano: `- voce` e `1. voce`, non il
// `-   voce` di Turndown. Le righe che seguono rientrano quanto il marcatore,
// così un sottoelenco resta figlio della sua voce.
converter.addRule("list-item", {
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

/** Plain source copied from a Markdown editor takes precedence over rich HTML. */
export function markdownFromClipboard(data: DataTransfer): string | null {
  const html = data.getData("text/html");
  if (!html) return null;
  const declared = data.getData("text/markdown");
  if (declared) return data.getData("text/plain") ? null : declared;
  const plain = data.getData("text/plain");
  if (plain && markdownSource.test(plain)) return null;

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
  const markdown = converter.turndown(safe);
  return markdown || null;
}

export const markdownPaste = EditorView.domEventHandlers({
  paste(event, view) {
    if (view.state.readOnly || view.compositionStarted || !event.clipboardData) return false;
    const markdown = markdownFromClipboard(event.clipboardData);
    if (markdown === null) return false;
    event.preventDefault();
    view.dispatch(view.state.replaceSelection(markdown), { userEvent: "input.paste" });
    return true;
  },
});
