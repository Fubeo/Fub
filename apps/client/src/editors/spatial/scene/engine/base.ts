// Lo stato del motore delle operazioni e ciò che le operazioni usano per
// leggerlo e cambiarlo: i riferimenti, le tavole, i simboli, le ripetizioni,
// le risorse, il testo a pezzi e la validazione (vedi `../engine.ts`).

import { BrushError, parseInkBrush } from "../../../../ink/brush";
import { inkPath } from "../../../../ink/outline";
import { decodeInk, inkToQuantized, unknownChannels } from "../../ink/codec";
import { InkError } from "../../../../ink/sample";
import { isContainer, len } from "../analysis";
import {
  classifyChild,
  describe,
  resourceKind,
  withOriginals,
  type Details,
  type Item,
  type Resolve,
} from "../classify";
import { DEFS_ID } from "../ids";
import { positive } from "../annotations";
import {
  buildDocument,
  buildFragment,
  declarationsOf,
  deepest,
  elementChildren,
  factsOf,
  idsIn,
  indentAt,
  indentOf,
  lastBreak,
  originalsIn,
  parseFragment,
  pathOf,
  placeOf,
  scopeOf,
  tagName,
  tidy,
  type ContainerNode,
  type ElementPart,
  type Part,
} from "../model";
import { MAX_IMAGE_HREF_BYTES, MAX_NESTING, MAX_VALUE_BYTES, ROOT, type Reason, type Slot, type Target } from "../ops";
import { MAX_BOARDS, MAX_RESOURCES, openSource, type ReadOnly } from "../read";
import {
  attributeName,
  attributesOf,
  canonicalOrder,
  elementToOut,
  isXmlText,
  NamespaceScope,
  rootOrder,
  writeElement,
  writeOpenTag,
  type Elem,
  type OutAttr,
  type OutElement,
  type Run,
} from "../serialize";
import { lineBreakOf, newline, normalizeEol, SourceText, utf8Length, type Measured } from "../text";
import { Tree, type HeadState } from "../tree";
import { FUB_NS, isSvg, SVG_NS, XLINK_NS } from "../xml";
import type { Follow } from "./outcome";
import {
  type Anchor,
  checkNewId,
  type Destination,
  elemGuard,
  inkDetail,
  isBlank,
  isMeta,
  isPagePaper,
  isPathTarget,
  isRecord,
  isResource,
  type Point,
  readOf,
  refsWithin,
  reject,
  type Reread,
  roleOf,
  sheetOf,
} from "./support";


/// Lo stato del motore di un documento aperto, con gli aiuti delle
/// operazioni. Lo estendono `SceneOps` e `SceneEngine`.
export abstract class SceneEngineBase {
  protected readonly tree: Tree | null;
  private readonly eol: string;
  protected raw: string;
  protected lf: string;
  /// Perché il documento è in sola lettura; vuoto se si può modificare.
  readonly readOnly: readonly ReadOnly[];
  /// La scena corrente: cambia a ogni operazione applicata, e torna quella
  /// di prima con un undo esatto.
  protected state = 0;
  protected counter = 0;
  protected items: readonly Item[] | null = null;
  /// Le coordinate dell'ultimo testo che si sono chieste: quelle del testo
  /// aperto le dà la lettura.
  protected coordinates: SourceText;
  // Lo stato di un'applicazione in corso.
  protected touched = new Set<string>();
  protected duplicate = false;
  /// Le `defs` di FubDraw che hanno perso un figlio: la raccolta toglie
  /// quella rimasta vuota.
  protected emptied = new Set<ContainerNode>();
  /// Le tavole che l'operazione tocca, con quelle delle carte che tocca, e
  /// gli id delle carte: la coerenza le guarda alla fine (formato della
  /// scena, tavole).
  protected boards = new Set<string>();
  protected papers = new Set<string>();
  /// Vero mentre si applica un'inversa del motore: il limite delle
  /// operazioni di un `batch` vale per ciò che arriva, e l'inversa di un
  /// `add` grande toglie i suoi elementi uno per uno.
  protected inverse = false;
  /// Vero mentre `undoAll` applica la sua fila: il testo si scrive una volta,
  /// alla fine.
  protected quiet = false;
  /// L'ultimo testo contato contro il limite, coi suoi byte: il prossimo,
  /// che gli somiglia, si conta da lì.
  protected measured: Measured | null = null;
  /// Ciò che segue ogni operazione applicata, nello stesso passo e nello
  /// stesso undo, a giri (vedi [`Follow`] e [`FOLLOW_ROUNDS`]); `null` per
  /// niente. Un'inversa non ha seguito: porta già l'inversa di ciò che aveva
  /// seguito l'operazione.
  follow: Follow | null = null;

  /// Che cosa è la risorsa modificabile che porta `id` nella scena corrente:
  /// ogni elemento scritto si legge con le risorse che ci sono (formato della
  /// scena, risorse).
  protected readonly resolve: Resolve = (id) => {
    const node = this.tree === null ? null : this.tree.element(id);
    if (node === null) return null;
    const role = roleOf(node);
    return role === "resource" ? resourceKind(node.facts.local) : role === "symbol" ? "symbol" : null;
  };

  protected constructor(source: string) {
    const opened = openSource(source);
    this.raw = source;
    this.lf = normalizeEol(source);
    this.eol = newline(lineBreakOf(source));
    this.readOnly = opened.readOnly;
    this.tree = opened.readOnly.length === 0 ? new Tree(buildDocument(opened.doc), opened.status, opened.doc.elements) : null;
    this.measured = { text: source, bytes: opened.text.byteLength };
    this.coordinates = opened.text;
  }

  protected get t(): Tree {
    return this.tree!;
  }

  // -------------------------------------------------------------------------
  // Riferimenti.
  // -------------------------------------------------------------------------

  /// Un bersaglio: l'elemento con quell'id, o quello senza id al percorso.
  protected target(target: unknown, reason: Reason = "missing-target"): ElementPart {
    if (typeof target === "string") {
      const node = this.t.element(target);
      if (node === null || node === this.t.model.root) reject(reason, `nessun elemento con id ${JSON.stringify(target)}`);
      return node;
    }
    if (!isPathTarget(target)) reject("invalid-elem", "bersaglio non valido");
    const node = this.walk(target.path);
    if (node === null || node === this.t.model.root || node.facts.id !== null || tagName(node) !== target.tag) {
      reject(reason, `nessun ${target.tag} senza id al percorso ${JSON.stringify(target.path)}`);
    }
    return node;
  }

  /// L'elemento al percorso, scendendo solo nei contenitori.
  protected walk(path: readonly number[]): ElementPart | null {
    let node: ElementPart = this.t.model.root;
    for (const index of path) {
      if (node.kind !== "container") return null;
      const child: ElementPart | undefined = elementChildren(node)[index];
      if (child === undefined) return null;
      node = child;
    }
    return node;
  }

  /// Un genitore: la radice, o un livello, un gruppo o un collegamento
  /// modificabile.
  protected container(ref: unknown): ContainerNode {
    if (ref === ROOT) return this.t.model.root;
    let node: ElementPart | null;
    if (typeof ref === "string") {
      node = this.t.element(ref);
    } else {
      if (!isPathTarget(ref)) reject("invalid-elem", "genitore non valido");
      node = this.walk(ref.path);
      if (node !== null && (node.facts.id !== null || tagName(node) !== ref.tag)) node = null;
    }
    if (node === null || node === this.t.model.root) reject("missing-parent", `nessun genitore ${JSON.stringify(ref)}`);
    if (node.kind !== "container") {
      if (node.details === null) reject("foreign", `${JSON.stringify(ref)} è estraneo`);
      reject("missing-parent", `${JSON.stringify(ref)} non è un livello né un gruppo`);
    }
    return node;
  }

  /// Come si indirizza `node` adesso.
  protected targetOf(node: ElementPart): Target {
    return node.facts.id ?? { path: pathOf(node), tag: tagName(node) };
  }

  private refOf(container: ContainerNode): Target {
    return container === this.t.model.root ? ROOT : this.targetOf(container);
  }

  /// Vero se un contenitore bloccato, livello, gruppo o collegamento,
  /// contiene `node`, `node` escluso.
  private lockedAbove(node: ElementPart): boolean {
    for (let c = node.parent; c !== null; c = c.parent) {
      if (c.details?.locked === true) return true;
    }
    return false;
  }

  /// Vero se in `container` non si scrive: è bloccato o sta dentro un
  /// contenitore bloccato.
  protected lockedInside(container: ContainerNode): boolean {
    return container.details?.locked === true || this.lockedAbove(container);
  }

  /// I controlli comuni su un elemento da cambiare: niente carta della
  /// pagina, niente contenitori bloccati sopra e, se `editable`, niente
  /// estranei. Un elemento bloccato si cambia: è così che si sblocca. La
  /// carta di una tavola si cambia (formato della scena, tavole); con
  /// `pagePaper` passa anche quella della pagina, e la controlla chi chiama.
  protected guard(node: ElementPart, editable: boolean, pagePaper = false): void {
    if (!pagePaper && isPagePaper(node)) reject("locked", "la carta della pagina cambia solo con page");
    if (this.lockedAbove(node)) reject("locked", "l'elemento sta in un livello o in un gruppo bloccato");
    if (editable && node.details === null) reject("foreign", "l'elemento è estraneo");
  }

  /// Vero se `container` è `node` o sta dentro `node`.
  protected within(container: ContainerNode, node: ElementPart): boolean {
    for (let c: ContainerNode | null = container; c !== null; c = c.parent) if (c === node) return true;
    return false;
  }

  protected touch(node: ElementPart): void {
    for (const id of idsIn(node)) this.touched.add(id);
  }

  // -------------------------------------------------------------------------
  // Le tavole (formato della scena, tavole).
  // -------------------------------------------------------------------------

  /// Annota `node`, se è una tavola o una carta della radice: la coerenza
  /// guarda la tavola, o quella della carta, alla fine dell'operazione. Si
  /// chiama prima di cambiare `node`, e dopo averlo aggiunto.
  protected sheet(node: ElementPart): void {
    if (node.parent !== this.t.model.root || node.details === null) return;
    const id = node.facts.id;
    if (node.details.role === "board" && id !== null) this.boards.add(id);
    if (node.details.role !== "paper") return;
    if (node.details.board !== undefined) this.boards.add(node.details.board);
    if (id !== null) this.papers.add(id);
  }

  /// Quante tavole ha il documento.
  protected boardCount(): number {
    let count = 0;
    for (const child of elementChildren(this.t.model.root)) if (roleOf(child) === "board") count++;
    return count;
  }

  /// La coerenza delle tavole, alla fine di un'operazione: ogni tavola
  /// toccata, o di una carta toccata, ha al più una carta, con la sua
  /// geometria; ogni carta toccata, o di quelle tavole, rimanda a una tavola
  /// che c'è; in un disegno con le tavole nessuna carta toccata è senza
  /// tavola, e nessuna lo è dopo la prima tavola. Un file già fuori regola
  /// altrove si modifica lo stesso. `before` sono le tavole di prima.
  protected checkBoards(before: number): void {
    if (this.boards.size === 0 && this.papers.size === 0) return;
    const root = this.t.model.root;
    const boards = new Map<string, ElementPart>();
    const papers = new Map<string, ElementPart[]>();
    const free: ElementPart[] = [];
    let count = 0;
    for (const child of elementChildren(root)) {
      const role = roleOf(child);
      if (role === "board") {
        count++;
        if (!boards.has(child.facts.id!)) boards.set(child.facts.id!, child);
      } else if (role === "paper") {
        const board = child.details!.board;
        if (board === undefined) free.push(child);
        else papers.set(board, [...(papers.get(board) ?? []), child]);
      }
    }
    if (count > MAX_BOARDS && count > before) reject("limit", `il documento supererebbe ${MAX_BOARDS} tavole`);
    const involved = new Set(this.boards);
    for (const id of this.papers) {
      const paper = this.t.element(id);
      if (paper === null || paper.parent !== root || roleOf(paper) !== "paper") continue;
      const board = paper.details!.board;
      if (board === undefined) {
        if (count > 0) reject("invalid-elem", `la carta ${id} non ha una tavola in un disegno con le tavole`);
      } else {
        involved.add(board);
      }
    }
    if (before === 0 && count > 0 && free.length > 0) {
      reject("invalid-elem", "con la prima tavola la carta della pagina diventa la sua");
    }
    for (const id of involved) {
      const own = papers.get(id) ?? [];
      const board = boards.get(id);
      if (board === undefined) {
        if (own.length > 0) reject("invalid-elem", `una carta rimanda alla tavola ${id}, che non c'è`);
        continue;
      }
      if (own.length > 1) reject("invalid-elem", `la tavola ${id} ha più di una carta`);
      const paper = own[0];
      if (paper === undefined) continue;
      const element = this.reread(paper).element;
      const box = board.details!.box!;
      const rect = [len(element, "x") ?? 0, len(element, "y") ?? 0, len(element, "width") ?? 0, len(element, "height") ?? 0];
      if (rect.some((v, i) => v !== box[i])) reject("invalid-elem", `la carta della tavola ${id} non ha la sua geometria`);
    }
  }

  // -------------------------------------------------------------------------
  // I simboli (formato della scena, simboli).
  // -------------------------------------------------------------------------

  /// Nessun simbolo che l'operazione ha cambiato, da `mark` in poi, contiene
  /// sé stesso, nemmeno attraverso altri simboli: il lettore lo direbbe
  /// estraneo, con tutte le sue istanze.
  protected checkSymbols(mark: number): void {
    const symbols = new Set<ContainerNode>();
    const owner = (node: ElementPart): void => {
      for (let at: ElementPart | null = node; at !== null; at = at.parent) {
        if (at.kind !== "container" || roleOf(at) !== "symbol") continue;
        symbols.add(at);
        return;
      }
    };
    for (const entry of this.t.since(mark)) {
      if (entry.kind === "head") owner(entry.node);
      if (entry.kind !== "splice") continue;
      owner(entry.owner);
      for (const part of entry.inserted) if (typeof part !== "string" && part.kind === "container" && roleOf(part) === "symbol") symbols.add(part);
    }
    for (const symbol of symbols) {
      if (symbol.details !== null && this.t.element(symbol.facts.id!) === symbol && this.reaches(symbol)) {
        reject("cycle", `il simbolo ${symbol.facts.id!} conterrebbe sé stesso`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Le ripetizioni (formato della scena, ripetizioni).
  // -------------------------------------------------------------------------

  /// Ogni contenitore che l'operazione ha cambiato, da `mark` in poi, ha le
  /// copie che il lettore gli troverebbe. Nessuna copia resta senza il suo
  /// originale: l'originale non se ne va, non esce dal gruppo, non perde
  /// l'id, e il gruppo resta una ripetizione finché ha copie (`in-use`).
  /// Nessun `use` estraneo diventa una copia perché un fratello è diventato
  /// il suo originale (`duplicate-id`), come non diventa un'istanza per un
  /// simbolo che arriva.
  protected checkRepeats(mark: number): void {
    const containers = new Set<ContainerNode>();
    for (const entry of this.t.since(mark)) {
      if (entry.kind === "head") containers.add(entry.node);
      else if (entry.kind === "splice") containers.add(entry.owner);
    }
    for (const container of containers) {
      const repeat = container.details?.repeat !== undefined;
      const children = elementChildren(container);
      const copies = children.filter((child) => roleOf(child) === "copy");
      if ((!repeat && copies.length === 0) || !this.attached(container)) continue;
      const originals = originalsIn(container);
      for (const copy of copies) {
        const original = copy.details!.original!;
        if (!originals.has(original)) reject("in-use", `una copia rimanda a ${original}, che non sarebbe più il suo originale`);
      }
      if (originals.size === 0) continue;
      const resolve = withOriginals(this.resolve, originals);
      for (const child of children) {
        if (child.kind !== "leaf" || child.details !== null) continue;
        const target = child.refs.find((id) => originals.has(id));
        if (target === undefined) continue;
        const fragment = parseFragment(child.raw, scopeOf(container));
        if (fragment !== null && classifyChild(fragment.doc, fragment.id, placeOf(container), container.depth + 1, resolve)?.[1] === "copy") {
          reject("duplicate-id", `il documento rimanda già a ${target}`);
        }
      }
    }
  }

  /// Vero se `node` sta nel documento: un nodo tolto tiene il suo genitore.
  private attached(node: ElementPart): boolean {
    let at = node;
    while (at.parent !== null) {
      if (!at.parent.parts.includes(at)) return false;
      at = at.parent;
    }
    return at === this.t.model.root;
  }

  /// Vero se dal contenuto di `symbol` si arriva a `symbol` attraverso i
  /// rimandi ai simboli.
  private reaches(symbol: ContainerNode): boolean {
    const seen = new Set<ContainerNode>();
    const pending: ContainerNode[] = [symbol];
    while (pending.length > 0) {
      const at = pending.pop()!;
      for (const id of refsWithin(at)) {
        const target = this.t.element(id);
        if (target === null || target.kind !== "container" || roleOf(target) !== "symbol") continue;
        if (target === symbol) return true;
        if (!seen.has(target)) {
          seen.add(target);
          pending.push(target);
        }
      }
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Le risorse del disegno (formato della scena, risorse).
  // -------------------------------------------------------------------------

  /// Gli id delle risorse modificabili che `node` è o contiene: una risorsa
  /// o un simbolo, o i figli di una `defs`; con `styles`, soltanto degli
  /// stili.
  private resourcesIn(node: ElementPart, styles = false): string[] {
    const nodes = node.kind === "container" && roleOf(node) === "defs" ? elementChildren(node) : [node];
    const out: string[] = [];
    for (const child of nodes) {
      const role = roleOf(child);
      if ((role !== "resource" && role !== "symbol") || child.facts.id === null) continue;
      if (!styles || child.details?.lifecycle === "style") out.push(child.facts.id);
    }
    return out;
  }

  /// Il primo id di una risorsa modificabile che `node` è o contiene a cui
  /// rimanda qualcosa fuori da `node`, o di uno stile che qualcuno segue;
  /// `null` se nessuno. Chi segue uno stile non sta mai in una `defs`, e
  /// `fub:style` verso una risorsa che non è uno stile non la trattiene.
  protected usedOutside(node: ElementPart): string | null {
    const ids = this.resourcesIn(node);
    if (ids.length === 0) return null;
    const followed = this.resourcesIn(node, true).find((id) => this.t.followers(id) > 0);
    if (followed !== undefined) return followed;
    // I rimandi da dentro `node`, contati come li conta l'albero.
    const inside = new Map<string, number>();
    const count = (part: ElementPart): void => {
      for (const id of part.kind === "leaf" ? part.refs : part.facts.refs) inside.set(id, (inside.get(id) ?? 0) + 1);
      if (part.kind !== "container") return;
      for (const child of part.parts) if (typeof child !== "string" && child.kind !== "other") count(child);
    };
    count(node);
    return ids.find((id) => this.t.referrers(id) > (inside.get(id) ?? 0)) ?? null;
  }

  /// I controlli sulle risorse che entrano con `nodes` (§2): nessuna ha un
  /// id a cui il documento rimanda già, e nessuno stile un id che qualcuno
  /// segue, perché chi rimanda o segue cambierebbe natura, e se `limit` il
  /// documento non ne riceve oltre il limite.
  protected checkResources(nodes: readonly ElementPart[], limit: boolean): void {
    const ids = nodes.flatMap((node) => this.resourcesIn(node));
    const styles = nodes.flatMap((node) => this.resourcesIn(node, true));
    const used = ids.find((id) => this.t.referrers(id) > 0) ?? styles.find((id) => this.t.followers(id) > 0);
    if (used !== undefined) reject("duplicate-id", `il documento rimanda già a ${used}`);
    if (limit && ids.length > 0 && this.t.resources + ids.length > MAX_RESOURCES) {
      reject("limit", `il documento supererebbe ${MAX_RESOURCES} risorse`);
    }
  }

  // -------------------------------------------------------------------------
  // Testo e pezzi.
  // -------------------------------------------------------------------------

  /// Il testo a LF scritto col terminatore del file.
  protected eolOf(text: string): string {
    return this.eol === "\n" ? text : text.replace(/\n/g, this.eol);
  }

  /// Sostituisce i pezzi `[from, to)` di `owner`, allargando la finestra
  /// agli spazi vicini perché due stringhe non restino accostate.
  protected replace(owner: ContainerNode, from: number, to: number, replacement: readonly Part[]): void {
    const parts = owner.parts;
    let items = [...replacement];
    let start = from;
    let end = to;
    if (start > 0 && typeof parts[start - 1] === "string") {
      start--;
      items = [parts[start]!, ...items];
    }
    if (end < parts.length && typeof parts[end] === "string") {
      items = [...items, parts[end]!];
      end++;
    }
    this.t.splice(owner, start, end - start, tidy(items));
  }

  /// Mette nel punto, preceduti da `gap`, un elemento o pezzi che
  /// cominciano e finiscono con un elemento.
  protected insertAt(point: Point, gap: string, parts: readonly Part[]): void {
    const { owner, index, split } = point;
    const there = owner.parts[index];
    if (typeof there === "string" && split > 0) {
      this.replace(owner, index, index + 1, [there.slice(0, split) + gap, ...parts, there.slice(split)]);
    } else {
      this.replace(owner, index, index, [gap, ...parts]);
    }
  }

  /// Toglie `node` dal suo contenitore. Se comincia una riga, va via anche
  /// l'a capo col rientro che lo precede, così non resta una riga vuota
  /// (§6). Restituisce il punto e gli spazi tolti, per rimetterlo.
  protected detach(node: ElementPart): { anchor: Anchor; gap: string } {
    const owner = node.parent!;
    if (owner.facts.id === DEFS_ID && roleOf(owner) === "defs") this.emptied.add(owner);
    const index = owner.parts.indexOf(node);
    const before = owner.parts[index - 1];
    let from = index;
    let gap = "";
    let lead = "";
    if (typeof before === "string") {
      const k = lastBreak(before);
      if (k >= 0) {
        gap = before.slice(k);
        lead = before.slice(0, k);
        from = index - 1;
      } else {
        lead = before;
      }
    }
    // Il punto si descrive dall'elemento che precede: i nodi che non sono
    // elementi non si spostano mai, e si contano.
    let skip = 0;
    let after: ElementPart | null = null;
    for (let i = (typeof before === "string" ? index - 1 : index) - 1; i >= 0; i--) {
      const part = owner.parts[i]!;
      if (typeof part === "string") continue;
      if (part.kind !== "other") {
        after = part;
        break;
      }
      skip++;
    }
    this.replace(owner, from, index + 1, from === index || lead === "" ? [] : [lead]);
    return { anchor: { owner, after, skip, lead }, gap };
  }

  /// Lo `Slot` di un punto, sulla scena corrente.
  protected slotOf(anchor: Anchor): Slot {
    return {
      parent: this.refOf(anchor.owner),
      after: anchor.after === null ? null : this.targetOf(anchor.after),
      skip: anchor.skip,
      lead: anchor.lead,
    };
  }

  /// I nodi di uno `Slot`, sulla scena corrente.
  protected anchorOf(slot: unknown): Anchor {
    if (
      !isRecord(slot)
      || (typeof slot.parent !== "string" && !isPathTarget(slot.parent))
      || (slot.after !== null && typeof slot.after !== "string" && !isPathTarget(slot.after))
      || !Number.isSafeInteger(slot.skip)
      || (slot.skip as number) < 0
      || typeof slot.lead !== "string"
      || !isBlank(slot.lead)
    ) {
      reject("invalid-elem", "punto non valido");
    }
    const owner = this.container(slot.parent);
    let after: ElementPart | null = null;
    if (slot.after !== null) {
      after = this.target(slot.after, "missing-anchor");
      if (after.parent !== owner) reject("missing-anchor", "l'elemento di riferimento ha cambiato genitore");
    }
    return { owner, after, skip: slot.skip as number, lead: slot.lead };
  }

  /// Il punto di un `Anchor` nei pezzi correnti.
  protected pointOf(anchor: Anchor): Point {
    const { owner } = anchor;
    let k = anchor.after === null ? -1 : owner.parts.indexOf(anchor.after);
    if (anchor.after !== null && k < 0) reject("missing-anchor", "l'elemento di riferimento non c'è più");
    for (let left = anchor.skip; left > 0;) {
      k++;
      const part = owner.parts[k];
      if (part === undefined || (typeof part !== "string" && part.kind !== "other")) reject("missing-anchor", "il punto non c'è più");
      if (typeof part !== "string") left--;
    }
    if (anchor.lead === "") return { owner, index: k + 1, split: 0 };
    const next = owner.parts[k + 1];
    if (typeof next !== "string" || !next.startsWith(anchor.lead)) reject("missing-anchor", "gli spazi del punto sono cambiati");
    return { owner, index: k + 1, split: anchor.lead.length };
  }

  /// Vero se un contenitore non ha figli né righe: `<g/>`, `<g></g>`.
  protected collapsed(container: ContainerNode): boolean {
    return container.tail === null || container.parts.every((part) => typeof part === "string" && lastBreak(part) < 0);
  }

  /// Dove va un elemento nuovo secondo `pos` (§2 e §6), su una riga sua.
  /// `defs` dice se è una `defs`, che con `first` va prima della carta.
  protected destination(parent: ContainerNode, pos: unknown, defs = false): Destination {
    const model = this.t.model;
    const line = (point: Point, indent: string): Destination => ({ kind: "point", point, gap: this.eolOf(`\n${indent}`) });
    const after = (anchor: ElementPart): Destination =>
      line({ owner: parent, index: parent.parts.indexOf(anchor) + 1, split: 0 }, indentOf(model, anchor));
    const inner = (): string => `${indentOf(model, parent)}  `;
    if (!isRecord(pos)) reject("invalid-elem", "posizione non valida");
    if (pos.after !== undefined) {
      const anchor = typeof pos.after === "string" ? this.t.element(pos.after) : null;
      if (anchor === null || anchor.parent !== parent) {
        reject("missing-anchor", `${JSON.stringify(pos.after)} non è un figlio del genitore`);
      }
      return after(anchor);
    }
    if (pos.first !== true && pos.last !== true) reject("invalid-elem", "posizione non valida");
    if (this.collapsed(parent)) return { kind: "empty", parent, indent: inner() };
    const children = elementChildren(parent);
    if (pos.first === true) {
      // `first` viene dopo titolo e descrizione che stanno in testa e, sotto
      // la radice, dopo le `defs` modificabili, le carte e le tavole che li
      // seguono: in fondo all'ordine visivo, non prima dei metadati. Una
      // `defs` va subito dopo titolo e descrizione, prima della carta.
      const root = parent === model.root && !defs;
      const head = (child: ElementPart): boolean => {
        const role = roleOf(child);
        return role === "defs" || role === "paper" || role === "board";
      };
      let anchor: ElementPart | null = null;
      for (const child of children) {
        if (!isMeta(child) && !(root && head(child))) break;
        anchor = child;
      }
      return anchor === null ? line({ owner: parent, index: 0, split: 0 }, inner()) : after(anchor);
    }
    // `last`: prima della riga del tag di chiusura.
    const sibling = children[children.length - 1];
    const indent = sibling === undefined ? inner() : indentOf(model, sibling);
    const end = parent.parts.length;
    const tail = parent.parts[end - 1];
    if (typeof tail === "string" && lastBreak(tail) >= 0) {
      return line({ owner: parent, index: end - 1, split: lastBreak(tail) }, indent);
    }
    return line({ owner: parent, index: end, split: 0 }, indent);
  }

  /// Il rientro della riga su cui comincia un elemento messo in `to`.
  protected indentFor(to: Destination): string {
    if (to.kind === "empty") return to.indent;
    const { owner, index, split } = to.point;
    const there = owner.parts[index];
    const lead = typeof there === "string" ? there.slice(0, split) : "";
    return indentAt(this.t.model, owner, index, lead + to.gap);
  }

  /// Mette in `to` un elemento, o pezzi che cominciano e finiscono con un
  /// elemento.
  protected place(to: Destination, parts: readonly Part[]): void {
    if (to.kind === "point") {
      this.insertAt(to.point, to.gap, parts);
      return;
    }
    // Un genitore vuoto si riscrive in forma aperta, col figlio dentro (§6).
    const { parent } = to;
    const indent = indentOf(this.t.model, parent);
    if (parent.tail === null) this.rewriteHead(parent, (attrs) => attrs, false);
    this.t.splice(parent, 0, parent.parts.length, [this.eolOf(`\n${to.indent}`), ...parts, this.eolOf(`\n${indent}`)]);
  }

  // -------------------------------------------------------------------------
  // Lettura e scrittura di un elemento.
  // -------------------------------------------------------------------------

  /// `raw` letto come figlio di `parent`; `null` se non è un elemento ben
  /// formato da solo in quello scope.
  protected build(raw: string, parent: ContainerNode): ElementPart | null {
    const fragment = parseFragment(raw, scopeOf(parent));
    return fragment === null ? null : buildFragment(fragment, parent, this.resolve);
  }

  /// Un elemento del documento riletto da solo; per un contenitore solo i
  /// tag.
  protected reread(node: ElementPart): Reread {
    const raw = node.kind === "leaf" ? node.raw : node.tail === null ? node.head : `${node.head}</${node.facts.name}>`;
    const outer = node.parent === null ? NamespaceScope.EMPTY : scopeOf(node.parent);
    const fragment = parseFragment(raw, outer);
    if (fragment === null) throw new Error("un elemento del documento non si rilegge da solo");
    return readOf(fragment, outer);
  }

  /// Cambia il tag d'apertura di un contenitore in `head`, e lo riclassifica
  /// al suo posto: deve restare un contenitore modificabile.
  protected setHead(node: ContainerNode, head: string, tail: string | null): void {
    const outer = node.parent === null ? NamespaceScope.EMPTY : scopeOf(node.parent);
    const fragment = parseFragment(tail === null ? head : `${head}</${node.facts.name}>`, outer);
    if (fragment === null) reject("invalid-elem", "il tag riscritto non si legge");
    const element = fragment.doc.element(fragment.id)!;
    let details: Details | null = null;
    if (node.parent !== null) {
      const found = classifyChild(fragment.doc, fragment.id, placeOf(node.parent), node.depth, this.resolve);
      if (found === null || !isContainer(found[1])) reject("invalid-elem", "il tag riscritto non rientra nel formato");
      details = describe(fragment.doc, fragment.id, found[0], found[1]).details;
    }
    const state: HeadState = { head, tail, facts: factsOf(fragment.doc, element), details, declarations: declarationsOf(element) };
    this.t.setHead(node, state);
  }

  /// Riscrive il tag d'apertura di un contenitore in forma canonica, con gli
  /// attributi che `change` ricava da quelli scritti. `selfClosing` dice se
  /// il tag resta autochiuso; `false` porta un `<g/>` in forma aperta.
  protected rewriteHead(node: ContainerNode, change: (attrs: OutAttr[]) => OutAttr[], selfClosing: boolean): void {
    const { fragment, element } = this.reread(node);
    const attrs = change(attributesOf(fragment.doc, element));
    const out: OutElement = {
      name: element.name,
      group: isSvg(element, "g"),
      attrs: node === this.t.model.root ? rootOrder(attrs) : canonicalOrder(attrs),
      children: [],
      text: null,
    };
    const tail = selfClosing ? null : (node.tail ?? `</${element.name}>`);
    this.setHead(node, this.eolOf(writeOpenTag(out, selfClosing)), tail);
  }

  /// Sostituisce un'unità con `raw`, riletto nella stessa posizione.
  protected replaceLeaf(node: ElementPart, raw: string): ElementPart {
    const parent = node.parent!;
    const built = this.build(raw, parent);
    if (built === null) reject("invalid-elem", "l'elemento riscritto non si legge");
    const index = parent.parts.indexOf(node);
    this.replace(parent, index, index + 1, [built]);
    return built;
  }

  /// Riscrive un'unità modificabile in forma canonica, al suo rientro, con
  /// ciò che `change` ricava dalla forma scritta.
  protected rewriteLeaf(node: ElementPart, change: (out: OutElement, read: Reread) => OutElement, read: Reread = this.reread(node)): ElementPart {
    return this.replaceLeaf(node, this.leafText(node, change, read));
  }

  /// Il testo di un'unità riscritta in forma canonica, al suo rientro (o a
  /// `indent`, se chi chiama lo sa già), con ciò che `change` ricava dalla
  /// forma scritta, `read`.
  protected leafText(node: ElementPart, change: (out: OutElement, read: Reread) => OutElement, read: Reread, indent?: string): string {
    const out = change(elementToOut(read.fragment.doc, read.fragment.id), read);
    return this.eolOf(writeElement(out, indent ?? indentOf(this.t.model, node)));
  }

  /// Il primo problema di un elemento appena scritto: estraneo, o un tratto
  /// che non si legge (S004). `null` se è modificabile tutto.
  protected problem(node: ElementPart): string | null {
    if (node.details === null) return `${tagName(node)} non rientra nel formato`;
    if (node.kind === "leaf") {
      const s004 = node.problems.find(([code]) => code === "S004");
      return s004 === undefined ? null : s004[1];
    }
    for (const part of node.parts) {
      if (typeof part === "string") continue;
      if (part.kind === "other") return "contenuto che non è un elemento";
      const inner = this.problem(part);
      if (inner !== null) return inner;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Validazione.
  // -------------------------------------------------------------------------

  /// Il numero di un gruppo di pagina: un `g` figlio della radice con
  /// `fub:page` (`annotation-format.md`, §3); `null` per ogni altro elemento.
  protected pageNumber(node: ElementPart): number | null {
    if (node.parent !== this.t.model.root || node.facts.uri !== SVG_NS || node.facts.local !== "g") return null;
    const { fragment, element } = this.reread(node);
    return positive(element.attrs.find((a) => fragment.doc.namespaces[a.ns] === FUB_NS && a.local === "page")?.value);
  }

  /// Controlla `elem` e ne fa la forma da scrivere: id nuovi, valori nei
  /// limiti, inchiostro e pennello dei tratti, `d` dei tratti ricalcolato
  /// (§4). Il resto lo giudica la classificazione, sull'elemento scritto.
  protected prepare(elem: unknown, scope: NamespaceScope, underRoot: boolean, underDefs: boolean): Elem {
    const ids = new Set<string>();
    /// `inDefs`: l'elemento è figlio di una `defs` della radice.
    const visit = (value: unknown, top: boolean, inResource: boolean, inDefs: boolean): Elem => {
      if (!isRecord(value) || typeof value.tag !== "string" || !isRecord(value.attrs)) reject("invalid-elem", "elemento non valido");
      const tag = value.tag;
      const attrs: Record<string, string> = {};
      const named = new Map<string, string>();
      for (const [key, raw] of Object.entries(value.attrs)) {
        if (typeof raw !== "string") reject("invalid-elem", `valore non stringa per ${key}`);
        const name = elemGuard(() => attributeName(key, scope));
        this.checkValue(tag, name.uri, name.local, raw);
        named.set(`${name.uri} ${name.local}`, key);
        attrs[key] = raw;
      }
      const get = (uri: string, local: string): string | undefined => {
        const key = named.get(`${uri} ${local}`);
        return key === undefined ? undefined : attrs[key];
      };
      const sheet = sheetOf(tag, get(FUB_NS, "role"), get(FUB_NS, "board"), top && underRoot);
      const layer = tag === "g" && get(FUB_NS, "layer") !== undefined;
      if (layer && !(top && underRoot)) reject("invalid-elem", "un livello sta solo sotto la radice");
      // Il gruppo di una pagina annotata ha l'id dal numero.
      const page = tag === "g" && top && underRoot ? positive(get(FUB_NS, "page")) : null;
      const id = get("", "id");
      checkNewId(tag, id, layer, inResource, inDefs, get(FUB_NS, "role"), sheet, page);
      if (id !== undefined) {
        if (ids.has(id) || (!top && this.t.has(id))) reject("duplicate-id", `id già usato: ${id}`);
        ids.add(id);
      }
      // Il contorno di un tratto lo calcola chi possiede il documento (§4).
      const tool = get(FUB_NS, "tool");
      if (tag === "path" && (tool === "pen" || tool === "highlighter")) {
        const d = this.stroke(get(FUB_NS, "ink"), get(FUB_NS, "brush"));
        if (d !== null) attrs[named.get(" d") ?? "d"] = d;
      }
      const out: { -readonly [K in keyof Elem]: Elem[K] } = { tag, attrs };
      if (value.children !== undefined) {
        if (!Array.isArray(value.children)) reject("invalid-elem", `figli non validi su ${tag}`);
        // Il contenuto di un simbolo sono oggetti, ognuno col suo id.
        const inside = inResource || (tag !== "symbol" && isResource(tag, inDefs, get(FUB_NS, "role")));
        const defs = tag === "defs" && top && underRoot;
        out.children = value.children.map((child) => visit(child, false, inside, defs));
      }
      if (value.text !== undefined) out.text = value.text as string | null;
      // I pezzi di una riga: la forma la controlla la scrittura, i valori la
      // classificazione.
      if (value.runs !== undefined) out.runs = value.runs as Run[];
      return out;
    };
    return visit(elem, true, false, underDefs);
  }

  /// `d` di un tratto da inchiostro e pennello; `null` se l'inchiostro ha
  /// canali sconosciuti e il contorno non si ricalcola (S010). Rifiuta un
  /// tratto che non si legge (S004).
  protected stroke(ink: string | undefined, brush: string | undefined): string | null {
    try {
      if (ink === undefined) throw new InkError("missing");
      const decoded = decodeInk(ink);
      if (brush === undefined) throw new BrushError("missing");
      const parsed = parseInkBrush(brush);
      if (unknownChannels(decoded) !== "") return null;
      return inkPath(inkToQuantized(decoded), parsed);
    } catch (error) {
      const detail = inkDetail(error);
      if (detail !== null) reject("invalid-elem", detail);
      if (error instanceof RangeError) reject("invalid-elem", `il contorno non si calcola: ${error.message}`);
      throw error;
    }
  }

  /// I limiti di §5 su un valore nuovo.
  protected checkValue(tag: string, uri: string, local: string, value: string): void {
    if (!isXmlText(value)) reject("invalid-elem", `carattere non ammesso da XML nel valore di ${local}`);
    const image = tag === "image" && local === "href" && (uri === "" || uri === XLINK_NS);
    const limit = image ? MAX_IMAGE_HREF_BYTES : MAX_VALUE_BYTES;
    if (utf8Length(value) > limit) reject("limit", `${local} oltre ${limit} byte`);
  }

  /// Il limite di annidamento per un elemento che finisce sotto `parent`.
  protected checkNesting(node: ElementPart, parent: ContainerNode): void {
    if (node.kind !== "container") return;
    if (deepest(node) - node.depth + parent.depth + 1 > MAX_NESTING) reject("limit", `annidamento oltre ${MAX_NESTING} livelli`);
  }
}
