// Il blocco sincronizzato (E14, T30) dal lato dell'editor: lo stesso blocco
// in più note, scritto `![[Nota#^id]]` (il formato che Obsidian legge). Due
// strade:
//
// - «Sincronizza in un'altra nota» dal menu del blocco: si sceglie la nota, e
//   il comando del nucleo `note.block.sync` dà l'id al blocco se manca e
//   scrive la trasclusione in fondo a quella nota, tutte e due o nessuna, con
//   un annulla solo. Qui non si tocca il documento: lo ricarica la sessione.
// - «Blocco di un'altra nota» dal «/»: si sceglie una nota e un suo blocco; il
//   comando gli dà l'id (una scrittura con la sua revisione) e la
//   trasclusione si scrive qui, al posto del «/», nel testo di questa nota.
//   Se l'id non si scrive, qui non si scrive niente e lo si dice.
//
// Nella nota che la ospita la trasclusione di un blocco è il blocco stesso,
// che si scrive sul posto (`../transclusion.ts`). La porta (`SyncBlockPort`)
// la dà chi monta l'editor (`state/sync-block.ts`): l'editor non parla con
// l'host. Il modulo si carica al primo uso.
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { errorText } from "../../../../../host/errors";
import { pickFromList } from "../../../../../ui/dialogs";
import { markdownGrammar } from "../grammar";
import { baseInsertion, revealEmbed, trackSlashRange } from "../slash";
import { liveStrings } from "../strings";
import { blockAnchor } from "./anchor";
import { blockBytes, type MoveNote } from "./move-to";
import { buildBlocks, kindName, type Block } from "./model";

/// Il blocco da sincronizzare in `to`, detto in byte del file.
export interface SyncRequest {
  readonly doc: string;
  readonly at: readonly [number, number];
  readonly text: string;
  readonly to: string;
}

/// L'id `id` al blocco detto in byte, se non ce l'ha.
export interface BlockIdRequest {
  readonly doc: string;
  readonly at: readonly [number, number];
  readonly text: string;
  readonly id: string;
}

/// Chi sincronizza davvero: le note del vault, il testo di una nota com'è sul
/// disco, e il comando. `sync` e `giveId` danno `null` se è andata,
/// altrimenti la frase che dice perché no.
export interface SyncBlockPort {
  notes(): Promise<readonly MoveNote[]>;
  source(doc: string): Promise<string>;
  sync(request: SyncRequest): Promise<string | null>;
  giveId(request: BlockIdRequest): Promise<string | null>;
}

/// Ciò che il «/» sa della nota in cui scrive.
export interface SyncSlashHost {
  /// La nota: non si sceglie un suo blocco da qui.
  readonly doc: string;
  /// Se la nota si scrive ancora, alla fine delle domande.
  writable(): boolean;
  notify(message: string): void;
}

const byName = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/// La nota, fra le altre del vault. `null` se l'utente ha chiuso.
export async function chooseSyncNote(port: SyncBlockPort, current: string, title: string): Promise<MoveNote | null> {
  const notes = [...await port.notes()]
    .filter((note) => note.id !== current)
    .sort((a, b) => byName.compare(a.title, b.title) || byName.compare(a.id, b.id));
  return pickFromList({
    title,
    placeholder: liveStrings.t("blocks.move.search"),
    items: notes.map((note) => ({ label: note.title, detail: note.id, value: note })),
  });
}

/// «Sincronizza in un'altra nota»: la nota, poi il comando. `range` dà i byte
/// del blocco quando tutto è deciso: se intanto il testo è cambiato dà
/// `null`, e non si scrive niente. L'esito buono lo dice chi sincronizza, con
/// il suo «Annulla».
export async function syncWithQuestions(
  port: SyncBlockPort,
  doc: string,
  range: () => { at: [number, number]; text: string } | null,
  notify: (message: string, tone: "info" | "guasto") => void,
): Promise<void> {
  try {
    const note = await chooseSyncNote(port, doc, liveStrings.t("blocks.sync.title"));
    if (!note) return;
    const block = range();
    if (!block) return notify(liveStrings.t("blocks.sync.gone"), "guasto");
    const failed = await port.sync({ doc, at: block.at, text: block.text, to: note.id });
    if (failed !== null) notify(liveStrings.t("blocks.sync.failed", { reason: failed }), "guasto");
  } catch (error) {
    notify(liveStrings.t("blocks.sync.failed", { reason: errorText(error) }), "guasto");
  }
}

/// Le specie di blocco che si sincronizzano dal «/»: un titolo si riporta con
/// la sua sezione (`![[Nota#Titolo]]`), le proprietà non sono un blocco.
const NOT_SYNCED: ReadonlySet<Block["kind"]> = new Set(["frontmatter", "heading"]);

/// Un blocco da scegliere: il suo indice nel modello e la prima riga.
export interface SyncCandidate {
  readonly index: number;
  readonly label: string;
  readonly detail: string;
}

/// Il modello dei blocchi di un testo, come lo leggono i Blocchi.
export function stateOfSource(text: string): EditorState {
  const state = EditorState.create({
    doc: text,
    extensions: [markdown({ base: markdownGrammar }), ...(text.includes("\r\n") ? [EditorState.lineSeparator.of("\r\n")] : [])],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

/// I blocchi di una nota che si possono sincronizzare: quelli di primo
/// livello e le voci degli elenchi, con la prima riga senza il segno.
export function syncCandidates(state: EditorState, blocks: readonly Block[]): SyncCandidate[] {
  const out: SyncCandidate[] = [];
  blocks.forEach((block, index) => {
    if (NOT_SYNCED.has(block.kind)) return;
    if (block.depth > 0 && !["bullet", "ordered", "task"].includes(block.kind)) return;
    const first = state.doc.lineAt(block.from).text
      .replace(/^[\s>]*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
      .replace(/\s\^[A-Za-z0-9-]+\s*$/, "")
      .trim();
    if (first === "" || /^\^[A-Za-z0-9-]+$/.test(first)) return;
    out.push({ index, label: first.length > 80 ? `${first.slice(0, 79)}…` : first, detail: kindName(block) });
  });
  return out;
}

/// Il nome con cui la trasclusione nomina la nota: il percorso senza
/// l'estensione delle note, che porta sempre lì.
export function syncReference(doc: string): string {
  return doc.replace(/\.(?:md|markdown)$/i, "");
}

/// «Blocco di un'altra nota» dal «/»: chiede la nota e il blocco, dà l'id al
/// blocco e scrive la trasclusione al posto di `from..to`. `true` se è
/// entrata nella nota. Il «/query» resta finché la trasclusione non c'è.
export async function syncedBlockHere(view: EditorView, from: number, to: number, port: SyncBlockPort, host: SyncSlashHost): Promise<boolean> {
  const tracked = trackSlashRange(view, from, to);
  try {
    const note = await chooseSyncNote(port, host.doc, liveStrings.t("blocks.sync.pick-note"));
    if (!note || !host.writable()) return false;
    const state = stateOfSource(await port.source(note.id));
    const blocks = buildBlocks(state).blocks;
    const candidates = syncCandidates(state, blocks);
    if (candidates.length === 0) {
      host.notify(liveStrings.t("blocks.sync.empty", { name: note.title }));
      return false;
    }
    const chosen = await pickFromList({
      title: liveStrings.t("blocks.sync.pick-block", { name: note.title }),
      placeholder: liveStrings.t("blocks.sync.search"),
      items: candidates.map((candidate) => ({ label: candidate.label, detail: candidate.detail, value: candidate })),
    });
    if (!chosen || !host.writable()) return false;
    const anchor = blockAnchor(state, blocks, chosen.index);
    const id = anchor.fragment.slice(1);
    const bytes = blockBytes(state, blocks, { first: chosen.index, last: chosen.index });
    const failed = await port.giveId({ doc: note.id, at: bytes.at, text: bytes.text, id });
    if (failed !== null) {
      host.notify(liveStrings.t("blocks.sync.failed", { reason: failed }));
      return false;
    }
    const range = tracked.range();
    if (!range || !host.writable()) {
      host.notify(liveStrings.t("blocks.sync.orphan", { name: note.title }));
      return false;
    }
    const at = baseInsertion(view.state, range.from, range.to, `![[${syncReference(note.id)}#^${id}]]`);
    view.dispatch({
      changes: { from: at.from, to: at.to, insert: at.insert },
      selection: EditorSelection.cursor(at.cursor),
      effects: revealEmbed(view.state, at.embed),
      userEvent: "input.complete",
    });
    view.focus();
    return true;
  } catch (error) {
    host.notify(liveStrings.t("blocks.sync.failed", { reason: errorText(error) }));
    return false;
  } finally {
    tracked.drop();
  }
}
