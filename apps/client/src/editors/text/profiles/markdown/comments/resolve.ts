// Risolvi, Elimina e l'archivio dei risolti (D12 C).
//
// Risolvi toglie i segni dal paragrafo (il passo resta testo della nota) e
// archivia la discussione in fondo alla nota, in commenti `%%` che Fub e
// Obsidian non mostrano in lettura e che l'export toglie:
//
//     %%fub:risolto 2026-11-16 14:02: la conferma dei prestiti%%
//     %%> @Anna Bianchi 2026-11-08 17:40: Il Museo Rossi risponde entro venerdì.%%
//     %%> @Luca Ferri 2026-11-09 09:12: Confermato.%%
//
// Una riga per pezzo, perché `%%…%%` sta su una riga: la riga di testa con la
// data della risoluzione e la citazione, poi un messaggio per riga, com'era
// scritto. Le righe dell'archivio stanno in un paragrafo solo, staccato dal
// testo da una riga vuota. Dentro, `%%` si scrive `%\%` e `{==`, `{>>` hanno
// la barra davanti, così niente chiude il commento prima né apre un commento
// vivo. Elimina toglie tutto, segni e messaggi. «Svuota i risolti» toglie le
// righe dell'archivio. Ogni gesto è una transazione sola: un passo
// d'annullamento.
import type { ChangeSpec, Text } from "@codemirror/state";
import { messageHeader, oneLine, type Discussion, type MessageHeader } from "./model";

/// La riga di testa di una discussione risolta.
export const ARCHIVE_HEAD = "%%fub:risolto ";
/// La riga di un messaggio archiviato.
export const ARCHIVE_MESSAGE = "%%> ";
const CLOSE = "%%";

/// Una discussione dell'archivio.
export interface ArchivedDiscussion {
  /// Le righe che occupa, dalla testa all'ultimo messaggio.
  readonly from: number;
  readonly to: number;
  /// Quando è stata risolta, come scritto (`AAAA-MM-GG HH:MM`).
  readonly resolved: string;
  readonly quote: string;
  readonly messages: readonly MessageHeader[];
}

/// Il testo dentro una riga dell'archivio.
export function archiveEscape(text: string): string {
  return oneLine(text).replace(/%%/g, "%\\%").replace(/\{(==|>>)/g, "\\{$1").replace(/%$/, "%\\");
}

/// Il testo di una riga dell'archivio, come si legge.
export function archiveUnescape(text: string): string {
  return text.replace(/%\\$/, "%").replace(/\\\{(==|>>)/g, "{$1").replace(/%\\%/g, "%%");
}

const HEAD = /^%%fub:risolto (\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?): ?(.*)%%$/;
const MESSAGE = /^%%> (.*)%%$/;

/// Le discussioni archiviate nel testo `doc`, in ordine. Una riga di messaggio
/// senza una testa prima resta testo della nota.
export function readArchive(doc: Text): ArchivedDiscussion[] {
  const text = doc.toString();
  if (!text.includes(ARCHIVE_HEAD)) return [];
  const out: { from: number; to: number; resolved: string; quote: string; messages: MessageHeader[] }[] = [];
  let current: (typeof out)[number] | null = null;
  for (let line = 1; line <= doc.lines; line += 1) {
    const row = doc.line(line);
    const head = HEAD.exec(row.text);
    if (head) {
      current = { from: row.from, to: row.to, resolved: head[1]!, quote: archiveUnescape(head[2]!), messages: [] };
      out.push(current);
      continue;
    }
    const message = current ? MESSAGE.exec(row.text) : null;
    if (current && message) {
      current.messages.push(messageHeader(archiveUnescape(message[1]!)));
      current.to = row.to;
      continue;
    }
    current = null;
  }
  return out;
}

/// Le righe d'archivio di una discussione risolta il `resolved`.
export function archiveLines(discussion: Discussion, resolved: string, doc: Text): string {
  const lines = [`${ARCHIVE_HEAD}${resolved}: ${archiveEscape(discussion.quote)}${CLOSE}`];
  for (const message of discussion.thread.messages) {
    let body = doc.sliceString(message.from + 3, message.to - 3);
    if (discussion.inCell) body = body.replace(/\\\|/g, "|");
    lines.push(`${ARCHIVE_MESSAGE}${archiveEscape(body)}${CLOSE}`);
  }
  return lines.join("\n");
}

/// Toglie i segni di un commento: il passo resta, i messaggi se ne vanno. Un
/// commento su un punto se ne va tutto.
function unmark(discussion: Discussion): ChangeSpec[] {
  const { thread } = discussion;
  if (!thread.passage) return [{ from: thread.from, to: thread.to }];
  return [
    { from: thread.passage.from, to: thread.passage.contentFrom },
    { from: thread.passage.contentTo, to: thread.to },
  ];
}

/// Dove va l'archivio nuovo: dopo l'ultima riga d'archivio, se l'archivio
/// chiude la nota; altrimenti in fondo, staccato da una riga vuota.
function appendAt(doc: Text, lines: string): ChangeSpec {
  const archive = readArchive(doc);
  const last = archive[archive.length - 1];
  if (last && doc.sliceString(last.to).trim() === "") return { from: last.to, insert: `\n${lines}` };
  const text = doc.toString();
  const end = doc.length;
  if (text.trim() === "") return { from: 0, to: end, insert: lines };
  const newline = text.endsWith("\n");
  const gap = text.endsWith("\n\n") ? "" : newline ? "\n" : "\n\n";
  return { from: end, insert: `${gap}${lines}${newline ? "\n" : ""}` };
}

/// Risolvi: i segni via dal paragrafo, la discussione nell'archivio.
export function resolveChanges(doc: Text, discussion: Discussion, resolved: string): ChangeSpec[] {
  return [...unmark(discussion), appendAt(doc, archiveLines(discussion, resolved, doc))];
}

/// Elimina: segni e messaggi via, senza archivio.
export function deleteChanges(discussion: Discussion): ChangeSpec[] {
  return unmark(discussion);
}

/// «Svuota i risolti»: via le righe dell'archivio. Un archivio che chiude la
/// nota porta via anche la riga vuota che lo staccava, così la nota finisce
/// com'era prima del primo Risolvi. `null` se l'archivio è vuoto.
export function clearArchiveChanges(doc: Text): ChangeSpec[] | null {
  const archive = readArchive(doc);
  if (archive.length === 0) return null;
  // Le discussioni attaccate sono un tratto solo.
  const runs: { from: number; to: number }[] = [];
  for (const each of archive) {
    const last = runs[runs.length - 1];
    if (last && doc.lineAt(last.to).number + 1 === doc.lineAt(each.from).number) last.to = each.to;
    else runs.push({ from: each.from, to: each.to });
  }
  const text = doc.toString();
  return runs.map((run) => {
    if (text.slice(run.to).trim() !== "") {
      return { from: run.from, to: Math.min(doc.length, run.to + 1) };
    }
    // L'archivio chiude la nota: via anche le righe vuote prima, e resta l'a
    // capo finale se la nota lo aveva.
    let before = doc.lineAt(run.from).number - 1;
    while (before >= 1 && doc.line(before).text.trim() === "") before -= 1;
    if (before < 1) return { from: 0, to: doc.length };
    const keep = doc.line(before).to;
    return { from: text.endsWith("\n") ? keep + 1 : keep, to: doc.length };
  });
}
