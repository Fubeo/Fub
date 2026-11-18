// `[[^^parole`: un blocco cercato in tutto il vault (E13, T31). La ricerca la
// fa l'indice (la foglia `block:`, dalla porta della shell); qui si leggono i
// blocchi delle note trovate, si tengono quelli che hanno tutte le parole, e
// alla scelta si scrive `[[Nota#^id]]`.
//
// Se il blocco non ha un id glielo dà il comando del nucleo
// `note.block.sync` senza nota d'arrivo (T30): una scrittura con la sua
// revisione, che controlla che fra quei byte ci sia ancora il blocco. Se l'id
// non si scrive, il link non si scrive e lo si dice; se la nota si legge
// soltanto, si offre il link alla sua sezione. Un blocco della nota aperta
// prende l'id qui, nello stesso passo del link: un annulla solo.
//
// Il modulo si carica al primo `[[^^` (`completions.ts`): porta con sé il
// modello dei blocchi.
import { ensureSyntaxTree } from "@codemirror/language";
import { closeCompletion } from "@codemirror/autocomplete";
import { EditorSelection, EditorState, type ChangeSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { errorText } from "../../../../../host/errors";
import { trackSlashRange } from "../slash";
import { liveStrings } from "../strings";
import { headingLinkText } from "../kinds";
import { blockAnchor } from "./anchor";
import { blockBytes } from "./move-to";
import { buildBlocks, subtreeEnd, type Block } from "./model";
import { stateOfSource, syncCandidates } from "./sync-to";

/// Una nota che l'indice ha trovato, col suo testo.
export interface VaultBlockNote {
  readonly doc: string;
  readonly text: string;
}

/// Perché l'id non si è scritto: la frase, e se la nota si legge soltanto.
export interface VaultBlockRefusal {
  readonly reason: string;
  readonly readOnly: boolean;
}

/// Ciò che la shell dà a `[[^^`.
export interface VaultBlockPort {
  /// Le note in cui l'indice trova `words` nello stesso blocco, già in
  /// ordine, col testo (della sessione aperta, o del file).
  notes(words: string): Promise<readonly VaultBlockNote[]>;
  /// La nota in cui si scrive.
  current(): string | null;
  /// Il testo di una nota com'è sul disco, dopo aver messo in salvo quello
  /// non salvato: i byte che il comando controllerà.
  source(doc: string): Promise<string>;
  /// L'id `id` al blocco detto in byte: `null` se è andata.
  giveId(request: { doc: string; at: readonly [number, number]; text: string; id: string }): Promise<VaultBlockRefusal | null>;
  /// Un avviso, con un gesto facoltativo.
  notify(message: string, action?: { label: string; run: () => void }): void;
}

/// Un blocco trovato.
export interface VaultBlockHit {
  readonly doc: string;
  /// Il suo indice nel modello dei blocchi della nota, quando lo si è letto.
  readonly index: number;
  /// Il testo proprio del blocco (figli esclusi), senza l'id: per
  /// ritrovarlo alla scelta.
  readonly own: string;
  /// Ciò che si mostra: il testo su una riga.
  readonly label: string;
}

const ID_AT_END = /(?:^|[ \t])\^[A-Za-z0-9-]+[ \t]*$/u;
const LONE_ID = /^\^[A-Za-z0-9-]+[ \t]*$/u;
const MARKER = /^[\s>]*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/u;
/// Quanti caratteri del blocco si mostrano.
const LABEL_MAX = 80;

/// Le parole di `[[^^`, come le confronta il blocco: minuscole e senza
/// accenti.
function folded(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

/// Il testo proprio del blocco `index`, figli esclusi, senza il suo `^id`.
function ownText(state: EditorState, blocks: readonly Block[], index: number): string {
  const block = blocks[index]!;
  const to = subtreeEnd(blocks, index) > index + 1 ? Math.max(block.from, blocks[index + 1]!.from - 1) : block.to;
  const lines = state.sliceDoc(block.from, to).split(/\r?\n/u);
  while (lines.length > 1 && (LONE_ID.test(lines[lines.length - 1]!) || lines[lines.length - 1]!.trim() === "")) lines.pop();
  const last = lines.length - 1;
  lines[last] = lines[last]!.replace(ID_AT_END, "");
  return lines.join("\n").trimEnd();
}

/// Il testo su una riga: senza i segni degli elenchi, gli spazi stretti.
function oneLine(own: string): string {
  const text = own.split("\n").map((line) => line.replace(MARKER, "").trim()).filter((line) => line !== "").join(" ");
  return text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text;
}

/// Il modello dei blocchi di uno stato, con l'albero intero.
function modelOf(state: EditorState): readonly Block[] {
  ensureSyntaxTree(state, state.doc.length, 5000);
  return buildBlocks(state).blocks;
}

/// I blocchi delle note `notes` che hanno tutte le parole di `words`, nota
/// per nota nell'ordine dell'indice; al più `limit`.
export function blocksOfNotes(notes: readonly VaultBlockNote[], words: string, limit: number): VaultBlockHit[] {
  // Le stesse parole che cerca l'indice (`vaultBlockQuery`).
  const wanted = folded(words).replace(/[()"]/gu, " ").split(/\s+/u).filter((word) => word !== "");
  if (wanted.length === 0) return [];
  const hits: VaultBlockHit[] = [];
  for (const note of notes) {
    const state = stateOfSource(note.text);
    const blocks = buildBlocks(state).blocks;
    for (const candidate of syncCandidates(state, blocks)) {
      const own = ownText(state, blocks, candidate.index);
      const text = folded(own);
      if (!wanted.every((word) => text.includes(word))) continue;
      hits.push({ doc: note.doc, index: candidate.index, own, label: oneLine(own) });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

/// Il blocco `hit` nel modello di oggi: lo stesso posto se ha lo stesso
/// testo, altrimenti il primo con quel testo; -1 se non c'è più.
function located(state: EditorState, blocks: readonly Block[], hit: VaultBlockHit): number {
  const same = (index: number) => index >= 0 && index < blocks.length && ownText(state, blocks, index) === hit.own;
  if (same(hit.index)) return hit.index;
  for (let index = 0; index < blocks.length; index++) if (same(index)) return index;
  return -1;
}

/// Il titolo sopra il blocco, come lo scrive un link: `null` se il blocco
/// sta prima di ogni titolo o il titolo non si scrive su una riga.
function sectionOf(state: EditorState, blocks: readonly Block[], index: number): string | null {
  for (let at = index - 1; at >= 0; at--) {
    if (blocks[at]!.kind !== "heading" || blocks[at]!.depth > 0) continue;
    const anchor = blockAnchor(state, blocks, at);
    return anchor.changes === null && !anchor.fragment.startsWith("^") ? headingLinkText(anchor.fragment) : null;
  }
  return null;
}

/// Dove sta il link e se si scrive ancora.
export interface VaultBlockTarget {
  /// Come il link nomina la nota del blocco: il nome, o il percorso senza
  /// estensione quando due note trovate si chiamano uguale.
  readonly name: string;
  /// Se la nota in cui si scrive si scrive ancora.
  writable(): boolean;
}

/// La scelta di un blocco: chiude il completamento subito, poi dà l'id se
/// manca e scrive il link al posto di `from..to`. `true` se il link è
/// entrato nella nota.
export async function linkVaultBlock(
  view: EditorView,
  port: VaultBlockPort,
  hit: VaultBlockHit,
  range: { from: number; to: number },
  target: VaultBlockTarget,
): Promise<boolean> {
  const tracked = trackSlashRange(view, range.from, range.to);
  // Una funzione `apply` chiude il menu da sé.
  closeCompletion(view);
  try {
    if (hit.doc === port.current()) return linkHere(view, port, hit, tracked, target);
    const state = stateOfSource(await port.source(hit.doc));
    const blocks = modelOf(state);
    const index = located(state, blocks, hit);
    if (index === -1) {
      port.notify(liveStrings.t("blocks.vault.gone", { name: target.name }));
      return false;
    }
    const anchor = blockAnchor(state, blocks, index);
    if (anchor.changes !== null) {
      if (!target.writable()) return false;
      const bytes = blockBytes(state, blocks, { first: index, last: index });
      const refused = await port.giveId({ doc: hit.doc, at: bytes.at, text: bytes.text, id: anchor.fragment.slice(1) });
      if (refused !== null) {
        if (refused.readOnly) offerSection(view, port, target, sectionOf(state, blocks, index), tracked.range());
        else port.notify(liveStrings.t("blocks.vault.failed", { reason: refused.reason }));
        return false;
      }
    }
    return insertLink(view, port, tracked.range(), `${target.name}#${anchor.fragment}`, target);
  } catch (error) {
    port.notify(liveStrings.t("blocks.vault.failed", { reason: errorText(error) }));
    return false;
  } finally {
    tracked.drop();
  }
}

/// Un blocco della nota in cui si scrive: l'id (se manca) e il link in una
/// transazione sola, con un annulla solo. Il link è `[[#^id]]`, che resta
/// giusto se la nota cambia nome.
function linkHere(
  view: EditorView,
  port: VaultBlockPort,
  hit: VaultBlockHit,
  tracked: { range(): { from: number; to: number } | null },
  target: VaultBlockTarget,
): boolean {
  const range = tracked.range();
  if (!range || !target.writable()) return false;
  const state = view.state;
  const blocks = modelOf(state);
  const index = located(state, blocks, hit);
  if (index === -1) {
    port.notify(liveStrings.t("blocks.vault.gone", { name: target.name }));
    return false;
  }
  const anchor = blockAnchor(state, blocks, index);
  return insertLink(view, port, range, `#${anchor.fragment}`, target, anchor.changes);
}

/// Scrive `link` al posto di `range`, chiuso da `]]` se non lo è già.
function insertLink(
  view: EditorView,
  port: VaultBlockPort,
  range: { from: number; to: number } | null,
  link: string,
  target: VaultBlockTarget,
  also: ChangeSpec | null = null,
): boolean {
  // Il `^^parole` che si sostituisce: se intanto è andato via, il link non ha
  // più un posto.
  if (!range || view.state.sliceDoc(range.from, range.from + 2) !== "^^" || !target.writable()) {
    port.notify(liveStrings.t("blocks.vault.orphan", { name: target.name }));
    return false;
  }
  const after = view.state.sliceDoc(range.to, range.to + 2);
  const insert = after === "]]" || after.startsWith("|") ? link : `${link}]]`;
  const changes = view.state.changes([{ from: range.from, to: range.to, insert }, ...(also ? [also] : [])]);
  view.dispatch({
    changes,
    selection: EditorSelection.cursor(changes.mapPos(range.to, 1) + (insert === link && after === "]]" ? 2 : 0)),
    scrollIntoView: true,
    userEvent: "input.complete",
  });
  view.focus();
  return true;
}

/// La nota del blocco si legge soltanto: l'id non entra, e si offre il link
/// alla sezione del blocco (o alla nota, se il blocco sta prima di ogni
/// titolo), che non chiede di scrivere niente là.
function offerSection(
  view: EditorView,
  port: VaultBlockPort,
  target: VaultBlockTarget,
  section: string | null,
  at: { from: number; to: number } | null,
): void {
  if (!at) {
    port.notify(liveStrings.t("blocks.vault.read-only", { name: target.name }));
    return;
  }
  // Il punto si segue finché la persona decide.
  const tracked = trackSlashRange(view, at.from, at.to);
  port.notify(liveStrings.t("blocks.vault.read-only", { name: target.name }), {
    label: liveStrings.t(section === null ? "blocks.vault.to-note" : "blocks.vault.to-section"),
    run: () => {
      const range = tracked.range();
      tracked.drop();
      insertLink(view, port, range, section === null ? target.name : `${target.name}#${section}`, target);
    },
  });
}
