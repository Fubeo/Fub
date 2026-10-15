// Il rapporto di un'importazione, come lo legge chi importa: quanto c'è nel
// disegno, e che cosa cambia rispetto al file d'origine.
//
// Ogni genere di nota ha la sua frase, che dice che cosa c'era e che cosa
// diventa. Le frasi vengono prima per ciò che resta fuori, poi per ciò che
// entra cambiato; l'esempio del lettore si aggiunge soltanto per i generi in
// cui dice qualcosa a chi importa: un carattere, una forma, un indirizzo.

import type { Note, NoteKind } from "./diagram";
import type { Count } from "./index";
import { plural, t, type ImportKey as Key } from "./strings";

/// Le due frasi di ogni genere, nell'ordine del rapporto. È un `Record`
/// esaustivo: un genere nuovo non compila finché non ha le sue frasi.
const SENTENCES: Readonly<Record<NoteKind, readonly [Key, Key]>> = {
  unknown: ["draw.import.note.unknown.one", "draw.import.note.unknown.other"],
  embed: ["draw.import.note.embed.one", "draw.import.note.embed.other"],
  image: ["draw.import.note.image.one", "draw.import.note.image.other"],
  shadow: ["draw.import.note.shadow.one", "draw.import.note.shadow.other"],
  html: ["draw.import.note.html.one", "draw.import.note.html.other"],
  link: ["draw.import.note.link.one", "draw.import.note.link.other"],
  stencil: ["draw.import.note.stencil.one", "draw.import.note.stencil.other"],
  tip: ["draw.import.note.tip.one", "draw.import.note.tip.other"],
  fill: ["draw.import.note.fill.one", "draw.import.note.fill.other"],
  route: ["draw.import.note.route.one", "draw.import.note.route.other"],
  rough: ["draw.import.note.rough.one", "draw.import.note.rough.other"],
  "hand-font": ["draw.import.note.hand-font.one", "draw.import.note.hand-font.other"],
  placeholder: ["draw.import.note.placeholder.one", "draw.import.note.placeholder.other"],
  reduced: ["draw.import.note.reduced.one", "draw.import.note.reduced.other"],
};

/// I generi il cui esempio dice qualcosa: il nome di un carattere o di una
/// forma, un indirizzo, il tipo di un oggetto, un segnaposto. Gli altri
/// portano nomi interni dei due programmi, o niente.
const SAMPLED: ReadonlySet<NoteKind> = new Set<NoteKind>(["hand-font", "stencil", "image", "embed", "link", "unknown", "placeholder"]);

/// Quanto di un esempio si mostra, in caratteri.
const SAMPLE_LENGTH = 80;

/// Le note nell'ordine del rapporto.
export function reportOrder(notes: readonly Note[]): Note[] {
  const order = Object.keys(SENTENCES);
  return [...notes].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

/// La frase di `note`, con l'esempio se ne ha uno che dica qualcosa.
export function noteText(note: Note): string {
  const [one, other] = SENTENCES[note.kind];
  const sentence = plural(note.count, one, other);
  const sample = note.sample.trim();
  if (!SAMPLED.has(note.kind) || sample === "") return sentence;
  const shown = sample.length > SAMPLE_LENGTH ? `${sample.slice(0, SAMPLE_LENGTH - 1)}…` : sample;
  return `${sentence} ${t("draw.import.note.sample", { sample: shown })}`;
}

/// Quanto c'è nel disegno, in una riga: le forme, i testi, le linee, i tratti
/// a mano, le immagini, le tavole e i livelli che ci sono. Un livello solo
/// non si dice: ogni disegno ne ha uno.
export function countText(count: Count): string {
  const parts: string[] = [];
  const part = (n: number, one: Key, other: Key): void => {
    if (n > 0) parts.push(plural(n, one, other));
  };
  part(count.shapes, "draw.import.count.shapes.one", "draw.import.count.shapes.other");
  part(count.texts, "draw.import.count.texts.one", "draw.import.count.texts.other");
  part(count.lines, "draw.import.count.lines.one", "draw.import.count.lines.other");
  part(count.ink, "draw.import.count.ink.one", "draw.import.count.ink.other");
  part(count.images, "draw.import.count.images.one", "draw.import.count.images.other");
  part(count.boards, "draw.import.count.boards.one", "draw.import.count.boards.other");
  if (count.layers > 1) part(count.layers, "draw.import.count.layers.one", "draw.import.count.layers.other");
  return parts.join(", ");
}
