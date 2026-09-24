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
  const safe = sanitizeFragment(html);
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
