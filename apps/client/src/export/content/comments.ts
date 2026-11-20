// I commenti sulla carta (E28, T74; il prototipo `.pcm sup`, `.pnote`,
// `.pnotes`, passo 29).
//
// La resa per la stampa del core porta ogni commento come un `<template
// class="comment-note">` subito dopo il passo commentato, con chi l'ha
// scritto e quando: i commenti di seguito sono una discussione (il primo e
// le sue risposte). Il sanificatore della resa toglie ogni `<template>` col
// suo contenuto (`ui/sanitize.ts`): prima di montarla, `inertComments` fa di
// ciascuno uno `<span class="comment-note">` vuoto col testo in `data-text`,
// che il sanificatore lascia passare e che non mostra niente. Tre scelte:
//
// - no: nessun segno, nessuna nota (la resa non li mostra già);
// - nel margine: un numero in apice dopo il passo e, nel margine esterno
//   alla sua altezza, la nota col numero, il nome di chi ha scritto, il
//   testo e quante risposte ha («+2»). Con due colonne, o un margine troppo
//   stretto, le note vanno in fondo da sole (`notePlacement` in `rules.ts`);
// - in fondo: lo stesso numero, e le note dopo l'ultimo blocco, sotto il
//   titolo «Commenti», con ogni messaggio della discussione per intero.
//
// Le note si misurano già larghe come usciranno (il margine meno lo spazio
// attorno, o la colonna) in un contenitore accanto alla resa: le regole
// sanno così quanto sono alte, e chi disegna le pagine le copia da lì.
// Ogni nota è testo vero del PDF (`aside`, nella lingua dell'interfaccia
// che le ha scritte): un lettore di schermo la trova come una nota.

import { resolvedLanguage, t, plural } from "../../i18n/strings";
import type { ContentChanges } from "./changes";

export interface CommentMessage {
  readonly author: string;
  readonly date: string;
  readonly text: string;
}

/// Una discussione: il primo commento e le sue risposte, dopo lo stesso passo.
export interface CommentThread {
  /// L'identità della nota (`MarginNote.id`): `commento-<n>`.
  readonly id: string;
  /// Il numero in apice, da 1 nell'ordine della nota.
  readonly number: number;
  readonly messages: readonly CommentMessage[];
  /// Il numero in apice messo nella resa.
  readonly mark: HTMLElement;
}

/// Dove vanno le note: accanto al paragrafo o in fondo.
export type NotesShape = "margine" | "fondo";

/// Lo spazio fra il testo e la nota nel margine (il prototipo `left:
/// calc(100% + 3.5mm)`), e quanto la nota resta lontana dal bordo del foglio
/// (`width: calc(margine − 8mm)`), in millimetri.
export const NOTE_OFFSET_MM = 3.5;
export const NOTE_TRIM_MM = 8;

/// Il segnaposto di un commento nella resa montata.
const NOTE_SELECTOR = "span.comment-note";

/// Fa dei commenti della resa del core (`<template class="comment-note">`,
/// che il sanificatore toglierebbe) dei segnaposti vuoti che passano: uno
/// `<span class="comment-note">` con chi, quando e il testo in attributi
/// `data-*`. Dal `<template>` si prende solo il testo: nessun suo markup
/// entra nella pagina. Una resa senza commenti torna com'è.
export function inertComments(html: string): string {
  if (!html.includes("comment-note")) return html;
  // Un documento a parte: non è nella pagina, non carica né esegue niente.
  const parsed = new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html");
  const templates = parsed.querySelectorAll<HTMLTemplateElement>("template.comment-note");
  if (templates.length === 0) return html;
  for (const template of templates) {
    const note = parsed.createElement("span");
    note.className = "comment-note";
    const author = template.getAttribute("data-author");
    const date = template.getAttribute("data-date");
    if (author !== null) note.setAttribute("data-author", author);
    if (date !== null) note.setAttribute("data-date", date);
    note.setAttribute("data-text", template.content.textContent ?? "");
    template.replaceWith(note);
  }
  return parsed.body.innerHTML;
}

function messageOf(note: HTMLElement): CommentMessage {
  return {
    author: (note.dataset["author"] ?? "").trim(),
    date: (note.dataset["date"] ?? "").trim(),
    text: (note.dataset["text"] ?? "").trim(),
  };
}

/// Il nodo dopo `node` che non è spazio bianco.
function nextMeaningful(node: Node): Node | null {
  let next = node.nextSibling;
  while (next && next.nodeType === Node.TEXT_NODE && !(next.textContent ?? "").trim()) next = next.nextSibling;
  return next;
}

function isNote(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement && node.matches(NOTE_SELECTOR);
}

/// Il nome di chi ha scritto, come lo dice la nota nel margine: il primo
/// nome; senza nome, «Senza nome».
export function firstName(author: string): string {
  return author.split(/\s+/u).find(Boolean) ?? t("pdf_export.content.comments.no_author");
}

/// Una data `aaaa-mm-gg` per esteso; altrimenti com'è scritta.
export function commentDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(date);
  if (!match) return date;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(day.getTime())) return date;
  return new Intl.DateTimeFormat(resolvedLanguage(), { dateStyle: "medium", timeZone: "UTC" }).format(day);
}

/// Mette il numero in apice dopo ogni passo commentato e torna le
/// discussioni, nell'ordine della nota. Le note nascoste dalla resa restano
/// dove sono (e non si vedono).
export function markComments(page: HTMLElement, changes: ContentChanges): CommentThread[] {
  const threads: CommentThread[] = [];
  const seen = new Set<Node>();
  for (const first of page.querySelectorAll<HTMLElement>(NOTE_SELECTOR)) {
    if (seen.has(first)) continue;
    // Un commento in un blocco tolto (un compito fatto) non ha una nota.
    if (first.closest("[hidden]")) continue;
    const group: HTMLElement[] = [first];
    seen.add(first);
    for (let next = nextMeaningful(first); isNote(next); next = nextMeaningful(next)) {
      group.push(next);
      seen.add(next);
    }
    const number = threads.length + 1;
    const mark = document.createElement("sup");
    mark.className = "export-comment-mark";
    mark.dataset["exportNote"] = `commento-${number}`;
    mark.textContent = String(number);
    group[0]!.before(mark);
    changes.add(mark);
    threads.push({ id: `commento-${number}`, number, messages: group.map(messageOf), mark });
  }
  return threads;
}

/// La nota di una discussione, nella forma in cui esce: nel margine il primo
/// messaggio col primo nome e quante risposte; in fondo ogni messaggio col
/// nome intero e la data.
export function noteElement(thread: CommentThread, shape: NotesShape, lang: string): HTMLElement {
  const note = document.createElement("aside");
  note.className = "export-comment";
  note.dataset["exportNote"] = thread.id;
  note.dataset["shape"] = shape;
  note.setAttribute("role", "note");
  if (lang) note.lang = lang;
  const number = document.createElement("sup");
  number.textContent = String(thread.number);
  if (shape === "margine") {
    const [first, ...replies] = thread.messages;
    const who = document.createElement("b");
    who.textContent = firstName(first?.author ?? "");
    note.append(number, " ", who, " ", first?.text ?? "");
    if (replies.length > 0) {
      const more = document.createElement("i");
      more.textContent = `+${replies.length}`;
      more.title = plural(replies.length, "pdf_export.content.comments.replies.one", "pdf_export.content.comments.replies.other");
      note.append(" ", more);
    }
    return note;
  }
  note.append(number);
  thread.messages.forEach((message, index) => {
    if (index > 0) note.append(document.createElement("br"));
    const who = document.createElement("b");
    who.textContent = message.author || t("pdf_export.content.comments.no_author");
    note.append(index === 0 ? " " : "", who);
    if (message.date) note.append(`, ${commentDate(message.date)}`);
    note.append(`: ${message.text}`);
  });
  return note;
}

/// Il titolo sopra le note in fondo; sta dentro la prima nota, così resta
/// con lei (le regole tengono la nota intera).
export function notesHeading(): HTMLElement {
  const heading = document.createElement("h2");
  heading.className = "export-comments-title";
  heading.textContent = t("pdf_export.content.comments.title");
  return heading;
}
