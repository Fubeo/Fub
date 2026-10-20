// Ciò che si incolla o si trascina nella superficie ricca, prima che diventi
// documento.
//
// Ogni `k` della proiezione è opaco e il ritorno al documento lo decodifica:
// uno che il documento non ha mai avuto (HTML di un'altra applicazione, un
// altro documento di Word aperto accanto, dati fabbricati negli appunti)
// romperebbe il salvataggio o porterebbe riferimenti che qui non esistono.
// Quindi, in quello che entra:
//
// - un `k` resta soltanto se è del documento (`known`); altrimenti il
//   paragrafo e il tratto prendono le proprietà del posto in cui arrivano,
//   come «unisci formattazione» di Word;
// - un oggetto con un `k` sconosciuto cade: non c'è niente a cui rimandare;
//   uno nuovo, senza `k`, entra se è un'immagine o una nota che il formato
//   sa scrivere;
// - un oggetto che il documento può mostrare una volta sola (una nota, una
//   casella di testo, un segno di commento o di segnalibro) e una sezione
//   entrano soltanto se non ci sono già: tagliare e incollare li sposta,
//   copiare non li duplica. Un trascinamento interno è uno spostamento, e
//   l'originale esce nella stessa transazione;
// - una tabella con un `k` sconosciuto diventa i suoi paragrafi;
// - un collegamento resta soltanto verso il web, la posta o un punto del
//   documento: il salvataggio lo scriverebbe nel file com'è, e un altro
//   programma lo aprirebbe.
import { Fragment, Slice, type Node as PmNode } from "prosemirror-model";
import { imageMime, richSchema, UNIQUE_ATOMS } from "./schema";
import type { AtomKind } from "./projection";

export interface PasteContext {
  /// Ogni `k` che il documento ha avuto da quando è aperto.
  readonly known: ReadonlySet<string>;
  /// I `k` degli oggetti unici e delle sezioni che il documento ha adesso.
  readonly present: ReadonlySet<string>;
  /// Un trascinamento dentro la superficie, che sposta invece di copiare.
  readonly moving: boolean;
}

/// I `k` di tutto ciò che `node` contiene: paragrafi, tratti, oggetti, sezioni,
/// tabelle, righe e celle.
export function collectKeys(node: PmNode, into: Set<string>): void {
  node.descendants((child) => {
    const k = child.attrs.k ?? child.attrs.sect;
    if (typeof k === "string") into.add(k);
    for (const mark of child.marks) {
      if (mark.type === richSchema.marks.run) into.add(mark.attrs.k as string);
    }
    return true;
  });
}

/// I `k` degli oggetti unici e delle sezioni in `doc`.
export function uniqueKeys(doc: PmNode): Set<string> {
  const out = new Set<string>();
  doc.descendants((child) => {
    if (child.type === richSchema.nodes.section) out.add(child.attrs.sect as string);
    else if (child.type === richSchema.nodes.atom && UNIQUE_ATOMS.has(child.attrs.kind as AtomKind) && child.attrs.k !== null) {
      out.add(child.attrs.k as string);
    }
    return true;
  });
  return out;
}

/// Un indirizzo che un collegamento può portare nel documento.
export function safeHref(href: string): boolean {
  if (href.startsWith("#")) return true;
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(href).protocol);
  } catch {
    return false;
  }
}

function newAtom(node: PmNode): boolean {
  const { kind, data, note } = node.attrs;
  if (kind === "image") return typeof data === "string" && imageMime(data) !== null && note === null;
  return kind === "note" && typeof note === "string" && data === null;
}

class Filter {
  /// Gli oggetti unici già entrati con questo incolla.
  readonly #taken = new Set<string>();

  constructor(private readonly context: PasteContext) {}

  #admitsUnique(k: string): boolean {
    if (!this.context.known.has(k)) return false;
    if (this.#taken.has(k)) return false;
    if (!this.context.moving && this.context.present.has(k)) return false;
    this.#taken.add(k);
    return true;
  }

  #inline(node: PmNode): PmNode | null {
    const { known } = this.context;
    const schema = richSchema;
    if (node.type === schema.nodes.atom) {
      const k = node.attrs.k as string | null;
      // Un oggetto nuovo porta tutto con sé: un'immagine che il formato sa
      // scrivere o il testo di una nota. Copiato, è un oggetto nuovo in più,
      // come in Word. Il segno di un commento nuovo si trascina, non si copia:
      // il commento ne ha uno solo.
      if (k === null) return newAtom(node) || (this.context.moving && node.attrs.comment !== null) ? node : null;
      const unique = UNIQUE_ATOMS.has(node.attrs.kind as AtomKind);
      if (unique ? !this.#admitsUnique(k) : !known.has(k)) return null;
      return node;
    }
    let marks = node.marks;
    const run = schema.marks.run.isInSet(marks);
    if (run && !known.has(run.attrs.k as string)) marks = run.removeFromSet(marks);
    const link = schema.marks.link.isInSet(marks);
    if (link && !safeHref(link.attrs.href as string)) marks = link.removeFromSet(marks);
    return marks === node.marks ? node : node.mark(marks);
  }

  #para(node: PmNode): PmNode {
    const children: PmNode[] = [];
    node.forEach((child) => {
      const kept = this.#inline(child);
      if (kept) children.push(kept);
    });
    const k = node.attrs.k as string | null;
    const attrs = k !== null && !this.context.known.has(k) ? { ...node.attrs, k: null } : node.attrs;
    return node.type.create(attrs, children, node.marks);
  }

  /// I blocchi filtrati di `fragment`, dentro il documento o una cella.
  blocks(fragment: Fragment): PmNode[] {
    const out: PmNode[] = [];
    fragment.forEach((node) => out.push(...this.block(node)));
    return out;
  }

  block(node: PmNode): PmNode[] {
    const schema = richSchema;
    if (node.type === schema.nodes.para) return [this.#para(node)];
    if (node.type === schema.nodes.section) {
      return this.#admitsUnique(node.attrs.sect as string) ? [node] : [];
    }
    if (node.type === schema.nodes.table) {
      // Una tabella nuova non ha ancora `k`: resta una tabella.
      const keysKnown = (n: PmNode) => n.attrs.k === null || this.context.known.has(n.attrs.k as string);
      let whole = keysKnown(node);
      node.forEach((row) => {
        whole &&= keysKnown(row);
        row.forEach((cell) => {
          whole &&= keysKnown(cell);
        });
      });
      if (!whole) {
        // La tabella di un altro documento: restano i suoi paragrafi.
        const out: PmNode[] = [];
        node.forEach((row) => row.forEach((cell) => out.push(...this.blocks(cell.content))));
        return out;
      }
      const rows: PmNode[] = [];
      node.forEach((row) => {
        const cells: PmNode[] = [];
        row.forEach((cell) => {
          const content = this.blocks(cell.content);
          cells.push(cell.type.create(cell.attrs, content.length > 0 ? content : [schema.nodes.para.create()]));
        });
        rows.push(row.type.create(row.attrs, cells));
      });
      return [node.type.create(node.attrs, rows)];
    }
    if (node.isInline) {
      const kept = this.#inline(node);
      return kept ? [kept] : [];
    }
    // Una riga o una cella sciolta (un pezzo di tabella selezionato): i suoi
    // blocchi, perché fuori da una tabella non stanno.
    return this.blocks(node.content);
  }
}

/// La fetta da inserire al posto di `slice`, con le regole sopra.
export function filterSlice(slice: Slice, context: PasteContext): Slice {
  // Una fetta aperta dentro una tabella (testo copiato da una cella) porta
  // tabella, riga e cella come involucri aperti: si scende fino a ciò che fu
  // selezionato davvero, o si incollerebbe una tabella nuova.
  const { table, row, cell } = richSchema.nodes;
  while (
    slice.content.childCount === 1 &&
    slice.openStart > 0 &&
    slice.openEnd > 0 &&
    [table, row, cell].includes(slice.content.firstChild!.type)
  ) {
    slice = new Slice(slice.content.firstChild!.content, slice.openStart - 1, slice.openEnd - 1);
  }
  const filter = new Filter(context);
  const nodes: PmNode[] = [];
  let inline = true;
  slice.content.forEach((node) => {
    if (!node.isInline) inline = false;
  });
  if (inline) {
    slice.content.forEach((node) => nodes.push(...filter.block(node)));
    return new Slice(Fragment.from(nodes), slice.openStart, slice.openEnd);
  }
  const blocks = filter.blocks(slice.content);
  if (blocks.length === 0) return Slice.empty;
  // Le estremità aperte restano tali soltanto se ancora paragrafi: un blocco
  // diventato altro (una tabella sciolta) si inserisce chiuso.
  const openStart = blocks[0].type === richSchema.nodes.para ? Math.min(slice.openStart, 1) : 0;
  const openEnd = blocks[blocks.length - 1].type === richSchema.nodes.para ? Math.min(slice.openEnd, 1) : 0;
  return new Slice(Fragment.from(blocks), openStart, openEnd);
}
