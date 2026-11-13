// Il motore delle operazioni sulla scena: applica le operazioni, ne calcola
// l'inversa e consegna la `TextOperation` per la `DocumentSession`. Il
// contratto è in `docs/reference/scene-operations.md`, e i `§` dei commenti
// sono le sue sezioni.
//
// Il motore tiene la sorgente come albero di pezzi di testo (`model.ts`) e
// cambia solo i pezzi che un'operazione tocca: il resto del file, terminatori
// misti compresi, resta byte per byte com'era (§6). Ogni elemento scritto da
// un'operazione si rilegge con la classificazione del lettore
// (`classify.ts`): se il lettore non lo vedrebbe modificabile, l'operazione
// si rifiuta. Così il controllo dei valori è uno solo, e la scena in memoria
// è quella che il lettore ricava dal testo.
//
// L'inversa si calcola quando l'operazione si applica (§2). In più ogni esito
// porta un `Undo`: se arriva sulla stessa scena lasciata dall'operazione,
// rimette i nodi di prima e il file torna identico byte per byte; altrimenti
// applica l'inversa, che vale anche dopo cambiamenti altrui (§7).
//
// Il motore sta in tre strati: lo stato e i suoi aiuti (`engine/base.ts`), le
// operazioni (`engine/ops.ts`) e qui l'interfaccia pubblica, che le smista.

import type { TextOperation } from "../../core/text-operation";
import type { Item } from "./classify";
import { sceneOperation } from "./diff";
import { DEFS_ID } from "./ids";
import {
  buildFragment,
  deriveItems,
  layout,
  materialize,
  parseFragments,
  rememberHead,
  scopeKey,
  scopeOf,
  type ContainerNode,
  type DocumentModel,
  type ElementPart,
} from "./model";
import { MAX_BATCH, ROOT, type BatchOp, type Op } from "./ops";
import { MAX_EDIT_BYTES, MAX_ELEMENTS, readScene, type Status } from "./read";
import { attributesOf, canonicalOrder, NamespaceScope } from "./serialize";
import { normalizeEol, SourceText, utf8Length, utf8LengthFrom, type Measured } from "./text";
import { Tree, type Entry } from "./tree";
import { FOLLOW_ROUNDS, type Outcome, type Rejected, type Replayed, Undo } from "./engine/outcome";
import {
  chain,
  indentAfterBreak,
  isRecord,
  LEAF_RUN_MAX,
  LEAF_RUN_MIN,
  type LeafRun,
  OP_NAMES,
  readOf,
  reject,
  Rejection,
  type Reread,
  roleOf,
} from "./engine/support";
import { SceneOps } from "./engine/ops";

export { FOLLOW_ROUNDS, Undo } from "./engine/outcome";
export type { Applied, Follow, Outcome, Rejected, Replayed } from "./engine/outcome";
export { reindent } from "./engine/support";

/// Ciò che rende esatto un undo: il registro dell'operazione e le due scene
/// fra cui vale. Fuori dal modulo non si vede.
interface Exact {
  readonly engine: SceneEngine;
  readonly entries: readonly Entry[];
  /// La scena prima dell'operazione, a cui l'undo riporta.
  readonly before: number;
  /// La scena lasciata dall'operazione: l'undo è esatto solo da qui.
  readonly after: number;
}

const EXACT = new WeakMap<Undo, Exact>();

/// Un undo solo per due operazioni applicate una dopo l'altra, come la pila
/// le fonde (§7): annulla tutte e due con l'inversa di `first`, e il suo redo
/// le ripete con l'operazione in avanti di `second`. Vale se le due sono
/// `set` sulle stesse chiavi degli stessi elementi, anche in due `batch` con
/// lo stesso ordine, e se `second` è stata applicata subito dopo `first` e
/// sullo stesso motore: l'undo resta esatto. Altrimenti `null`.
export function mergeUndo(first: Undo, second: Undo): Undo | null {
  const a = EXACT.get(first);
  const b = EXACT.get(second);
  if (a === undefined || b === undefined || a.engine !== b.engine || a.after !== b.before) return null;
  if (!sameSets(first.forward, second.forward)) return null;
  const merged = new Undo(first.inverse, second.forward, [...new Set([...first.touched, ...second.touched])]);
  EXACT.set(merged, { engine: a.engine, entries: [...a.entries, ...b.entries], before: a.before, after: b.after });
  return merged;
}

/// Vero se `a` e `b` cambiano le stesse chiavi degli stessi elementi: due
/// `set`, o due `batch` di `set` nello stesso ordine. Allora l'inversa di `a`
/// rimette anche tutto ciò che `b` ha cambiato.
function sameSets(a: Op, b: Op): boolean {
  if (a.op === "set" && b.op === "set") {
    const keys = Object.keys(a.attrs);
    return (
      a.id === b.id &&
      (a.part ?? []).join() === (b.part ?? []).join() &&
      keys.length === Object.keys(b.attrs).length &&
      keys.every((key) => Object.prototype.hasOwnProperty.call(b.attrs, key))
    );
  }
  if (a.op === "batch" && b.op === "batch") {
    return a.ops.length === b.ops.length && a.ops.every((op, i) => sameSets(op, b.ops[i]!));
  }
  return false;
}

/// Il motore di un documento aperto.
export class SceneEngine extends SceneOps {
  private constructor(source: string) {
    super(source);
  }

  /// Apre `source`, il testo intero del file. Lancia `ReadError` se non è
  /// una scena.
  static open(source: string): SceneEngine {
    return new SceneEngine(source);
  }

  /// Il testo grezzo corrente.
  get text(): string {
    return this.raw;
  }

  /// Il testo corrente a LF, quello della `DocumentSession`.
  get normalized(): string {
    return this.lf;
  }

  /// `null` per un documento in sola lettura.
  get status(): Status | null {
    return this.tree === null ? null : this.tree.status;
  }

  /// L'albero del documento, per chi lo disegna (`painter/`): si legge e
  /// non si modifica. Un nodo che un'operazione non tocca resta lo stesso
  /// oggetto, e su questo il painter misura che cosa ridisegnare. `null` per
  /// un documento in sola lettura, che la superficie mostra intero come
  /// immagine inerte.
  get model(): DocumentModel | null {
    return this.tree === null ? null : this.tree.model;
  }

  /// L'elemento che porta `id`, o l'unità estranea che lo contiene: il
  /// painter ci risolve i riferimenti di un blocco estraneo verso il resto
  /// del documento.
  holder(id: string): ElementPart | null {
    return this.tree === null ? null : this.tree.holder(id);
  }

  /// Le voci della scena corrente, le stesse che il lettore ricava dal testo.
  scene(): readonly Item[] {
    if (this.items === null) {
      if (this.tree === null) {
        this.items = readScene(this.raw).items;
      } else {
        layout(this.tree.model);
        this.items = deriveItems(this.tree.model, this.source());
      }
    }
    return this.items;
  }

  /// Le coordinate del testo corrente, coi terminatori del file: sono quelle
  /// degli span delle voci di [`scene`]. Si ricavano una volta per testo.
  source(): SourceText {
    if (this.coordinates.text !== this.raw) this.coordinates = new SourceText(this.raw);
    return this.coordinates;
  }

  /// Applica `op`: tutta oppure niente.
  apply(op: Op): Outcome {
    const tree = this.tree;
    if (tree === null) {
      return { outcome: "rejected", reason: "read-only", detail: `documento in sola lettura: ${this.readOnly.join(", ")}` };
    }
    const mark = tree.mark();
    this.touched = new Set();
    this.duplicate = false;
    this.emptied = new Set();
    this.boards = new Set();
    this.papers = new Set();
    // La raccolta guarda soltanto i riferimenti che toglie questa operazione.
    tree.orphans();
    const boards = this.boardCount();
    let forward: Op = op;
    let inverse: Op;
    try {
      inverse = this.run(op);
      const followed = this.inverse ? null : this.followed(tree, op);
      if (followed !== null) {
        forward = chain([op, ...followed.ops]);
        inverse = chain([...followed.inverses.reverse(), inverse]);
      }
      this.checkSymbols(mark);
      this.checkRepeats(mark);
      const { removes, restores } = this.collect();
      if (!this.inverse) this.checkBoards(boards);
      if (removes.length > 0) {
        forward = chain([forward, ...removes]);
        inverse = chain([...restores.reverse(), inverse]);
      }
    } catch (error) {
      tree.rollback(mark);
      if (!(error instanceof Rejection)) throw error;
      const first = error.indices[0];
      return first === undefined
        ? { outcome: "rejected", reason: error.reason, detail: error.detail }
        : { outcome: "rejected", reason: error.reason, detail: error.detail, index: first };
    }
    return this.commit(tree.take(mark), forward, inverse, [...this.touched], this.duplicate, null);
  }

  /// Ciò che segue l'operazione `requested` appena applicata, applicato
  /// anche lui, a giri: le operazioni dei giri in ordine, e le loro inverse
  /// nell'ordine in cui si sono applicate; `null` se non c'è niente. Il
  /// primo giro vede tutto ciò che l'operazione ha toccato, ogni giro dopo
  /// soltanto ciò che il giro prima ha toccato in più, e ci si ferma al
  /// giro in cui non c'è niente di nuovo, o a [`FOLLOW_ROUNDS`] giri. Un giro
  /// che il motore rifiuta, o che non si sa calcolare, non c'è: si tengono i
  /// giri prima e ci si ferma, con ciò che hanno toccato.
  private followed(
    tree: Tree,
    requested: Op,
  ): { readonly ops: Op[]; readonly inverses: Op[] } | null {
    if (this.follow === null) return null;
    const ops: Op[] = [];
    const inverses: Op[] = [];
    let fresh: ReadonlySet<string> = new Set(this.touched);
    for (let round = 0; round < FOLLOW_ROUNDS && (round === 0 || fresh.size > 0); round++) {
      const next = this.followRound(tree, requested, fresh);
      if (next === null) break;
      ops.push(next.op);
      inverses.push(next.inverse);
      fresh = next.touched;
    }
    return ops.length === 0 ? null : { ops, inverses };
  }

  /// Un giro del seguito: ciò che `follow` dice dopo aver visto `touched`,
  /// applicato con la sua inversa, e gli id che ha toccato in più; `null` se
  /// non dice niente, se non si sa calcolare o se il motore lo rifiuta, e
  /// allora il giro non lascia niente nella scena.
  private followRound(
    tree: Tree,
    requested: Op,
    touched: ReadonlySet<string>,
  ): { readonly op: Op; readonly inverse: Op; readonly touched: ReadonlySet<string> } | null {
    let op: Op | null;
    try {
      op = this.follow!(tree.model, touched, requested);
    } catch {
      return null;
    }
    if (op === null) return null;
    if (op.op === "batch" && op.label !== undefined) op = { op: "batch", ops: op.ops };
    const mark = tree.mark();
    const { touched: before, duplicate, emptied, boards, papers } = this;
    this.touched = new Set(before);
    this.emptied = new Set(emptied);
    this.boards = new Set(boards);
    this.papers = new Set(papers);
    try {
      const inverse = this.run(op);
      const added = new Set<string>();
      for (const id of this.touched) if (!before.has(id)) added.add(id);
      return { op, inverse, touched: added };
    } catch (error) {
      tree.rollback(mark);
      if (!(error instanceof Rejection)) throw error;
      this.touched = before;
      this.duplicate = duplicate;
      this.emptied = emptied;
      this.boards = boards;
      this.papers = papers;
      return null;
    }
  }

  /// Annulla l'operazione di `undo`: esattamente, se la scena è quella che
  /// l'operazione ha lasciato; altrimenti con l'inversa, che è rifiutata se
  /// il bersaglio è cambiato altrove (§7).
  undo(undo: Undo): Outcome {
    const exact = EXACT.get(undo);
    const tree = this.tree;
    if (tree !== null && exact !== undefined && exact.engine === this && exact.after === this.state) {
      const mark = tree.mark();
      tree.undo(exact.entries);
      return this.commit(tree.take(mark), undo.inverse, undo.forward, undo.touched, false, exact.before);
    }
    this.inverse = true;
    try {
      return this.apply(undo.inverse);
    } finally {
      this.inverse = false;
    }
  }

  /// Annulla gli undo di `undos`, uno dopo l'altro, come `undo`, e si ferma
  /// al primo rifiutato. Il testo si scrive una volta sola, alla fine: mille
  /// passi costano poco più di uno, e il cambiamento è uno, dal testo di
  /// prima a quello di dopo (§7).
  undoAll(undos: readonly Undo[]): Replayed {
    const before = this.lf;
    const done: Undo[] = [];
    const touched = new Set<string>();
    let rejected: Rejected | null = null;
    this.quiet = true;
    try {
      for (const undo of undos) {
        const outcome = this.undo(undo);
        if (outcome.outcome === "rejected") {
          rejected = outcome;
          break;
        }
        done.push(outcome.undo);
        for (const id of outcome.touched) touched.add(id);
      }
    } finally {
      this.quiet = false;
      if (done.length > 0) {
        this.raw = materialize(this.tree!.model);
        this.lf = normalizeEol(this.raw);
      }
    }
    return { undos: done, rejected, touched: [...touched], operation: sceneOperation(before, this.lf), text: this.raw };
  }

  /// Chiude un'applicazione: il testo nuovo, la `TextOperation` e l'undo.
  /// `target` è la scena a cui riporta un undo esatto; `null` per una scena
  /// nuova, che deve stare nei limiti. Nella fila di `undoAll` il testo
  /// resta indietro, e lo scrive lei alla fine: un undo esatto non lo
  /// guarda nemmeno, l'inversa solo per i limiti.
  private commit(
    entries: Entry[],
    forward: Op,
    inverse: Op,
    touched: readonly string[],
    duplicate: boolean,
    target: number | null,
  ): Outcome {
    const tree = this.tree!;
    const before = this.state;
    let operation: TextOperation = { beforeLength: this.lf.length, afterLength: this.lf.length, edits: [] };
    if (entries.length > 0) {
      const raw = this.quiet && target !== null ? null : materialize(tree.model);
      const measured = raw !== null && target === null ? this.measure(raw) : null;
      if (measured !== null && (measured.bytes > MAX_EDIT_BYTES || tree.elements > MAX_ELEMENTS)) {
        const mark = tree.mark();
        tree.undo(entries);
        tree.take(mark);
        return {
          outcome: "rejected",
          reason: "limit",
          detail: `il documento supererebbe ${MAX_EDIT_BYTES} byte o ${MAX_ELEMENTS} elementi`,
        };
      }
      if (measured !== null) this.measured = measured;
      if (raw !== null && !this.quiet) {
        const lf = normalizeEol(raw);
        operation = sceneOperation(this.lf, lf);
        this.raw = raw;
        this.lf = lf;
      }
      this.items = null;
      this.state = target ?? ++this.counter;
    }
    const undo = new Undo(inverse, forward, touched);
    EXACT.set(undo, { engine: this, entries, before, after: this.state });
    return { outcome: "applied", forward, inverse, touched, operation, text: this.raw, duplicate, undo };
  }

  /// `raw`, un testo appena scritto, coi suoi byte UTF-8.
  private measure(raw: string): Measured {
    return { text: raw, bytes: this.measured === null ? utf8Length(raw) : utf8LengthFrom(this.measured, raw) };
  }

  // -------------------------------------------------------------------------
  // Le operazioni.
  // -------------------------------------------------------------------------

  private run(op: unknown): Op {
    if (!isRecord(op) || !OP_NAMES.has(op.op)) {
      reject("invalid-elem", `operazione sconosciuta: ${JSON.stringify(isRecord(op) ? op.op : op)}`);
    }
    if (op.op === "batch") return this.batch(op);
    if (op.op === "adopt") return this.adopt(op);
    // Un SVG estraneo resta com'è finché «Modifica» non lo adotta (formato
    // della scena, §2).
    if (this.t.status === "foreign") reject("foreign", "il documento non è un disegno di Fub: si modifica dopo «Modifica»");
    switch (op.op) {
      case "add":
        return "slot" in op ? this.restore(op) : this.add(op);
      case "remove":
        return this.remove(op);
      case "set":
        return this.set(op);
      case "text":
        return this.text_(op);
      case "move":
        return "slot" in op ? this.moveBack(op) : this.move(op);
      case "ident":
        return this.ident(op);
      case "page":
        return this.page(op);
      case "anchor":
        return this.anchor(op);
      default:
        return this.meta(op);
    }
  }

  private batch(op: Record<string, unknown>): Op {
    const ops = op.ops;
    if (!Array.isArray(ops)) reject("invalid-elem", "batch senza ops");
    if (op.label !== undefined && typeof op.label !== "string") reject("invalid-elem", "etichetta non stringa");
    const count = (list: readonly unknown[]): number =>
      list.reduce<number>(
        (sum, inner) => sum + (isRecord(inner) && inner.op === "batch" && Array.isArray(inner.ops) ? count(inner.ops) : 1),
        0,
      );
    if (!this.inverse && count(ops) > MAX_BATCH) reject("limit", `batch oltre ${MAX_BATCH} operazioni`);
    const inverses: Op[] = [];
    // Fino a `slow` un'operazione alla volta: un tratto di `set` che non si
    // è potuto applicare in un passaggio solo.
    let slow = 0;
    for (let i = 0; i < ops.length; i++) {
      if (i >= slow) {
        const run = this.leafRun(ops, i);
        if (run.nodes.length >= LEAF_RUN_MIN) {
          const end = i + run.nodes.length;
          const done = this.setLeaves(ops, i, run);
          if (done !== null) {
            for (const each of done) inverses.push(each);
            i = end - 1;
            continue;
          }
          slow = end;
        }
      }
      try {
        inverses.push(this.run(ops[i]));
      } catch (error) {
        if (error instanceof Rejection) error.indices.unshift(i);
        throw error;
      }
    }
    const inverse: BatchOp = { op: "batch", ops: inverses.reverse() };
    return typeof op.label === "string" ? { ...inverse, label: op.label } : inverse;
  }

  /// Il tratto di `ops` che comincia in `from` e si applica in un passaggio
  /// solo: `set` su altrettante unità diverse, modificabili e non risorse,
  /// ciascuna a capo di una riga (il loro rientro viene dallo spazio che le
  /// precede, e un `set` sulle altre non lo cambia). Un'operazione che non è
  /// così, o che sarebbe rifiutata, non ne fa parte, e va da sola.
  private leafRun(ops: readonly unknown[], from: number): LeafRun {
    const run: LeafRun = { nodes: [], raws: [], indices: [] };
    const tree = this.t;
    if (tree.status === "foreign") return run;
    const seen = new Set<ElementPart>();
    for (let at = from; at < ops.length && run.nodes.length < LEAF_RUN_MAX; at++) {
      const op = ops[at];
      if (!isRecord(op) || op.op !== "set" || typeof op.id !== "string" || op.id === ROOT || op.part !== undefined || !isRecord(op.attrs)) break;
      const node = tree.element(op.id);
      if (node === null || node === tree.model.root || node.kind !== "leaf" || seen.has(node) || roleOf(node) === "resource") break;
      const parts = node.parent!.parts;
      const index = parts.indexOf(node);
      const before = parts[index - 1];
      if (typeof before !== "string" || (before.indexOf("\n") < 0 && before.indexOf("\r") < 0)) break;
      seen.add(node);
      run.nodes.push(node);
      run.raws.push(node.raw);
      run.indices.push(index);
    }
    return run;
  }

  /// Applica `ops` da `from`, un tratto `run` di [`SceneEngine.leafRun`], in
  /// un passaggio solo: le unità si rileggono insieme, si calcolano tutti i
  /// testi nuovi, e anche questi si leggono insieme, invece di una lettura
  /// per ogni passo. Il risultato è quello di un'operazione dopo l'altra:
  /// stesse inverse, stesse modifiche all'albero nello stesso ordine.
  /// `null` se qualcosa non va, e allora l'albero è com'era e chi chiama
  /// applica un'operazione alla volta, con gli errori che ne vengono.
  private setLeaves(ops: readonly unknown[], from: number, run: LeafRun): Op[] | null {
    const tree = this.t;
    const mark = tree.mark();
    let done: Op[] | null;
    try {
      done = this.leafPass(ops, from, run);
    } catch {
      done = null;
    }
    if (done === null) tree.rollback(mark);
    return done;
  }

  private leafPass(ops: readonly unknown[], from: number, run: LeafRun): Op[] | null {
    const { nodes, raws: olds, indices } = run;
    const parents = new Map<ContainerNode, number[]>();
    for (let k = 0; k < nodes.length; k++) {
      const node = nodes[k]!;
      this.guard(node, true, true);
      const group = parents.get(node.parent!);
      if (group === undefined) parents.set(node.parent!, [k]);
      else group.push(k);
    }
    // Le unità come sono scritte, e ciò che ogni `set` ne ricava.
    const reads: Reread[] = new Array<Reread>(nodes.length);
    const scopes = new Map<ContainerNode, NamespaceScope>();
    for (const [parent, which] of parents) {
      const outer = scopeOf(parent);
      scopes.set(parent, outer);
      const fragments = parseFragments(which.map((k) => olds[k]!), outer);
      if (fragments === null) return null;
      which.forEach((k, j) => (reads[k] = readOf(fragments[j]!, outer)));
    }
    const inverses: Op[] = [];
    const papers: boolean[] = [];
    const texts: string[] = new Array<string>(nodes.length);
    for (let k = 0; k < nodes.length; k++) {
      const node = nodes[k]!;
      const op = ops[from + k] as Record<string, unknown>;
      const read = reads[k]!;
      const { previous, edit, paper } = this.planSet(node, op.attrs as Record<string, unknown>, read);
      const before = node.parent!.parts[indices[k]! - 1] as string;
      texts[k] = this.leafText(node, (out, again) => ({ ...out, attrs: canonicalOrder(edit(attributesOf(again.fragment.doc, again.element))) }), read, indentAfterBreak(before));
      papers.push(paper);
      inverses.push({ op: "set", id: op.id as string, attrs: previous });
    }
    // Le unità nuove, lette insieme anch'esse.
    const built: ElementPart[] = new Array<ElementPart>(nodes.length);
    for (const [parent, which] of parents) {
      const scope = scopes.get(parent)!;
      const fragments = parseFragments(which.map((k) => texts[k]!), scope);
      if (fragments === null) return null;
      // Chi segue legge le unità appena riscritte, e le trova già lette.
      const key = this.follow === null ? null : scopeKey(scope);
      which.forEach((k, j) => {
        const now = buildFragment(fragments[j]!, parent, this.resolve);
        built[k] = now;
        if (key !== null && now.kind === "leaf") rememberHead(now, key, fragments[j]!);
      });
    }
    // Poi, una dopo l'altra, al posto delle vecchie.
    for (let k = 0; k < nodes.length; k++) {
      const node = nodes[k]!;
      const now = built[k]!;
      // Una risorsa cambia come si leggono le unità che la citano, e quelle
      // si sono lette tutte prima: la strada lunga.
      if (roleOf(now) === "resource") return null;
      const parent = node.parent!;
      const index = parent.parts[indices[k]!] === node ? indices[k]! : parent.parts.indexOf(node);
      this.replace(parent, index, index + 1, [now]);
      this.checkRewritten(now, papers[k]!);
    }
    for (const node of nodes) {
      this.sheet(node);
      this.touch(node);
    }
    return inverses;
  }

  /// La raccolta, alla fine di ogni operazione applicata (§2): le risorse
  /// `private` e `shared` a cui l'operazione ha tolto l'ultimo riferimento se
  /// ne vanno, poi quelle rimaste sole per questo, e infine la `defs` di
  /// FubDraw rimasta vuota. Un campione resta, come una risorsa senza ciclo
  /// di vita, e così uno stile. Restituisce i `remove` fatti, in ordine, e le loro inverse.
  private collect(): { removes: Op[]; restores: Op[] } {
    const removes: Op[] = [];
    const restores: Op[] = [];
    const drop = (node: ElementPart): void => {
      const target = this.targetOf(node);
      removes.push({ op: "remove", target });
      restores.push(this.remove({ op: "remove", target }));
    };
    for (let lost = this.t.orphans(); lost.length > 0; lost = this.t.orphans()) {
      for (const id of lost) {
        const node = this.t.element(id);
        // Una risorsa senza ciclo di vita resta anche sola, e così un
        // campione e uno stile.
        const lifecycle = node?.details?.lifecycle;
        if (node !== null && (lifecycle === "private" || lifecycle === "shared")) drop(node);
      }
    }
    for (const defs of [...this.emptied]) {
      if (this.t.element(DEFS_ID) === defs && defs.parts.every((part) => typeof part === "string")) drop(defs);
    }
    return { removes, restores };
  }
}
