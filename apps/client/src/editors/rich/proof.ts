// Il correttore nella superficie ricca: cosa è prosa in un documento di
// videoscrittura, e come un rilievo torna a un punto del documento.
//
// Il client è lo stesso del Markdown (`editors/core/proof.ts`), con la stessa
// mappa a pezzi segmento → documento (`ProseSegment`, `locate`) e la stessa
// regola di cosa si ignora. Qui cambia soltanto l'estrazione, che è più
// semplice perché la struttura c'è già: un segmento per paragrafo, in cui
//
// - il testo è **verbatim** e torna a un intervallo esatto;
// - un a-capo o un salto è `\n`, che separa le parole senza essere prosa;
// - un oggetto (immagine, campo, nota) è `PLACEHOLDER`;
// - un segno senza larghezza (inizio di un commento, un segnalibro) sparisce,
//   e la parola che taglia resta intera.
//
// I segni sono decorazioni; il menu dei suggerimenti è quello della shell, sul
// clic destro o sul tasto del menu contestuale. Una correzione è una battuta
// dell'utente: entra nella cronologia e nella sessione come le altre.
import type { Node as PmNode } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import {
  PLACEHOLDER,
  ignoreKey,
  locate,
  type ProofClient,
  type ProofIssue,
  type ProseLocation,
  type ProsePiece,
  type ProseSegment,
} from "../core/proof";
import { t } from "../../i18n/strings";
import { showContextMenu, type MenuItem } from "../../ui/menu";
import { richSchema } from "./schema";

/// Quanto si aspetta dopo l'ultima battuta prima di chiedere.
const QUIET_MS = 400;
/// Quanti suggerimenti diventano voci del menu.
const SUGGESTED_ACTIONS = 4;

/// Il segmento di prosa di un paragrafo che comincia a `pos`, o `null` se non
/// ha lettere.
export function paragraphSegment(paragraph: PmNode, pos: number): ProseSegment | null {
  const pieces: ProsePiece[] = [];
  let text = "";
  const push = (piece: string, docFrom: number, docTo: number, verbatim: boolean) => {
    pieces.push({ start: text.length, end: text.length + piece.length, docFrom, docTo, verbatim });
    text += piece;
  };
  paragraph.forEach((child, offset) => {
    const from = pos + 1 + offset;
    const to = from + child.nodeSize;
    if (child.isText) push(child.text ?? "", from, to, true);
    else if (child.type === richSchema.nodes.brk) push("\n", from, to, false);
    else if (child.type === richSchema.nodes.atom && child.attrs.kind !== "marker") push(PLACEHOLDER, from, to, false);
  });
  if (!/[\p{L}]/u.test(text)) return null;
  return { text, from: pos + 1, to: pos + paragraph.nodeSize - 1, pieces };
}

/// I segmenti di prosa del documento, in ordine.
export function extractSegments(doc: PmNode): ProseSegment[] {
  const out: ProseSegment[] = [];
  doc.descendants((node, pos) => {
    if (node.type !== richSchema.nodes.para) return true;
    const segment = paragraphSegment(node, pos);
    if (segment) out.push(segment);
    return false;
  });
  return out;
}

interface Found {
  readonly issue: ProofIssue;
  readonly where: ProseLocation;
  readonly text: string;
  readonly key: string;
}

interface ProofState {
  readonly decorations: DecorationSet;
  readonly found: readonly Found[];
}

const key = new PluginKey<ProofState>("fub-rich-proof");

export interface RichProofOptions {
  readonly client: ProofClient;
  /// La lingua del documento (`lang` della proiezione), se la dichiara.
  readonly language: () => string | null | undefined;
  /// L'avviso di un comando del correttore (la parola aggiunta).
  readonly notify?: (message: string) => void;
}

function decorate(doc: PmNode, found: readonly Found[]): DecorationSet {
  return DecorationSet.create(
    doc,
    found.map(({ issue, where }) =>
      Decoration.inline(where.from, where.to, {
        class: `rich-proof rich-proof-${issue.kind}`,
        title: issue.message,
      }),
    ),
  );
}

/// Sostituisce `from..to` se contiene ancora `expected`: un menu rimasto
/// aperto su un testo nel frattempo cambiato non scrive niente.
export function replaceChecked(view: EditorView, from: number, to: number, expected: string, insert: string): boolean {
  if (!view.editable || view.state.doc.textBetween(from, to) !== expected) return false;
  view.dispatch(view.state.tr.insertText(insert, from, to).scrollIntoView());
  return true;
}

/// Il plugin del correttore. Il client lo chiude chi l'ha aperto.
export function richProof(options: RichProofOptions): Plugin<ProofState> {
  const ignored = new Set<string>();
  return new Plugin<ProofState>({
    key,
    state: {
      init: () => ({ decorations: DecorationSet.empty, found: [] }),
      apply(tr, value) {
        const next = tr.getMeta(key) as ProofState | undefined;
        if (next) return next;
        if (!tr.docChanged) return value;
        // Fino al prossimo controllo i segni seguono il testo; quelli che una
        // battuta ha toccato si tolgono, perché non dicono più il vero.
        const found = value.found
          .map((f) => {
            const from = tr.mapping.mapResult(f.where.from, 1);
            const to = tr.mapping.mapResult(f.where.to, -1);
            if (from.deletedAfter || to.deletedBefore || to.pos <= from.pos) return null;
            const text = tr.doc.textBetween(from.pos, to.pos);
            return text === f.text ? { ...f, where: { ...f.where, from: from.pos, to: to.pos } } : null;
          })
          .filter((f): f is Found => f !== null);
        return { found, decorations: decorate(tr.doc, found) };
      },
    },
    props: {
      decorations: (state) => key.getState(state)?.decorations,
      handleDOMEvents: {
        contextmenu(view, event) {
          const found = key.getState(view.state)?.found ?? [];
          // Dal puntatore il punto sotto di lui; dalla tastiera il cursore.
          const at = event.button === 0 && event.detail === 0 && event.clientX === 0 && event.clientY === 0
            ? view.state.selection.head
            : view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.head;
          const hit = found.find((f) => at >= f.where.from && at <= f.where.to);
          if (!hit) return false;
          event.preventDefault();
          const items = menuItems(view, hit, ignored, options, () => schedule(view, 0));
          if (event.clientX === 0 && event.clientY === 0) {
            const box = view.coordsAtPos(hit.where.from);
            showContextMenu(new MouseEvent("contextmenu", { clientX: box.left, clientY: box.bottom }), items);
          } else {
            showContextMenu(event, items);
          }
          return true;
        },
      },
    },
    view(view) {
      const stopClient = options.client.onChange(() => schedule(view, 0));
      schedule(view, 0);
      return {
        update(view, previous) {
          if (view.state.doc !== previous.doc) schedule(view, QUIET_MS);
        },
        destroy() {
          stopClient();
          cancel(view);
        },
      };
    },
  });

  // Il timer di una vista lo possiede la vista: lo cancella il prossimo
  // controllo, o la sua distruzione (`cancel`).
  function clear(view: EditorView): void {
    const timer = timers.get(view)?.timer;
    if (timer !== undefined) clearTimeout(timer);
  }

  function cancel(view: EditorView): void {
    clear(view);
    timers.delete(view);
  }

  function schedule(view: EditorView, delay: number): void {
    clear(view);
    const generation = (timers.get(view)?.generation ?? 0) + 1;
    const timer = setTimeout(() => void run(view, generation), delay);
    timers.set(view, { generation, timer });
  }

  async function run(view: EditorView, generation: number): Promise<void> {
    const state: EditorState = view.state;
    const segments = extractSegments(state.doc);
    let result;
    try {
      result = await options.client.check(segments.map((segment) => segment.text), options.language());
    } catch {
      // Un guasto del canale non deve rompere la scrittura: si riprova alla
      // prossima battuta.
      return;
    }
    // Il documento è cambiato durante l'attesa, o la superficie è chiusa: il
    // prossimo controllo è già in programma, e questo non vale più.
    const pending = timers.get(view);
    if (!pending || pending.generation !== generation || view.state.doc !== state.doc || view.isDestroyed) return;
    const found: Found[] = [];
    segments.forEach((segment, i) => {
      for (const issue of result?.segments[i] ?? []) {
        const where = locate(segment, issue.start, issue.end);
        if (!where) continue;
        const text = state.doc.textBetween(where.from, where.to);
        const ignore = ignoreKey(issue, text);
        if (ignored.has(ignore)) continue;
        found.push({ issue, where, text, key: ignore });
      }
    });
    const current = key.getState(view.state);
    if (found.length === 0 && (current?.found.length ?? 0) === 0) return;
    view.dispatch(view.state.tr.setMeta(key, { found, decorations: decorate(view.state.doc, found) }).setMeta("addToHistory", false));
  }
}

const timers = new WeakMap<EditorView, { generation: number; timer: ReturnType<typeof setTimeout> }>();

function menuItems(
  view: EditorView,
  hit: Found,
  ignored: Set<string>,
  options: RichProofOptions,
  recheck: () => void,
): MenuItem[] {
  const items: MenuItem[] = [];
  if (hit.where.exact && view.editable) {
    for (const suggestion of hit.issue.suggestions.slice(0, SUGGESTED_ACTIONS)) {
      items.push({ label: suggestion, run: () => void replaceChecked(view, hit.where.from, hit.where.to, hit.text, suggestion) });
    }
  }
  if (items.length === 0) items.push({ label: hit.issue.message, disabled: true, run: () => {} });
  if (hit.issue.kind === "spelling") {
    items.push({
      label: t("proof.add_word"),
      separator: true,
      run: () => {
        ignored.add(hit.key);
        recheck();
        options.client.addWord(hit.text).then(
          (message) => {
            if (message) options.notify?.(message);
          },
          (error: unknown) => options.notify?.(error instanceof Error ? error.message : String(error)),
        );
      },
    });
  }
  items.push({
    label: t("proof.ignore"),
    separator: hit.issue.kind !== "spelling",
    run: () => {
      ignored.add(hit.key);
      recheck();
    },
  });
  return items;
}
