// L'HTML che accompagna una copia dall'editor: grassetto, titoli, elenchi e
// link arrivano così in un documento o in una mail. Lo rende lo stesso
// renderer della nota, e poi si ripulisce per chi sta fuori: niente attributi
// della shell, niente link che solo Fub sa aprire, niente risorse del vault.
// Il testo semplice resta quello di CodeMirror, il Markdown della selezione.
import type { SyntaxForm } from "../../../../host/contract";
import { isAllowedLink, REMOTE_SRC_ATTRIBUTE, sanitizeMarkdownHtml } from "../../../../ui/sanitize";
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

/// L'HTML della resa senza il fondo dei commenti: il passo di un commento è
/// testo come gli altri, e fuori da Fub non porta né il fondo né i messaggi
/// (che la resa ha già tolto). Si toglie prima di ripulire, finché la classe
/// del renderer lo distingue da un `<mark>` scritto dall'autore. Il documento
/// di `DOMParser` è inerte: niente script, niente risorse.
function withoutComments(html: string): string {
  if (!html.includes("comment-range")) return html;
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const mark of Array.from(parsed.body.querySelectorAll("mark.comment-range"))) {
    mark.replaceWith(...Array.from(mark.childNodes));
  }
  return parsed.body.innerHTML;
}

export function clipboardHtml(markdown: string, forms?: readonly SyntaxForm[]): string {
  const fragment = sanitizeMarkdownHtml(withoutComments(renderMarkdown(markdown, forms).html));
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
    // testo alternativo. Una remota il sanitizzatore la lascia inerte in
    // `data-remote-src`: fuori da Fub torna il suo `src`, e la carica chi
    // incolla.
    if (tag === "img") {
      const src = element.getAttribute(REMOTE_SRC_ATTRIBUTE) ?? "";
      if (!OUTSIDE_IMAGE.test(src)) {
        element.replaceWith(element.getAttribute("alt") ?? "");
        continue;
      }
      element.setAttribute("src", src);
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
