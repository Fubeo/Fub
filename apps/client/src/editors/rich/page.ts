// La pagina delle sezioni nella superficie ricca: dimensione, orientamento,
// margini e colonne. Una sezione la porta sul suo segno di fine
// (`section.attrs.page`), l'ultima sul documento (`doc.attrs.page`). Un
// formato senza pagina (l'odt) non ne ha nessuna, e la striscia non la offre.
//
// Le regole sono quelle del codec (`Page::write` in `fub-format-rich`): qui
// servono a non offrire una pagina che il salvataggio rifiuterebbe.
import type { Command, EditorState } from "prosemirror-state";
import type { Page } from "./projection";

export { PAPER_SIZES } from "./paper.generated";

/// I lati di una pagina, in punti.
export const MIN_PAGE_SIDE = 7.2;
export const MAX_PAGE_SIDE = 1584;
/// Lo spazio minimo che i margini lasciano al testo, in ogni verso.
export const MIN_TEXT_ROOM = 36;
export const MAX_COLUMNS = 12;

/// I margini già pronti di Word, in punti.
export const MARGIN_PRESETS: readonly { readonly id: string; readonly top: number; readonly bottom: number; readonly left: number; readonly right: number }[] = [
  { id: "normal", top: 72, bottom: 72, left: 72, right: 72 },
  { id: "narrow", top: 36, bottom: 36, left: 36, right: 36 },
  { id: "moderate", top: 72, bottom: 72, left: 54, right: 54 },
  { id: "wide", top: 72, bottom: 72, left: 144, right: 144 },
];

/// Dove sta la pagina della sezione del cursore: la posizione del suo segno
/// di fine, o `null` per l'ultima sezione (quella del documento).
export interface PageAt {
  readonly page: Page;
  readonly pos: number | null;
}

/// La pagina della sezione dove sta il cursore, se il formato ne ha una.
export function pageAt(state: EditorState): PageAt | null {
  const doc = state.doc;
  const index = state.selection.$from.index(0);
  let pos = 0;
  for (let i = 0; i < doc.childCount; i += 1) {
    const child = doc.child(i);
    if (i >= index && child.type.name === "section") {
      const page = child.attrs.page as Page | null;
      return page ? { page, pos } : null;
    }
    pos += child.nodeSize;
  }
  const page = doc.attrs.page as Page | null;
  return page ? { page, pos: null } : null;
}

export function columns(page: Page): number {
  return page.cols ?? 1;
}

export function landscape(page: Page): boolean {
  return page.w > page.h;
}

/// Il nome della carta, in un verso o nell'altro, entro mezzo punto.
export function paperName(page: Page, sizes: readonly { name: string; w: number; h: number }[]): string | null {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  const hit = sizes.find((s) => (near(s.w, page.w) && near(s.h, page.h)) || (near(s.w, page.h) && near(s.h, page.w)));
  return hit ? hit.name : null;
}

/// Un valore come lo conserva un `.docx`: al ventesimo di punto.
export function twips(points: number): number {
  return Math.round(points * 20) / 20;
}

/// La pagina, se il codec la accetta.
export function validPage(page: Page): boolean {
  const lengths = [page.w, page.h, page.top, page.bottom, page.left, page.right];
  if (!lengths.every(Number.isFinite)) return false;
  if ([page.w, page.h].some((side) => side < MIN_PAGE_SIDE || side > MAX_PAGE_SIDE)) return false;
  if ([page.top, page.bottom, page.left, page.right].some((margin) => margin < 0)) return false;
  if (page.left + page.right > page.w - MIN_TEXT_ROOM || page.top + page.bottom > page.h - MIN_TEXT_ROOM) return false;
  const cols = columns(page);
  return Number.isInteger(cols) && cols >= 1 && cols <= MAX_COLUMNS;
}

export function samePage(a: Page | null, b: Page | null): boolean {
  if (!a || !b) return a === b;
  return a.w === b.w && a.h === b.h && a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.right === b.right && columns(a) === columns(b);
}

/// Una pagina con i valori arrotondati come li riscrive il codec, senza
/// `cols` quando è una.
function normal(page: Page): Page {
  const cols = columns(page);
  return {
    w: twips(page.w),
    h: twips(page.h),
    top: twips(page.top),
    bottom: twips(page.bottom),
    left: twips(page.left),
    right: twips(page.right),
    ...(cols !== 1 ? { cols } : {}),
  };
}

/// Cambia la pagina della sezione del cursore con ciò che `change` ne fa.
/// Non si applica senza una pagina o con una pagina che il codec
/// rifiuterebbe; se non cambia niente, riesce senza una transazione.
export function changePage(change: (page: Page) => Page): Command {
  return (state, dispatch) => {
    const at = pageAt(state);
    if (!at) return false;
    const next = normal(change(at.page));
    if (!validPage(next)) return false;
    if (dispatch && !samePage(next, at.page)) {
      const tr = at.pos === null ? state.tr.setDocAttribute("page", next) : state.tr.setNodeAttribute(at.pos, "page", next);
      dispatch(tr);
    }
    return true;
  };
}

/// La pagina girata: i lati si scambiano, i margini restano dove sono.
export function setLandscape(wide: boolean): Command {
  return changePage((page) => (landscape(page) === wide ? page : { ...page, w: page.h, h: page.w }));
}

/// Una carta nel verso della pagina di adesso.
export function setPaper(w: number, h: number): Command {
  return changePage((page) => {
    const [short, long] = w <= h ? [w, h] : [h, w];
    return landscape(page) ? { ...page, w: long, h: short } : { ...page, w: short, h: long };
  });
}

export function setMargins(margins: { top: number; bottom: number; left: number; right: number }): Command {
  return changePage((page) => ({ ...page, ...margins }));
}

export function setColumns(cols: number): Command {
  return changePage((page) => ({ ...page, cols }));
}
