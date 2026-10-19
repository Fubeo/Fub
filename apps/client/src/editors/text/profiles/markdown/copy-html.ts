// L'HTML che accompagna una copia dall'editor: grassetto, titoli, elenchi e
// link arrivano così in un documento o in una mail. Lo rende lo stesso
// renderer della nota, e poi si ripulisce per chi sta fuori: niente attributi
// della shell, niente link che solo Fub sa aprire, niente risorse del vault.
// Il testo semplice resta quello di CodeMirror, il Markdown della selezione.
import type { SyntaxForm } from "../../../../host/contract";
import { isAllowedLink, sanitizeMarkdownHtml } from "../../../../ui/sanitize";
import { renderMarkdown } from "./render";

/// Gli attributi che hanno senso fuori da Fub, per tag; gli altri cadono.
const KEPT: Readonly<Record<string, readonly string[]>> = {
  a: ["href"],
  img: ["src", "alt"],
  ol: ["start"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
};

const OUTSIDE_LINK = /^(?:https?:|mailto:)/iu;
const OUTSIDE_IMAGE = /^https?:/iu;

export function clipboardHtml(markdown: string, forms?: readonly SyntaxForm[]): string {
  const fragment = sanitizeMarkdownHtml(renderMarkdown(markdown, forms).html);
  for (const element of Array.from(fragment.querySelectorAll("*"))) {
    const tag = element.localName;
    // Una casella di un compito diventa il suo segno: un campo non si incolla.
    if (tag === "input") {
      element.replaceWith(element.hasAttribute("checked") ? "☑ " : "☐ ");
      continue;
    }
    // Un wikilink o un percorso del vault fuori da Fub non porta da nessuna
    // parte: resta il testo.
    if (tag === "a") {
      const href = element.getAttribute("href") ?? "";
      if (!OUTSIDE_LINK.test(href) || !isAllowedLink(href)) {
        element.replaceWith(...Array.from(element.childNodes));
        continue;
      }
    }
    // Un'immagine del vault non si raggiunge da un altro programma: resta il
    // testo alternativo.
    if (tag === "img") {
      const src = element.getAttribute("src") ?? "";
      if (!OUTSIDE_IMAGE.test(src)) {
        element.replaceWith(element.getAttribute("alt") ?? "");
        continue;
      }
    }
    // Uno span del renderer porta solo la posizione nel sorgente, già tolta.
    if (tag === "span") {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }
    const kept = KEPT[tag] ?? [];
    for (const attribute of Array.from(element.attributes)) {
      if (!kept.includes(attribute.name)) element.removeAttribute(attribute.name);
    }
  }
  const holder = document.createElement("div");
  holder.append(fragment);
  return holder.innerHTML;
}
