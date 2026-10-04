// L'albero degli oggetti: il disegno come elenco, sincronizzato con la scena
// e con la selezione. È la via al disegno per chi non vede il foglio, e per
// chi vuole scegliere un oggetto senza puntarlo.
//
// - **Il dato è quello della scena.** Le voci le dà l'editor, dalle voci del
//   testo e dall'indice degli oggetti che il foglio tocca: nessun secondo
//   calcolo, e un oggetto si sceglie qui solo se si sceglie sul foglio.
// - **Un albero ARIA.** `role="tree"` con più scelte, il fuoco sull'albero e la
//   riga attiva in `aria-activedescendant`: le righe non prendono il fuoco,
//   quindi possono sparire e tornare senza che il fuoco si perda. Livello,
//   posizione e numero dei fratelli sono attributi, così anche le righe non
//   disegnate contano.
// - **La selezione segue il fuoco.** Le frecce scelgono la riga a cui
//   arrivano; con Ctrl o ⌘ ci arrivano soltanto, Spazio aggiunge o toglie,
//   Maiusc estende. Un livello non è un oggetto: arrivarci non sceglie niente,
//   e Spazio sceglie i suoi oggetti.
// - **Mai il solo colore.** Una riga scelta ha il segno di spunta; un livello
//   aperto o chiuso, la sua freccia; un oggetto che non si sceglie, il
//   corsivo, e il suo livello dice a parole perché.
// - **Virtualizzato** oltre [`VIRTUAL_AFTER`] righe: si disegnano quelle che si
//   vedono, più qualcuna, e la riga attiva.

import { plural, t } from "../strings";
import { identifier, stableIdentifier } from "../../../ui/a11y";
import type { Lifetime } from "../../../ui/lifetime";

/// Oltre questo numero di righe l'albero disegna solo quelle che si vedono.
export const VIRTUAL_AFTER = 500;

/// L'altezza di una riga quando l'albero è virtualizzato: un bersaglio da
/// 44 px, come ogni bersaglio del livello Essenziale.
export const ROW_PX = 44;

/// Le righe disegnate oltre quelle che si vedono, sopra e sotto.
const OVERSCAN = 8;

/// Una voce dell'albero.
export interface TreeEntry {
  readonly key: string;
  /// Un livello: si apre e si chiude, e non si sceglie.
  readonly layer: boolean;
  /// Si sceglie: un oggetto di un livello bloccato o nascosto no.
  readonly selectable: boolean;
  readonly children: readonly TreeEntry[];
  /// Il nome a parole; si chiede solo per le righe disegnate.
  label(): string;
}

export interface ObjectTreeOptions {
  /// La selezione nuova, in ordine di documento.
  onSelect(keys: readonly string[]): void;
  /// Invio su un oggetto: le sue proprietà.
  onActivate(): void;
  onDelete(): void;
  /// Esc: il fuoco torna al foglio.
  onLeave(): void;
}

export interface ObjectTree {
  /// Il pannello: titolo, conteggio e albero.
  readonly element: HTMLElement;
  /// Le voci e la selezione di adesso. Se il fuoco non è nell'albero, la riga
  /// attiva va al primo oggetto scelto.
  update(entries: readonly TreeEntry[], selection: readonly string[], count: number): void;
  focus(): void;
  /// Riscrive i testi nella lingua di adesso.
  relabel(): void;
}

interface Row {
  readonly entry: TreeEntry;
  readonly level: number;
  readonly setsize: number;
  readonly posinset: number;
  /// L'indice della riga del livello che la contiene; `-1` in cima.
  readonly parent: number;
}

export function createObjectTree(life: Lifetime, options: ObjectTreeOptions): ObjectTree {
  const element = document.createElement("section");
  element.className = "draw-objects";
  element.id = identifier("draw-objects");
  const header = document.createElement("div");
  header.className = "draw-objects-header";
  const heading = document.createElement("h2");
  heading.className = "draw-objects-title";
  heading.id = identifier("draw-objects-title");
  const counter = document.createElement("span");
  counter.className = "draw-objects-count";
  header.append(heading, counter);
  const empty = document.createElement("p");
  empty.className = "draw-objects-empty";
  const scroller = document.createElement("div");
  scroller.className = "draw-objects-scroll";
  const tree = document.createElement("div");
  tree.className = "draw-objects-tree";
  tree.setAttribute("role", "tree");
  tree.setAttribute("aria-multiselectable", "true");
  tree.setAttribute("aria-labelledby", heading.id);
  tree.tabIndex = 0;
  scroller.append(tree);
  element.setAttribute("aria-labelledby", heading.id);
  element.append(header, empty, scroller);

  const prefix = identifier("draw-object");
  let entries: readonly TreeEntry[] = [];
  let rows: Row[] = [];
  let count = 0;
  let selected = new Set<string>();
  /// I livelli chiusi: un livello nuovo nasce aperto.
  const collapsed = new Set<string>();
  let active: string | null = null;
  let anchor: string | null = null;

  const flatten = (): void => {
    rows = [];
    const visit = (list: readonly TreeEntry[], level: number, parent: number): void => {
      list.forEach((entry, index) => {
        const at = rows.length;
        rows.push({ entry, level, setsize: list.length, posinset: index + 1, parent });
        if (entry.layer && !collapsed.has(entry.key)) visit(entry.children, level + 1, at);
      });
    };
    visit(entries, 1, -1);
  };

  const indexOf = (key: string | null): number => (key === null ? -1 : rows.findIndex((row) => row.entry.key === key));

  const rowId = (key: string): string => stableIdentifier(prefix, key);

  /// Le righe disegnate per chiave: una riga che resta è lo stesso nodo, e
  /// uno screen reader non la sente cambiare.
  let rendered = new Map<string, HTMLElement>();

  /// Scrive `row` nel nodo `item`, nuovo o di prima.
  const paintRow = (item: HTMLElement, row: Row, index: number, virtual: boolean): void => {
    const { entry } = row;
    if (item.childElementCount === 0) {
      item.className = "draw-object";
      item.setAttribute("role", "treeitem");
      const mark = document.createElement("span");
      mark.className = "draw-object-mark";
      mark.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "draw-object-label";
      item.append(mark, label);
    }
    item.id = rowId(entry.key);
    item.dataset.key = entry.key;
    item.dataset.index = String(index);
    item.setAttribute("aria-level", String(row.level));
    item.setAttribute("aria-setsize", String(row.setsize));
    item.setAttribute("aria-posinset", String(row.posinset));
    if (entry.layer) {
      item.setAttribute("aria-expanded", String(!collapsed.has(entry.key)));
      item.removeAttribute("aria-selected");
    } else {
      item.setAttribute("aria-selected", String(selected.has(entry.key)));
      item.removeAttribute("aria-expanded");
    }
    if (!entry.layer && !entry.selectable) item.setAttribute("aria-disabled", "true");
    else item.removeAttribute("aria-disabled");
    item.toggleAttribute("data-active", entry.key === active);
    const [mark, label] = item.children as unknown as [HTMLElement, HTMLElement];
    const glyph = entry.layer ? (collapsed.has(entry.key) ? "▸" : "▾") : "✓";
    if (mark.textContent !== glyph) mark.textContent = glyph;
    const text = entry.label();
    if (label.textContent !== text) label.textContent = text;
    item.style.position = virtual ? "absolute" : "";
    item.style.top = virtual ? `${index * ROW_PX}px` : "";
    item.style.height = virtual ? `${ROW_PX}px` : "";
  };

  /// Le righe da disegnare: tutte, o quelle che si vedono e l'attiva.
  const windowOf = (virtual: boolean): number[] => {
    if (!virtual) return rows.map((_, index) => index);
    const first = Math.max(0, Math.floor(scroller.scrollTop / ROW_PX) - OVERSCAN);
    const visible = Math.ceil((scroller.clientHeight || ROW_PX * 12) / ROW_PX);
    const last = Math.min(rows.length - 1, first + visible + 2 * OVERSCAN);
    const indices: number[] = [];
    for (let index = first; index <= last; index++) indices.push(index);
    const current = indexOf(active);
    if (current >= 0 && (current < first || current > last)) indices.push(current);
    return indices;
  };

  const render = (): void => {
    counter.textContent = plural(count, "draw.describe.parts.one", "draw.describe.parts.other");
    empty.hidden = rows.length > 0;
    scroller.hidden = rows.length === 0;
    if (indexOf(active) < 0) active = rows[0]?.entry.key ?? null;
    const virtual = rows.length > VIRTUAL_AFTER;
    tree.toggleAttribute("data-virtual", virtual);
    tree.style.height = virtual ? `${rows.length * ROW_PX}px` : "";
    const next = new Map<string, HTMLElement>();
    const nodes = windowOf(virtual).map((index) => {
      const row = rows[index]!;
      const item = rendered.get(row.entry.key) ?? document.createElement("div");
      paintRow(item, row, index, virtual);
      next.set(row.entry.key, item);
      return item;
    });
    for (const [key, item] of rendered) if (!next.has(key)) item.remove();
    rendered = next;
    nodes.forEach((node, index) => {
      if (tree.children[index] !== node) tree.insertBefore(node, tree.children[index] ?? null);
    });
    if (active === null) tree.removeAttribute("aria-activedescendant");
    else tree.setAttribute("aria-activedescendant", rowId(active));
  };

  /// Porta in vista la riga attiva.
  const reveal = (): void => {
    const index = indexOf(active);
    if (index < 0) return;
    if (rows.length > VIRTUAL_AFTER) {
      const top = index * ROW_PX;
      const height = scroller.clientHeight;
      if (top < scroller.scrollTop) scroller.scrollTop = top;
      else if (height > 0 && top + ROW_PX > scroller.scrollTop + height) scroller.scrollTop = top + ROW_PX - height;
      render();
    } else {
      tree.querySelector(`[data-index="${index}"]`)?.scrollIntoView?.({ block: "nearest" });
    }
  };

  const selectable = (index: number): boolean => {
    const row = rows[index];
    return row !== undefined && !row.entry.layer && row.entry.selectable;
  };

  /// La selezione in ordine di righe, che è l'ordine del documento.
  const ordered = (keys: Set<string>): string[] => rows.filter((row) => keys.has(row.entry.key)).map((row) => row.entry.key);

  const choose = (keys: Set<string>): void => {
    selected = keys;
    options.onSelect(ordered(keys));
  };

  /// Le righe che si scelgono fra `from` e `to`, comprese.
  const range = (from: number, to: number): Set<string> => {
    const keys = new Set<string>();
    for (let index = Math.min(from, to); index <= Math.max(from, to); index++) if (selectable(index)) keys.add(rows[index]!.entry.key);
    return keys;
  };

  /// Porta la riga attiva a `index`: `select` la sceglie da sola, `extend`
  /// sceglie dall'ancora fin lì, `focus` ci arriva soltanto.
  const moveTo = (index: number, mode: "select" | "extend" | "focus"): void => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (row === undefined) return;
    active = row.entry.key;
    const at = indexOf(active);
    if (mode === "extend") {
      const from = indexOf(anchor);
      choose(range(from < 0 ? at : from, at));
    } else if (mode === "select") {
      anchor = active;
      choose(selectable(at) ? new Set([active]) : new Set());
    }
    render();
    reveal();
  };

  const toggle = (index: number): void => {
    const row = rows[index];
    if (row === undefined) return;
    anchor = row.entry.key;
    if (row.entry.layer) {
      choose(new Set(row.entry.children.filter((child) => child.selectable).map((child) => child.key)));
    } else if (row.entry.selectable) {
      const next = new Set(selected);
      if (!next.delete(row.entry.key)) next.add(row.entry.key);
      choose(next);
    }
    render();
  };

  const setExpanded = (key: string, open: boolean): void => {
    if (open) collapsed.delete(key);
    else collapsed.add(key);
    flatten();
    render();
  };

  /// Le righe che stanno in una pagina dell'albero.
  const page = (): number => Math.max(1, Math.floor((scroller.clientHeight || ROW_PX * 10) / ROW_PX) - 1);

  life.listen(tree, "keydown", (event) => {
    const at = indexOf(active);
    const row = rows[at];
    const mod = event.ctrlKey || event.metaKey;
    const mode = event.shiftKey ? "extend" : mod ? "focus" : "select";
    switch (event.key) {
      case "ArrowDown":
        moveTo(at + 1, mode);
        break;
      case "ArrowUp":
        moveTo(at - 1, mode);
        break;
      case "PageDown":
        moveTo(at + page(), mode);
        break;
      case "PageUp":
        moveTo(at - page(), mode);
        break;
      case "Home":
        moveTo(0, mode);
        break;
      case "End":
        moveTo(rows.length - 1, mode);
        break;
      case "ArrowRight":
        if (row?.entry.layer) {
          if (collapsed.has(row.entry.key)) setExpanded(row.entry.key, true);
          else if (row.entry.children.length > 0) moveTo(at + 1, mode);
        }
        break;
      case "ArrowLeft":
        if (row?.entry.layer && !collapsed.has(row.entry.key)) setExpanded(row.entry.key, false);
        else if (row !== undefined && row.parent >= 0) moveTo(row.parent, mode);
        break;
      case " ":
        if (at >= 0) toggle(at);
        break;
      case "Enter":
        if (row?.entry.layer) {
          setExpanded(row.entry.key, collapsed.has(row.entry.key));
        } else if (row !== undefined && row.entry.selectable) {
          if (!selected.has(row.entry.key)) {
            anchor = row.entry.key;
            choose(new Set([row.entry.key]));
            render();
          }
          options.onActivate();
        }
        break;
      case "Delete":
      case "Backspace":
        if (selected.size === 0) return;
        options.onDelete();
        break;
      case "Escape":
        options.onLeave();
        break;
      case "a":
      case "A":
        if (!mod || event.shiftKey || event.altKey) return;
        choose(range(0, rows.length - 1));
        render();
        break;
      default:
        return;
    }
    event.preventDefault();
    // L'editor non deve vedere il tasto: le frecce, qui, non spostano niente.
    event.stopPropagation();
  });

  const rowOf = (target: EventTarget | null): number => {
    const item = target instanceof Element ? target.closest<HTMLElement>(".draw-object") : null;
    return item === null ? -1 : Number(item.dataset.index);
  };

  life.listen(tree, "click", (event) => {
    const index = rowOf(event.target);
    const row = rows[index];
    if (row === undefined) return;
    tree.focus({ preventScroll: true });
    if (row.entry.layer) {
      active = row.entry.key;
      setExpanded(row.entry.key, collapsed.has(row.entry.key));
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      active = row.entry.key;
      toggle(index);
      return;
    }
    moveTo(index, event.shiftKey ? "extend" : "select");
  });

  life.listen(tree, "dblclick", (event) => {
    const row = rows[rowOf(event.target)];
    if (row !== undefined && !row.entry.layer && row.entry.selectable) options.onActivate();
  });

  life.listen(scroller, "scroll", () => {
    if (rows.length > VIRTUAL_AFTER) render();
  });

  const relabel = (): void => {
    heading.textContent = t("draw.objects");
    empty.textContent = t("draw.objects.empty");
    render();
  };

  return {
    element,
    update(next, selection, total) {
      entries = next;
      count = total;
      selected = new Set(selection);
      flatten();
      const following = !tree.contains(document.activeElement);
      const first = following ? rows.find((row) => selected.has(row.entry.key))?.entry.key ?? null : null;
      if (first !== null && first !== active) {
        active = first;
        anchor = first;
        render();
        reveal();
      } else {
        render();
      }
    },
    focus() {
      tree.focus({ preventScroll: true });
    },
    relabel,
  };
}
