// Il segno di una cartella o di una nota: il solo posto che sa leggere un
// valore d'icona (Scrittoio 2, D7).
//
// Il valore è una stringa sola, la stessa di sempre — nell'organizzazione
// (`.fub/workspace.json`, campo `icons`) o nel frontmatter (`icon:`):
//
// - `fub:<nome>`, con un nome di `PAGE_FIGURES`, è una figura monocroma del
//   set, disegnata con `icon(nome)`: prende il colore del testo;
// - `fub:` con un nome che questa versione non conosce (scritto a mano, o da
//   una versione futura) non si disegna, e non è un errore;
// - ogni altro testo breve è un'emoji o una lettera, che si mostra com'è.
//
// Una versione di Fub di prima di questa forma mostra il testo `fub:book`: è
// il prezzo, accettato, di non cambiare il contratto.

import { t, type Key } from "../i18n/strings";
import { icon, iconEl } from "./icons";

/// Il prefisso di una figura nel valore d'icona.
export const FIGURE_PREFIX = "fub:";

/// Le figure che si possono scegliere, nell'ordine del selettore.
export const PAGE_FIGURES = [
  "book",
  "calendar",
  "flag",
  "bulb",
  "inbox",
  "archive",
  "image",
  "heart",
  "briefcase",
  "people",
  "music",
] as const;
export type PageFigure = (typeof PAGE_FIGURES)[number];

/// La forma di un nome dopo `fub:`: un id minuscolo, come i nomi delle icone.
const FIGURE_NAME = /^[a-z][a-z0-9-]*$/;

/// Ciò che un valore d'icona vuol dire.
export type PageMark =
  | { readonly kind: "figure"; readonly name: PageFigure }
  | { readonly kind: "text"; readonly text: string };

/// Il valore che una figura scrive.
export function figureValue(name: PageFigure): string {
  return `${FIGURE_PREFIX}${name}`;
}

/// `true` se il valore ha la forma di una figura (`fub:<id>`), anche con un
/// nome che questa versione non conosce.
function isFigureForm(value: string): boolean {
  return value.startsWith(FIGURE_PREFIX) && FIGURE_NAME.test(value.slice(FIGURE_PREFIX.length));
}

/// Un valore di `icon:` nel frontmatter che si mostra come icona: un testo
/// breve (un'emoji, anche composta, una lettera) o una figura (`fub:<nome>`,
/// anche con un nome sconosciuto: una versione futura può averlo scritto, e
/// semplicemente non si disegna). Un path o un indirizzo che un'altra app ha
/// messo nella stessa chiave no: `null`.
export function pageMarkValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const icon = value.trim();
  if (!icon || icon.length > 16) return null;
  if (isFigureForm(icon)) return icon;
  if (/[/\\:]/.test(icon)) return null;
  return icon;
}

function knownFigure(name: string): PageFigure | null {
  return (PAGE_FIGURES as readonly string[]).includes(name) ? (name as PageFigure) : null;
}

/// Il valore letto: una figura nota, un testo da mostrare, o `null` (nessun
/// valore, o un `fub:` che questa versione non sa disegnare).
export function readPageMark(value: string | null | undefined): PageMark | null {
  const written = value?.trim();
  if (!written) return null;
  if (written.startsWith(FIGURE_PREFIX)) {
    const name = knownFigure(written.slice(FIGURE_PREFIX.length));
    return name ? { kind: "figure", name } : null;
  }
  return { kind: "text", text: written };
}

/// La voce del catalogo col nome di ogni figura: una figura nuova senza il
/// suo nome non compila.
const FIGURE_NAMES: Record<PageFigure, Key> = {
  book: "icons.figure.book",
  calendar: "icons.figure.calendar",
  flag: "icons.figure.flag",
  bulb: "icons.figure.bulb",
  inbox: "icons.figure.inbox",
  archive: "icons.figure.archive",
  image: "icons.figure.image",
  heart: "icons.figure.heart",
  briefcase: "icons.figure.briefcase",
  people: "icons.figure.people",
  music: "icons.figure.music",
};

/// Il nome di una figura, per il lettore di schermo e i suggerimenti.
export function figureLabel(name: PageFigure): string {
  return t(FIGURE_NAMES[name]);
}

/// Il testo da mettere davanti a un nome (nei menu, nei titoli, nei nomi
/// accessibili): l'emoji o la lettera; una figura nel testo non si scrive.
export function pageMarkText(value: string | null | undefined): string | null {
  const mark = readPageMark(value);
  return mark?.kind === "text" ? mark.text : null;
}

/// Il nome di un segno, per chi non lo vede: l'emoji stessa o il nome della
/// figura.
export function pageMarkLabel(value: string | null | undefined): string | null {
  const mark = readPageMark(value);
  if (!mark) return null;
  return mark.kind === "text" ? mark.text : figureLabel(mark.name);
}

/// Il contenuto da mettere dentro una riga: un `<svg>` per una figura, un nodo
/// di testo per un'emoji, `null` se il valore non si disegna.
export function pageMarkContent(value: string | null | undefined): Node | null {
  const mark = readPageMark(value);
  if (!mark) return null;
  if (mark.kind === "text") return document.createTextNode(mark.text);
  return iconEl(mark.name);
}

/// Riempie `host` col segno, al posto di ciò che conteneva; `false` se il
/// valore non si disegna (e `host` resta vuoto). Una figura mette su `host`
/// `data-page-figure` col suo nome, così la pelle la tratta da figura.
export function drawPageMark(host: HTMLElement, value: string | null | undefined): boolean {
  const mark = readPageMark(value);
  const content = pageMarkContent(value);
  host.replaceChildren(...(content ? [content] : []));
  if (mark?.kind === "figure" && content) host.dataset.pageFigure = mark.name;
  else delete host.dataset.pageFigure;
  return content !== null;
}

/// La figura come immagine `data:` da usare in una maschera CSS, per chi non
/// può mettere un nodo dentro il testo (la Live, accanto ai wikilink: un segno
/// che il cursore non deve vedere). Il colore lo dà chi la usa, col fondo;
/// della figura conta solo la forma. Stringa vuota se il nome non si disegna.
export function figureMask(name: PageFigure): string {
  const drawn = icon(name);
  if (!drawn) return "";
  const svg = drawn.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
