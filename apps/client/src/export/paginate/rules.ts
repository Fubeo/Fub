// Le regole dell'impaginazione dell'esportazione in PDF (E28), senza DOM: dalle
// scatole misurate dalla vista (`model.ts`) alle pagine.
//
// Valgono sempre, senza interruttori:
// - un titolo non resta solo in fondo alla pagina: va nella pagina dopo col
//   blocco che lo segue (anche una fila di titoli, un 2 seguito da un 3);
// - un paragrafo non lascia una riga sola in fondo o in cima (orfane e
//   vedove): si spezza lasciandone almeno due da ogni parte, o va intero
//   nella pagina dopo;
// - tabelle corte, figure, formule, riquadri e diagrammi non si spezzano;
// - una tabella lunga continua nella pagina dopo fra due righe, con la sua
//   intestazione ripetuta, e senza lasciare una riga sola;
// - il codice lungo si spezza fra le righe, come un paragrafo;
// - ciò che è più alto di una pagina si rimpicciolisce per starci, e la
//   fascia lo dice (`scale` < 1): la pagina scrive «rimpicciolito»;
// - una nota al margine sta accanto al suo paragrafo; con un margine stretto
//   o due colonne le note vanno in fondo da sole.
//
// Le interruzioni volute (ogni Titolo 2, il separatore, D17) arrivano come
// scatole `break` (`breaks.ts`): voltano pagina, mai su una pagina vuota.
//
// Quando una regola non si può rispettare (una pagina che non tiene neanche
// due righe), vince il procedere: la pagina prende ciò che ci sta, e mai una
// pagina resta vuota per colpa di una regola.

import { boxHeight, sum, type Box, type FlowBox, type NotePlacement, type Page, type PageFrame, type Pagination, type Placement, type SideNote } from "./model";

/// Le righe che un paragrafo, un blocco di codice o una tabella lasciano
/// almeno da ogni parte di un taglio: niente righe sole.
export const MIN_LINES = 2;

/// Una tabella con al più tante righe nel corpo, che sta in una pagina, è
/// «corta»: non si spezza, va intera nella pagina dopo.
export const SHORT_TABLE_ROWS = 6;

/// Il margine più stretto che ospita le note accanto al paragrafo: la nota è
/// larga quanto il margine meno 8 mm (3,5 di stacco dal testo e 4,5 dal
/// bordo, come nel prototipo), e sotto 14 mm non si legge. Così i margini
/// «Stretti» (15 mm) mandano le note in fondo, «Normali» (22) e «Larghi» no.
export const MIN_NOTE_MARGIN = (22 * 96) / 25.4;

/// La tolleranza delle misure: la vista misura in frazioni di pixel.
const EPSILON = 0.5;

/// Le regole di una scatola, nella forma che usa l'impaginatore.
export interface BoxRules {
  /// Resta col blocco che la segue (i titoli).
  readonly keepWithNext: boolean;
  /// Si spezza fra le sue unità (righe, o righe della tabella).
  readonly splits: boolean;
  /// Le unità da cui è fatta, dall'alto: una sola per ciò che non si spezza.
  readonly units: readonly number[];
  /// Ciò che sta sopra le unità nella prima fascia e si ripete in cima a ogni
  /// fascia che continua: l'intestazione di una tabella lunga.
  readonly header: number;
  /// Le unità che restano almeno da ogni parte di un taglio.
  readonly minUnits: number;
}

/// Le regole di una scatola su una pagina di quell'altezza.
export function rulesOf(box: FlowBox, height: number): BoxRules {
  switch (box.kind) {
    case "heading":
      return { keepWithNext: true, splits: false, units: [box.height], header: 0, minUnits: 1 };
    case "paragraph":
    case "code":
      return { keepWithNext: false, splits: true, units: box.lines.length > 0 ? box.lines : [0], header: 0, minUnits: MIN_LINES };
    case "table": {
      const total = boxHeight(box);
      const short = box.rows.length <= SHORT_TABLE_ROWS && total <= height + EPSILON;
      if (short || box.rows.length === 0) return { keepWithNext: false, splits: false, units: [total], header: 0, minUnits: 1 };
      return { keepWithNext: false, splits: true, units: box.rows, header: box.header, minUnits: MIN_LINES };
    }
    default:
      return { keepWithNext: false, splits: false, units: [box.height], header: 0, minUnits: 1 };
  }
}

/// Dove vanno le note: accanto al paragrafo con una colonna sola e un margine
/// che le tiene, se no in fondo. La vista lo chiede prima di misurarle, perché
/// la loro altezza dipende dalla larghezza.
export function notePlacement(frame: Pick<PageFrame, "columns" | "noteMargin">): NotePlacement {
  return frame.columns === 1 && frame.noteMargin + EPSILON >= MIN_NOTE_MARGIN ? "margine" : "fondo";
}

/// Impagina le scatole: le pagine con le fasce di ogni scatola.
export function paginate(boxes: readonly Box[], frame: PageFrame): Pagination {
  if (!(frame.height > 0)) throw new RangeError(`l'altezza utile della pagina deve essere positiva, non ${frame.height}`);
  return new Layout(boxes, frame).run();
}

interface MutablePage {
  readonly placements: Placement[];
  readonly notes: SideNote[];
  /// Il bordo basso dell'ultima nota nel margine.
  noteBottom: number;
}

interface PendingNote {
  readonly box: number;
  readonly id: string;
  readonly height: number;
}

class Layout {
  private readonly pages: MutablePage[] = [];
  private readonly firstPage: number[];
  private readonly notes: NotePlacement;
  private readonly height: number;
  private readonly fitLabel: number;
  private readonly noteGap: number;
  /// Le note che non stavano nel margine della loro pagina: vanno in cima al
  /// margine della pagina dopo.
  private pending: PendingNote[] = [];
  private column = 0;
  /// Il bordo basso dell'ultima fascia nella colonna.
  private cursor = 0;
  /// Qualcosa sta già nella colonna.
  private used = false;
  /// La prima scatola messa nella colonna.
  private frameFirst = -1;
  /// Un'interruzione incontrata e non ancora applicata.
  private breakPending = false;

  constructor(private readonly boxes: readonly Box[], private readonly frame: PageFrame) {
    this.firstPage = boxes.map(() => -1);
    this.notes = notePlacement(frame);
    this.height = frame.height;
    this.fitLabel = Math.max(0, frame.fitLabel ?? 0);
    this.noteGap = Math.max(0, frame.noteGap ?? 0);
    this.openPage();
  }

  run(): Pagination {
    const { boxes } = this;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.kind === "break") {
        // Volta pagina al blocco dopo: un'interruzione in fondo alla nota non
        // lascia una pagina bianca, due di fila ne fanno una.
        this.breakPending = true;
        continue;
      }
      this.applyBreak();
      const rules = rulesOf(box, this.height);
      if (rules.keepWithNext && !(i > 0 && this.keeps(i - 1))) this.keepGroup(i);
      if (rules.splits) this.split(i, box, rules);
      else this.whole(i, box.id, "corpo", undefined, rules.units[0], box.gap ?? 0, this.carried(i));
    }
    if (this.notes === "fondo") this.endNotes();
    this.breakPending = false;
    while (this.pending.length > 0) this.openPage();
    return {
      pages: this.pages.map((p) => ({ placements: p.placements, notes: p.notes }) satisfies Page),
      notes: this.notes,
      firstPage: this.firstPage,
    };
  }

  /// Un'interruzione aspetta il blocco dopo: la pagina nuova, se in questa
  /// c'è già qualcosa.
  private applyBreak(): void {
    if (this.breakPending && this.page.placements.length > 0) this.openPage();
    this.breakPending = false;
  }

  private get page(): MutablePage {
    return this.pages[this.pages.length - 1];
  }

  /// La scatola `i` è un titolo che resta col seguito.
  private keeps(i: number): boolean {
    const box = this.boxes[i];
    return box.kind !== "break" && rulesOf(box, this.height).keepWithNext;
  }

  /// La colonna tiene solo la fila di titoli che precede `i`: lì un blocco
  /// più alto della pagina si rimpicciolisce sotto di loro, invece di
  /// lasciarli soli.
  private carried(i: number): boolean {
    if (!this.used) return true;
    if (this.frameFirst < 0 || this.frameFirst >= i) return false;
    for (let k = this.frameFirst; k < i; k++) if (!this.keeps(k)) return false;
    return true;
  }

  /// Una fila di titoli che comincia in `i`: se con l'inizio del blocco che la
  /// segue non sta nella colonna, ma starebbe in una colonna nuova, ci va.
  private keepGroup(i: number): void {
    const { boxes } = this;
    let end = i;
    let fresh = 0;
    while (end < boxes.length && this.keeps(end)) {
      const box = boxes[end] as FlowBox;
      fresh += (end > i ? box.gap ?? 0 : 0) + boxHeight(box);
      end++;
    }
    const next = boxes[end];
    // Il titolo è l'ultima cosa, o lo segue un'interruzione: resta dov'è.
    if (next === undefined || next.kind === "break") return;
    if (!this.used) return;
    const rules = rulesOf(next, this.height);
    const first = this.minFirst(rules);
    // Il blocco dopo non sta in nessuna pagina: si rimpicciolisce sotto i
    // titoli, in una colonna nuova.
    if (first > this.height + EPSILON) {
      this.nextFrame();
      return;
    }
    const need = fresh + (next.gap ?? 0) + first;
    const here = this.cursor + ((boxes[i] as FlowBox).gap ?? 0);
    if (here + need > this.height + EPSILON && need <= this.height + EPSILON) this.nextFrame();
  }

  /// L'altezza della fascia più piccola con cui una scatola può cominciare.
  private minFirst(rules: BoxRules): number {
    const { units, header, minUnits, splits } = rules;
    if (!splits || units.length < 2 * minUnits) return header + sum(units);
    return header + sum(units, 0, minUnits);
  }

  /// Una scatola che non si spezza (o una nota in fondo): nella colonna se ci
  /// sta, se no nella dopo; più alta di una pagina, rimpicciolita.
  private whole(box: number, id: string, part: Placement["part"], note: string | undefined, height: number, gap: number, carried: boolean): void {
    let y = this.used ? this.cursor + gap : 0;
    if (y + height <= this.height + EPSILON) {
      this.place(box, { box, id, part, ...(note ? { note } : {}), from: 0, to: height, column: this.column, y, scale: 1, continued: false, continues: false });
      return;
    }
    if (this.used && (height <= this.height + EPSILON || !carried)) {
      this.nextFrame();
      y = 0;
    }
    if (height <= this.height + EPSILON) {
      this.place(box, { box, id, part, ...(note ? { note } : {}), from: 0, to: height, column: this.column, y, scale: 1, continued: false, continues: false });
      return;
    }
    // Più alta di una pagina: sotto i titoli che porta con sé, o in cima.
    let room = this.height - y - this.fitLabel;
    if (room < this.height / 4) {
      this.nextFrame();
      y = 0;
      room = this.height - this.fitLabel;
    }
    const scale = Math.max(0, room) / height;
    this.place(box, { box, id, part, ...(note ? { note } : {}), from: 0, to: height, column: this.column, y, scale, continued: false, continues: false });
  }

  /// Un paragrafo, un blocco di codice, una tabella lunga: fra le unità, con
  /// almeno `minUnits` da ogni parte del taglio.
  private split(index: number, box: FlowBox, rules: BoxRules): void {
    const { units, header, minUnits } = rules;
    const n = units.length;
    const offset = (k: number) => header + sum(units, 0, k);
    let s = 0;
    while (s < n) {
      const first = s === 0;
      const y = this.used ? this.cursor + (first ? box.gap ?? 0 : 0) : 0;
      const room = this.height - y - header;
      let k = s;
      let filled = 0;
      while (k < n && filled + units[k] <= room + EPSILON) filled += units[k++];
      if (k === n) {
        this.fragment(index, box.id, header, offset, s, n, y, 1, false);
        return;
      }
      const legal = Math.min(k, n - minUnits);
      if (legal - s >= minUnits) {
        this.fragment(index, box.id, header, offset, s, legal, y, 1, true);
        this.nextFrame();
        s = legal;
        continue;
      }
      if (this.used) {
        this.nextFrame();
        continue;
      }
      // In cima a una colonna e nessun taglio rispetta la regola: si prende
      // ciò che ci sta, almeno un'unità.
      if (k > s) {
        this.fragment(index, box.id, header, offset, s, k, y, 1, true);
        this.nextFrame();
        s = k;
        continue;
      }
      // Un'unità più alta della pagina (una riga di tabella enorme):
      // rimpicciolita, con la sua intestazione.
      const scale = Math.max(0, this.height - this.fitLabel) / (header + units[s]);
      this.fragment(index, box.id, header, offset, s, s + 1, 0, scale, s + 1 < n);
      if (s + 1 < n) this.nextFrame();
      s++;
    }
  }

  /// Le unità da `s` a `k` di una scatola che si spezza, con l'intestazione
  /// ripetuta se continua.
  private fragment(box: number, id: string, header: number, offset: (k: number) => number, s: number, k: number, y: number, scale: number, continues: boolean): void {
    const continued = s > 0;
    let top = y;
    if (continued && header > 0) {
      this.place(box, { box, id, part: "intestazione", from: 0, to: header, column: this.column, y: top, scale, continued, continues });
      top += header * scale;
    }
    this.place(box, { box, id, part: "corpo", from: continued ? offset(s) : 0, to: offset(k), column: this.column, y: top, scale, continued, continues });
  }

  private place(box: number, placement: Placement): void {
    this.page.placements.push(placement);
    if (box >= 0 && this.firstPage[box] < 0) this.firstPage[box] = this.pages.length - 1;
    if (!this.used) this.frameFirst = box;
    this.used = true;
    const shrunk = placement.scale < 1 ? this.fitLabel : 0;
    this.cursor = placement.y + (placement.to - placement.from) * placement.scale + shrunk;
    if (placement.part === "corpo" && this.notes === "margine") this.sideNotes(box, placement);
  }

  /// Le note della scatola il cui segno cade in questa fascia, nel margine
  /// accanto.
  private sideNotes(index: number, placement: Placement): void {
    const box = this.boxes[index];
    if (box.kind === "break" || !box.notes) return;
    const last = !placement.continues;
    for (const note of box.notes) {
      const at = note.at ?? 0;
      const inside = placement.continued ? at >= placement.from : true;
      if (!inside || (at >= placement.to && !last)) continue;
      const anchor = placement.y + (Math.min(Math.max(at, placement.from), placement.to) - placement.from) * placement.scale;
      this.sideNote({ box: index, id: note.id, height: note.height }, anchor);
    }
  }

  /// Una nota nel margine: sotto la nota prima, alla sua altezza o più su se
  /// sfora in fondo; se non sta, in cima al margine della pagina dopo.
  private sideNote(note: PendingNote, anchor: number): boolean {
    const page = this.page;
    const floor = page.notes.length > 0 ? page.noteBottom + this.noteGap : 0;
    let y = Math.max(anchor, floor);
    let scale = 1;
    if (y + note.height > this.height + EPSILON) {
      if (this.height - note.height >= floor - EPSILON) y = this.height - note.height;
      else if (page.notes.length === 0) {
        y = 0;
        scale = this.height / note.height;
      } else {
        this.pending.push(note);
        return false;
      }
    }
    page.notes.push({ box: note.box, id: note.id, y, scale });
    page.noteBottom = y + note.height * scale;
    return true;
  }

  /// Le note in fondo, dopo l'ultimo blocco, col loro titolo che resta con la
  /// prima.
  private endNotes(): void {
    const notes: { box: number; id: string; note: string; height: number }[] = [];
    this.boxes.forEach((box, index) => {
      if (box.kind === "break") return;
      for (const note of box.notes ?? []) notes.push({ box: index, id: box.id, note: note.id, height: note.height });
    });
    if (notes.length === 0) return;
    this.applyBreak();
    const heading = Math.max(0, this.frame.notesHeading ?? 0);
    if (heading > 0) {
      const need = heading + Math.min(notes[0].height, this.height);
      if (this.used && this.cursor + need > this.height + EPSILON && need <= this.height + EPSILON) this.nextFrame();
      this.whole(-1, "", "titolo-note", undefined, heading, 0, false);
    }
    for (const n of notes) this.whole(n.box, n.id, "nota", n.note, n.height, this.noteGap, heading > 0 && this.frameOnlyHeading());
  }

  /// Nella colonna c'è solo il titolo delle note.
  private frameOnlyHeading(): boolean {
    const placements = this.page.placements.filter((p) => p.column === this.column);
    return placements.length === 1 && placements[0].part === "titolo-note";
  }

  private nextFrame(): void {
    if (this.column + 1 < this.frame.columns) {
      this.column++;
      this.cursor = 0;
      this.used = false;
      this.frameFirst = -1;
      return;
    }
    this.openPage();
  }

  private openPage(): void {
    this.pages.push({ placements: [], notes: [], noteBottom: 0 });
    this.column = 0;
    this.cursor = 0;
    this.used = false;
    this.frameFirst = -1;
    const pending = this.pending;
    this.pending = [];
    for (const note of pending) {
      if (this.pending.length > 0) this.pending.push(note);
      else this.sideNote(note, 0);
    }
  }
}
