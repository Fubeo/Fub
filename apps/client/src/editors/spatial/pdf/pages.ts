// Le annotazioni di un PDF nel modello del motore (formato delle annotazioni):
// i gruppi di pagina, il gruppo dove nasce un oggetto, il legame col PDF
// scritto sulla radice e il PDF che il file nomina.
//
// Il profilo `pdf` legge il modello, che cambia a ogni gesto, con le stesse
// grammatiche del lettore delle annotazioni (`scene/annotations.ts`): un
// gruppo di pagina è un `g` figlio della radice con un `fub:page` valido.
//
// Le scelte che il formato non fissa sono *(proposte del 3 ottobre 2026, da
// rivedere)*:
//
// - un oggetto nasce nell'ultimo gruppo della pagina; senza gruppi, ne nasce
//   uno, `p` e il numero su quattro cifre, dopo il gruppo della pagina
//   precedente, così i gruppi restano in ordine di numero;
// - il legame col PDF si scrive col primo gesto che cambia il file, nello
//   stesso passo di annulla, e mai all'apertura: aprire non scrive;
// - un'impronta diversa, o un numero di pagine diverso senza impronta, è un
//   PDF cambiato: si avvisa, e il legame nuovo lo scrive solo chi conferma.

import { formatNumber } from "../number";
import { digest, pageSize, positive } from "../scene/annotations";
import { pageId } from "../scene/ids";
import { IDENTITY, invert } from "../scene/matrix";
import { elementChildren, parseFragment, scopeOf, type ContainerNode, type DocumentModel, type ElementPart } from "../scene/model";
import type { AnchorOp, Op } from "../scene/ops";
import { NamespaceScope } from "../scene/serialize";
import { href } from "../scene/values";
import { NS_FUB, SVG_NS, valueOf } from "../scene/xml";
import type { Destination } from "../tools/edit";
import type { SceneIndex } from "../tools/hit";
import { readNote } from "../tools/note";

/// La pagina di un PDF A4 verticale, in punti: la misura di una pagina che
/// né il PDF né il file conoscono.
export const A4: readonly [number, number] = [595.28, 841.89];

/// Un gruppo di pagina del documento.
export interface PageGroup {
  readonly node: ContainerNode;
  readonly number: number;
  readonly size: readonly [number, number] | null;
  readonly id: string | null;
}

interface Head {
  readonly head: string;
  readonly page: number | null;
  readonly size: readonly [number, number] | null;
}

const heads = new WeakMap<ContainerNode, Head>();

/// Il numero e la misura di un `g` figlio della radice, letti dal suo tag.
function headOf(node: ContainerNode): Head {
  const cached = heads.get(node);
  if (cached !== undefined && cached.head === node.head) return cached;
  let page: number | null = null;
  let size: readonly [number, number] | null = null;
  const fragment = parseFragment(node.tail === null ? node.head : `${node.head}</${node.facts.name}>`, scopeOf(node.parent!));
  const element = fragment === null ? null : fragment.doc.element(fragment.id);
  if (element !== null) {
    page = positive(valueOf(element, NS_FUB, "page"));
    size = pageSize(valueOf(element, NS_FUB, "page-size"));
  }
  const head = { head: node.head, page, size };
  heads.set(node, head);
  return head;
}

function isPageCandidate(node: ElementPart): node is ContainerNode {
  return node.kind === "container" && node.facts.uri === SVG_NS && node.facts.local === "g";
}

/// I gruppi di pagina, in ordine di documento.
export function pageGroups(model: DocumentModel): PageGroup[] {
  const out: PageGroup[] = [];
  for (const child of elementChildren(model.root)) {
    if (!isPageCandidate(child)) continue;
    const head = headOf(child);
    if (head.page !== null) out.push({ node: child, number: head.page, size: head.size, id: child.facts.id });
  }
  return out;
}

/// I gruppi della pagina `page`.
export function groupsOf(model: DocumentModel, page: number): ContainerNode[] {
  return pageGroups(model).filter((group) => group.number === page).map((group) => group.node);
}

/// La misura che il file scrive per la pagina: quella del primo gruppo che
/// ne ha una valida.
export function writtenSize(model: DocumentModel, page: number): readonly [number, number] | null {
  return pageGroups(model).find((group) => group.number === page && group.size !== null)?.size ?? null;
}

/// Gli elementi che il foglio non mostra: figli della radice che non sono
/// pagine, né titolo, descrizione o definizioni.
export function outside(model: DocumentModel): number {
  let count = 0;
  for (const child of elementChildren(model.root)) {
    if (isPageCandidate(child) && headOf(child).page !== null) continue;
    if (child.facts.uri === SVG_NS && UNDRAWN.has(child.facts.local)) continue;
    count++;
  }
  return count;
}

const UNDRAWN = new Set(["title", "desc", "metadata", "defs", "style", "script"]);

/// Dove nasce un oggetto sulla pagina `page` di misura `size`.
///
/// Nell'ultimo gruppo della pagina che si vede; uno senza id lo riceve, `p`
/// e il numero, se è libero. Senza gruppi ne nasce uno dopo quello della
/// pagina precedente, o in testa dopo il titolo; `null` se l'id della pagina
/// è già di un altro elemento.
export function pageDestination(
  model: DocumentModel,
  index: SceneIndex,
  page: number,
  size: readonly [number, number],
  taken: (id: string) => boolean,
): Destination | null {
  const own = pageId(page);
  for (let i = index.layers.length - 1; i >= 0; i--) {
    const layer = index.layers[i]!;
    if (layer.hidden) continue;
    const inverse = invert(layer.matrix);
    if (inverse === null) continue;
    if (layer.id !== null) return { parent: layer.id, matrix: layer.matrix, inverse, prelude: [] };
    if (taken(own)) continue;
    return { parent: own, matrix: layer.matrix, inverse, prelude: [{ op: "ident", path: layer.path, tag: "g", id: own }] };
  }
  if (taken(own)) return null;
  const prelude: Op[] = [];
  let pos: { readonly after: string } | { readonly first: true } | { readonly last: true } = { first: true };
  const children = elementChildren(model.root);
  const before = pageGroups(model).filter((group) => group.number < page);
  const previous = before[before.length - 1];
  if (previous !== undefined) {
    if (previous.id !== null) {
      pos = { after: previous.id };
    } else if (!taken(pageId(previous.number))) {
      const id = pageId(previous.number);
      prelude.push({ op: "ident", path: [children.indexOf(previous.node)], tag: "g", id });
      pos = { after: id };
    } else {
      pos = { last: true };
    }
  }
  const attrs = { id: own, "fub:page": String(page), "fub:page-size": `${formatNumber(size[0], 2)} ${formatNumber(size[1], 2)}` };
  prelude.push({ op: "add", parent: "#root", pos, elem: { tag: "g", attrs, children: [] } });
  return { parent: own, matrix: IDENTITY, inverse: IDENTITY, prelude };
}

// ---------------------------------------------------------------------------
// La radice: il PDF e il legame.
// ---------------------------------------------------------------------------

/// Ciò che la radice dice del PDF.
export interface RootFacts {
  /// `fub:annotates`: assente, un percorso del vault com'è scritto, o
  /// qualcos'altro (un URL esterno, un valore vuoto).
  readonly annotates: { readonly kind: "absent" } | { readonly kind: "vault"; readonly url: string } | { readonly kind: "other" };
  readonly digest: string | null;
  readonly pages: number | null;
}

let rootCache: { readonly head: string; readonly facts: RootFacts } | null = null;

export function rootFacts(model: DocumentModel): RootFacts {
  const root = model.root;
  if (rootCache !== null && rootCache.head === root.head) return rootCache.facts;
  const fragment = parseFragment(root.tail === null ? root.head : `${root.head}</${root.facts.name}>`, NamespaceScope.EMPTY);
  const element = fragment === null ? null : fragment.doc.element(fragment.id);
  let facts: RootFacts = { annotates: { kind: "absent" }, digest: null, pages: null };
  if (element !== null) {
    const written = valueOf(element, NS_FUB, "annotates");
    const target = written === undefined ? null : href(written);
    facts = {
      annotates: target === null ? { kind: "absent" } : target.kind === "vault" ? { kind: "vault", url: target.url } : { kind: "other" },
      digest: digest(valueOf(element, NS_FUB, "digest")),
      pages: positive(valueOf(element, NS_FUB, "pages")),
    };
  }
  rootCache = { head: root.head, facts };
  return facts;
}

/// Il PDF che le annotazioni `docId` nominano, come id del vault; `null` se
/// non ne nominano uno. Senza `fub:annotates` vale il nome: `X.pdf.fubann`
/// annota `X.pdf` nella stessa cartella.
export function pdfOf(docId: string, annotates: RootFacts["annotates"]): string | null {
  const id = withoutFragment(docId);
  if (annotates.kind === "other") return null;
  if (annotates.kind === "absent") return id.toLowerCase().endsWith(".pdf.fubann") ? id.slice(0, -".fubann".length) : null;
  let path = withoutFragment(annotates.url);
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  const parts = path.startsWith("/") ? [] : id.split("/").slice(0, -1);
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") parts.push(segment);
    else if (parts.pop() === undefined) return null;
  }
  return parts.length === 0 ? null : parts.join("/");
}

function withoutFragment(id: string): string {
  const cut = id.search(/[#?]/);
  return cut < 0 ? id : id.slice(0, cut);
}

/// Il PDF letto: l'impronta dei suoi byte e quante pagine ha.
export interface PdfFacts {
  readonly digest: string;
  readonly pages: number;
}

/// Il legame fra le annotazioni e la versione del PDF che si apre.
export interface Verdict {
  /// `anchored`: le annotazioni sono di questa versione; `unanchored`: non
  /// dicono ancora di quale; `changed`: sono di un'altra.
  readonly state: "anchored" | "unanchored" | "changed";
  /// Ciò che il primo gesto scrive, nello stesso passo: le parti del legame
  /// che mancano o, con l'impronta uguale, un numero di pagine sbagliato.
  readonly op: AnchorOp | null;
}

export function verdict(written: RootFacts, pdf: PdfFacts): Verdict {
  if (written.digest !== null && written.digest !== pdf.digest) return { state: "changed", op: null };
  if (written.digest === null && written.pages !== null && written.pages !== pdf.pages) return { state: "changed", op: null };
  const missing: { digest?: string; pages?: number } = {};
  if (written.digest === null) missing.digest = pdf.digest;
  if (written.pages !== pdf.pages) missing.pages = pdf.pages;
  const op: AnchorOp | null = Object.keys(missing).length === 0 ? null : { op: "anchor", ...missing };
  return { state: written.digest === pdf.digest ? "anchored" : "unanchored", op };
}

/// L'impronta dei byte, come la scrive `fub:digest`.
export async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  let hex = "";
  for (const byte of hash) hex += byte.toString(16).padStart(2, "0");
  return `sha256:${hex}`;
}

// ---------------------------------------------------------------------------
// L'elenco per la lettura.
// ---------------------------------------------------------------------------

export interface ListedNote {
  readonly label: string;
  readonly body: string;
}

export interface ListedPage {
  readonly number: number;
  readonly notes: ListedNote[];
  /// Gli altri oggetti: tratti, evidenziazioni, forme, coperture.
  marks: number;
}

export interface Listing {
  readonly pages: readonly ListedPage[];
  /// Le note fuori dalle pagine.
  readonly outside: readonly ListedNote[];
}

/// Le note di `node` e di ciò che contiene, in ordine di documento; un
/// `text` dentro un `text` non è una nota.
function notesIn(node: ElementPart, out: ListedNote[]): void {
  if (node.kind === "leaf") {
    const note = readNote(node);
    if (note !== null) out.push(note);
    return;
  }
  for (const child of elementChildren(node)) notesIn(child, out);
}

/// Le annotazioni pagina per pagina, in ordine di numero: due gruppi con lo
/// stesso numero sono la stessa pagina.
export function listAnnotations(model: DocumentModel): Listing {
  const pages = new Map<number, ListedPage>();
  const outsideNotes: ListedNote[] = [];
  for (const child of elementChildren(model.root)) {
    const number = isPageCandidate(child) ? headOf(child).page : null;
    if (number === null || child.kind !== "container") {
      notesIn(child, outsideNotes);
      continue;
    }
    let page = pages.get(number);
    if (page === undefined) pages.set(number, (page = { number, notes: [], marks: 0 }));
    for (const object of elementChildren(child)) {
      if (object.facts.uri === SVG_NS && UNDRAWN.has(object.facts.local)) continue;
      const before = page.notes.length;
      notesIn(object, page.notes);
      if (page.notes.length === before) page.marks++;
    }
  }
  return { pages: [...pages.values()].sort((a, b) => a.number - b.number), outside: outsideNotes };
}
