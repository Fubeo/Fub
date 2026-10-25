// La pagina delle sezioni nella superficie ricca: dimensione, orientamento,
// margini e colonne. Una sezione la porta sul suo segno di fine
// (`section.attrs.page`), l'ultima sul documento (`doc.attrs.page`). Un
// formato senza pagina (l'odt) non ne ha nessuna, e la striscia non la offre.
//
// Le regole sono quelle del codec (`Page::write` in `fub-format-rich`): qui
// servono a non offrire una pagina che il salvataggio rifiuterebbe.
import type { Command, EditorState } from "prosemirror-state";
import { t, type Key } from "../../i18n/strings";
import { writeRunning, type Page, type PageField, type Piece, type RunningText } from "./projection";

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
/// di fine, o `null` per l'ultima sezione (quella del documento), con
/// l'intestazione e il piè di pagina della sezione.
export interface PageAt {
  readonly page: Page;
  readonly pos: number | null;
  readonly header: RunningText | null;
  readonly footer: RunningText | null;
}

/// La pagina della sezione dove sta il cursore, se il formato ne ha una.
export function pageAt(state: EditorState): PageAt | null {
  const doc = state.doc;
  const index = state.selection.$from.index(0);
  let pos = 0;
  for (let i = 0; i < doc.childCount; i += 1) {
    const child = doc.child(i);
    if (i >= index && child.type.name === "section") return own(child.attrs, pos);
    pos += child.nodeSize;
  }
  return own(doc.attrs, null);
}

function own(attrs: Record<string, unknown>, pos: number | null): PageAt | null {
  const page = attrs.page as Page | null;
  if (!page) return null;
  return { page, pos, header: attrs.header as RunningText | null, footer: attrs.footer as RunningText | null };
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

/// Le unità in cui la striscia mostra le misure, come Word: rientri e margini
/// in centimetri, spazi e interlinea esatta in punti.
export type LengthUnit = "cm" | "pt";

/// Le cifre dopo la virgola che ogni unità mostra.
const DECIMALS: Readonly<Record<LengthUnit, number>> = { cm: 2, pt: 1 };

/// Una misura in punti, scritta nell'unità `unit` con il separatore decimale
/// della lingua (la virgola in italiano) e senza separatore delle migliaia.
export function formatLength(points: number, unit: LengthUnit, language: string): string {
  const value = unit === "cm" ? (points * 2.54) / 72 : points;
  return new Intl.NumberFormat(language, { maximumFractionDigits: DECIMALS[unit], useGrouping: false }).format(value);
}

/// Una misura scritta da chi usa la striscia, in punti al ventesimo come la
/// conserva un `.docx`. Vale la virgola o il punto, e l'unità in fondo si può
/// scrivere o no; `null` se il campo è vuoto, `undefined` se non è un numero.
export function parseLength(text: string, unit: LengthUnit): number | null | undefined {
  const bare = text.trim().replace(new RegExp(`\\s*${unit}$`, "i"), "").replace(",", ".");
  if (bare === "") return null;
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(bare)) return undefined;
  const value = Number(bare);
  return twips(unit === "cm" ? (value * 72) / 2.54 : value);
}

/// Il nome della carta nella lingua della shell: quello di Word, dove c'è.
const PAPER_KEYS: Readonly<Record<string, Key>> = {
  Letter: "rich.paper.letter",
  Legal: "rich.paper.legal",
  "Envelope #10": "rich.paper.envelope_10",
  "Envelope DL": "rich.paper.envelope_dl",
};

export function paperLabel(name: string): string {
  const key = PAPER_KEYS[name];
  return key ? t(key) : name;
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
  return a.w === b.w && a.h === b.h && a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.right === b.right && columns(a) === columns(b) && (a.start ?? "next_page") === (b.start ?? "next_page");
}

/// Una pagina con i valori arrotondati come li riscrive il codec, senza
/// `cols` quando è una; dove comincia la sezione resta com'era.
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
    ...(page.start !== undefined && page.start !== "next_page" ? { start: page.start } : {}),
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

/// L'anteprima della pagina in Proprietà: la carta in scala, con i margini
/// come variabili di dato in percentuale dei suoi lati (in alto e in basso
/// dell'altezza, ai fianchi della larghezza) e le colonne. Un margine che
/// supera il foglio si ferma al foglio.
export function previewVariables(page: Page): Readonly<Record<string, string>> {
  const share = (side: number, of: number) => `${Math.round(Math.min(Math.max(side / of, 0), 1) * 1000) / 10}%`;
  return {
    "--preview-ratio": `${page.w} / ${page.h}`,
    "--preview-top": share(page.top, page.h),
    "--preview-bottom": share(page.bottom, page.h),
    "--preview-left": share(page.left, page.w),
    "--preview-right": share(page.right, page.w),
    "--preview-columns": String(columns(page)),
  };
}

/// La pagina di un formato che non ne porta una (l'ODT, finché la proiezione
/// non la dice): un A4 con i margini di 2 cm, in punti.
export const DEFAULT_PAGE: Page = { w: 595.3, h: 841.9, top: 56.7, bottom: 56.7, left: 56.7, right: 56.7 };

/// Le misure della pagina del documento, come variabili di dato in punti: la
/// carta è grande quanto la carta vera, con i suoi margini, e non si stringe
/// col riquadro (si scorre). Le usa la carta di Pagina e di Lettura
/// (`structure.css`); senza una pagina vale `DEFAULT_PAGE`, che è anche il
/// ripiego della regola. In Scrittura non le legge nessuno.
export function pageVariables(page: Page | null): Readonly<Record<string, string>> {
  if (!page) return {};
  return {
    "--page-w": `${page.w}pt`,
    "--page-h": `${page.h}pt`,
    "--page-top": `${page.top}pt`,
    "--page-right": `${page.right}pt`,
    "--page-bottom": `${page.bottom}pt`,
    "--page-left": `${page.left}pt`,
  };
}

/// Come un numero di pagina si scrive nel testo di un'intestazione: con il
/// codice di campo di Word.
export const FIELD_CODES: Readonly<Record<PageField, string>> = { page: "{PAGE}", pages: "{NUMPAGES}" };
const CODE = /\{(PAGE|NUMPAGES)\}/g;

/// Un'intestazione come testo da modificare: una riga per paragrafo, i
/// numeri con il loro codice. `null` se non si modifica: bloccata, o con un
/// codice scritto come testo, che si rileggerebbe come un numero.
export function runningText(running: RunningText): string | null {
  if (running.locked) return null;
  let out = "";
  for (const [i, line] of running.lines.entries()) {
    if (i > 0) out += "\n";
    for (const piece of line) {
      if (typeof piece !== "string") out += FIELD_CODES[piece.field];
      else if (new RegExp(CODE.source).test(piece)) return null;
      else out += piece;
    }
  }
  return out;
}

/// Le righe di un testo scritto: i codici tornano numeri. Un testo vuoto
/// non ha righe: l'intestazione si toglie.
export function runningOf(text: string): RunningText | null {
  if (text === "") return null;
  const lines = text.split(/\r?\n/).map((line) => {
    const pieces: Piece[] = [];
    let at = 0;
    for (const match of line.matchAll(CODE)) {
      if (match.index > at) pieces.push(line.slice(at, match.index));
      pieces.push({ field: match[1] === "PAGE" ? "page" : "pages" });
      at = match.index + match[0].length;
    }
    if (at < line.length) pieces.push(line.slice(at));
    return pieces;
  });
  return { lines };
}

/// Mette l'intestazione (o il piè di pagina) della sezione del cursore;
/// `null` la toglie, e la sezione mostra quella della sezione prima. Una
/// bloccata non si cambia.
export function setRunning(kind: "header" | "footer", running: RunningText | null): Command {
  return (state, dispatch) => {
    const at = pageAt(state);
    return at !== null && setRunningAt(kind, at.pos, running)(state, dispatch);
  };
}

/// Come `setRunning`, per la sezione che chiude il segno di fine a `pos`, o
/// per l'ultima con `null`: quella di un foglio, non del cursore.
export function setRunningAt(kind: "header" | "footer", pos: number | null, running: RunningText | null): Command {
  return (state, dispatch) => {
    const node = pos === null ? null : state.doc.nodeAt(pos);
    if (pos !== null && node?.type.name !== "section") return false;
    const at = own(node ? node.attrs : state.doc.attrs, pos);
    if (!at || at[kind]?.locked || running?.locked) return false;
    const same = (at[kind] ? writeRunning(at[kind]) : "") === (running ? writeRunning(running) : "");
    if (dispatch && !same) {
      const tr = at.pos === null ? state.tr.setDocAttribute(kind, running) : state.tr.setNodeAttribute(at.pos, kind, running);
      dispatch(tr);
    }
    return true;
  };
}

/// Un'intestazione come si legge sul foglio `page` di `pages`: una riga per
/// paragrafo, i numeri veri al posto dei campi.
export function runningOnSheet(running: RunningText, page: number, pages: number): string {
  return running.lines.map((line) => line.map((piece) => (typeof piece === "string" ? piece : String(piece.field === "page" ? page : pages))).join("")).join("\n");
}
