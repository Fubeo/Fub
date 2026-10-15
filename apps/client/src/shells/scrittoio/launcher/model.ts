// Il lanciatore, la parte che non tocca il DOM: i modi, il prefisso che li
// sceglie, ciò che ogni modo ricorda, e le piccole regole di lettura (una
// riga, un filtro) che il resto usa.
//
// Il modo è uno stato a sé, non un pezzo del testo: il prefisso scritto in
// testa al campo lo cambia e sparisce, così un modo senza prefisso (i modelli)
// vale quanto gli altri e ogni modo tiene la sua domanda pulita.

export type Mode = "files" | "commands" | "search" | "headings" | "tags" | "line" | "templates";

/// I modi nell'ordine in cui Tab li percorre e la fila li mostra.
export const MODES: readonly Mode[] = ["files", "commands", "search", "headings", "tags", "line", "templates"];

/// Il carattere che, scritto per primo, porta in un modo. I file sono il modo
/// di chi non scrive prefissi; ai modelli si arriva solo con Tab o col comando.
export const PREFIX: Readonly<Record<Mode, string | null>> = {
  files: null,
  commands: ">",
  search: "?",
  headings: "@",
  tags: "#",
  line: ":",
  templates: null,
};

export interface Reading {
  mode: Mode;
  text: string;
}

/// Legge ciò che sta nel campo. Un prefisso in testa sceglie il suo modo e
/// non fa parte della domanda; qualunque altra cosa resta nel modo corrente.
/// Vale da ogni modo: chi cerca davvero un testo che comincia per `#` lo fa
/// precedere da uno spazio.
export function read(mode: Mode, value: string): Reading {
  const first = value.charAt(0);
  if (first !== "") {
    const chosen = MODES.find((each) => PREFIX[each] === first);
    if (chosen) return { mode: chosen, text: value.slice(1) };
  }
  return { mode, text: value };
}

/// Il modo accanto, in tondo: `1` il prossimo, `-1` il precedente.
export function neighbour(mode: Mode, step: 1 | -1): Mode {
  const at = MODES.indexOf(mode);
  return MODES[(at + step + MODES.length) % MODES.length]!;
}

/// Ciò che ogni modo ha chiesto per ultimo. Vive quanto chi la tiene.
export interface Memory {
  recall(mode: Mode): string;
  remember(mode: Mode, text: string): void;
}

export function createMemory(): Memory {
  const last = new Map<Mode, string>();
  return {
    recall: (mode) => last.get(mode) ?? "",
    remember: (mode, text) => void last.set(mode, text),
  };
}

/// Dove va ciò che si apre.
export type OpenWay = "here" | "split" | "tab" | "window";

export interface Modifiers {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/// Invio apre, Mod-Invio divide, Maiusc-Invio apre in una linguetta, e
/// Alt-Invio in una finestra dove la piattaforma ne ha più d'una. Di due
/// modificatori vince il primo di quest'ordine: finestra, divisione, linguetta.
export function openWay(keys: Modifiers, windows: boolean): OpenWay {
  if (keys.altKey && windows) return "window";
  if (keys.ctrlKey || keys.metaKey) return "split";
  if (keys.shiftKey) return "tab";
  return "here";
}

/// Un rettangolo sullo schermo, in px.
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/// Sotto questa scala la corsa dalla pillola non parte: da una pillola ridotta
/// a un'icona la superficie non nasce come un punto.
export const SMALLEST_SCALE = 0.6;

/// La posa da cui la superficie parte (e a cui torna) rispetto al suo riposo,
/// con l'origine nell'angolo in alto a sinistra: larga quanto la pillola,
/// centrata su di lei e col bordo alto sul suo. La scala è una sola per i due
/// assi: ciò che la superficie contiene rimpicciolisce, non si schiaccia.
export function pillPose(pill: Box, place: Box): { x: number; y: number; scale: number } {
  const scale = Math.min(1, Math.max(SMALLEST_SCALE, pill.width / place.width));
  return {
    x: pill.left + pill.width / 2 - (place.left + (place.width * scale) / 2),
    y: pill.top - place.top,
    scale,
  };
}

/// La finestra più piccola in cui l'anteprima ha il suo posto accanto
/// all'elenco (px): sotto, la superficie resta quella stretta.
export const PREVIEW_MIN_WIDTH = 960;
export const PREVIEW_MIN_HEIGHT = 560;

/// C'è posto per l'anteprima in una finestra di queste misure?
export function previewFits(width: number, height: number): boolean {
  return width >= PREVIEW_MIN_WIDTH && height >= PREVIEW_MIN_HEIGHT;
}

export interface LineTarget {
  line: number;
  column: number | null;
}

/// «12», «12:5» o «12,5»: riga e, se c'è, colonna, contate da uno. Tutto il
/// resto non nomina una riga.
export function lineTarget(text: string): LineTarget | null {
  const found = /^\s*(\d{1,9})(?:\s*[:,]\s*(\d{1,9}))?\s*$/.exec(text);
  if (!found) return null;
  const line = Number(found[1]);
  if (line < 1) return null;
  const column = found[2] === undefined ? null : Number(found[2]);
  return { line, column: column !== null && column >= 1 ? column : null };
}

export interface LinePlace extends LineTarget {
  /// L'indice, in unità UTF-16, del punto dentro il testo.
  char: number;
  /// Le righe del testo.
  lines: number;
}

/// Il punto di un testo che una riga (e una colonna) nomina. Una riga oltre
/// la fine è l'ultima, una colonna oltre la fine è la fine della riga: chi
/// scrive «9999» vuole il fondo, non un errore. Il ritorno a capo, anche
/// `\r\n`, non conta fra le colonne.
export function linePlace(text: string, target: LineTarget): LinePlace {
  const starts = [0];
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) starts.push(at + 1);
  const line = Math.min(target.line, starts.length);
  const start = starts[line - 1]!;
  let end = line < starts.length ? starts[line]! - 1 : text.length;
  if (end > start && text.charAt(end - 1) === "\r") end -= 1;
  if (target.column === null) return { line, column: null, char: start, lines: starts.length };
  const column = Math.min(target.column, end - start + 1);
  return { line, column, char: start + column - 1, lines: starts.length };
}

/// Le voci il cui testo contiene ogni parola della domanda, senza badare alle
/// maiuscole. A domanda vuota restano tutte. Con `prefixFirst` quelle che
/// cominciano con la domanda passano davanti; fra pari l'ordine non cambia.
export function filterByText<T>(
  items: readonly T[],
  query: string,
  textOf: (item: T) => string,
  prefixFirst = false,
): T[] {
  const wanted = query.trim().toLocaleLowerCase();
  if (wanted === "") return [...items];
  const terms = wanted.split(/\s+/);
  const kept: { item: T; leading: boolean }[] = [];
  for (const item of items) {
    const text = textOf(item).toLocaleLowerCase();
    if (terms.every((term) => text.includes(term))) kept.push({ item, leading: text.startsWith(wanted) });
  }
  if (!prefixFirst) return kept.map((each) => each.item);
  return [...kept.filter((each) => each.leading), ...kept.filter((each) => !each.leading)].map((each) => each.item);
}
