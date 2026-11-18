// La vista Linea del tempo della Base (T34): ogni nota è una barra fra la sua
// proprietà d'inizio e quella di fine (`fub.start`, `fub.end`; i giorni li
// dice `derive`), o un punto se ha una data sola. Trascinare la barra sposta
// le due date, trascinare un bordo ne cambia una; Maiusc con le frecce fa lo
// stesso da tastiera. Qui si disegna e si decide che cosa scrivere; la
// superficie scrive (`note.property.set`, col valore letto come confronto, e
// l'annulla).
//
// Il trascinamento non chiede niente al core mentre il puntatore si muove: la
// barra cambia due proprietà CSS e la scritta, e la scrittura parte al
// rilascio.
//
// Il prototipo è `PLAN-ui/editor.html` (`.tl`, `.tl-a`, `.tl-s`, `.tl-r`,
// `.tl-t`, `.tl-b`, riga 439; il ramo `tempo` di `renderBase`).
import { plural, t } from "../../i18n/strings";
import { iconEl } from "../../ui/icons";
import { addDays, firstWeekday, type IsoDay } from "./calendar";
import type { BaseRow } from "./data";

/// La scala: una colonna è una settimana, un mese o un anno.
export type TimelineZoom = "weeks" | "months" | "years";
export const TIMELINE_ZOOMS: readonly TimelineZoom[] = ["weeks", "months", "years"];
/// Quante colonne mostra ogni scala: otto settimane sono i 56 giorni del
/// prototipo.
export const TIMELINE_COLUMNS: Readonly<Record<TimelineZoom, number>> = { weeks: 8, months: 6, years: 4 };

/// Lo stato della linea del tempo che sopravvive a un ridisegno: la scala, il
/// primo giorno mostrato, la nota col fuoco. È della superficie, come lo
/// scroll: il file `.base` non lo conosce.
export interface TimelineState {
  zoom: TimelineZoom;
  /// Il primo giorno della prima colonna (un lunedì, un primo del mese, un
  /// primo gennaio).
  start: IsoDay;
  /// La nota su cui stanno le frecce.
  focus: string | null;
  /// Al prossimo disegno il fuoco torna sulla riga della nota: dopo un gesto
  /// da tastiera che ha ridisegnato la vista.
  refocus: boolean;
}

/// Un intervallo di una nota come lo dice `derive`: i giorni civili d'inizio
/// e di fine (l'ora non li sposta) e se la fine viene prima dell'inizio.
export interface TimelineSpan {
  readonly start: IsoDay | null;
  readonly end: IsoDay | null;
  readonly inverted: boolean;
}

/// Lo stato di partenza: la scala delle settimane, con oggi nella seconda
/// colonna.
export function timelineState(today: IsoDay, weekStart: number, zoom: TimelineZoom = "weeks"): TimelineState {
  return { zoom, start: openingStart(today, zoom, weekStart), focus: null, refocus: false };
}

/// Il primo giorno mostrato perché `day` cada nella seconda colonna.
export function openingStart(day: IsoDay, zoom: TimelineZoom, weekStart: number): IsoDay {
  return shiftColumns(unitStart(day, zoom, weekStart), zoom, -1);
}

function parts(day: IsoDay): [number, number, number] {
  return day.split("-").map(Number) as [number, number, number];
}

function isoOf(year: number, month: number, day: number): IsoDay {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function utcOf(day: IsoDay): Date {
  const [year, month, date] = parts(day);
  return new Date(Date.UTC(year, month - 1, date));
}

/// I giorni da `from` a `to` (negativi se `to` viene prima).
export function daysBetween(from: IsoDay, to: IsoDay): number {
  return Math.round((utcOf(to).getTime() - utcOf(from).getTime()) / 86_400_000);
}

/// Il primo giorno della colonna che contiene `day`.
export function unitStart(day: IsoDay, zoom: TimelineZoom, weekStart: number): IsoDay {
  const [year, month] = parts(day);
  if (zoom === "months") return isoOf(year, month, 1);
  if (zoom === "years") return isoOf(year, 1, 1);
  return addDays(day, -((utcOf(day).getUTCDay() - weekStart + 7) % 7));
}

/// Il primo giorno `count` colonne dopo (o prima) di `start`, che è il primo
/// giorno di una colonna.
export function shiftColumns(start: IsoDay, zoom: TimelineZoom, count: number): IsoDay {
  if (zoom === "weeks") return addDays(start, 7 * count);
  const [year, month] = parts(start);
  if (zoom === "years") return isoOf(year + count, 1, 1);
  const at = new Date(Date.UTC(year, month - 1 + count, 1));
  return isoOf(at.getUTCFullYear(), at.getUTCMonth() + 1, 1);
}

/// Una colonna della scala: il primo giorno e quanti giorni ha.
export interface TimelineColumn {
  readonly start: IsoDay;
  readonly days: number;
}

/// Le colonne della scala a partire da `start`.
export function timelineColumns(start: IsoDay, zoom: TimelineZoom): TimelineColumn[] {
  const out: TimelineColumn[] = [];
  let at = start;
  for (let index = 0; index < TIMELINE_COLUMNS[zoom]; index++) {
    const next = shiftColumns(at, zoom, 1);
    out.push({ start: at, days: daysBetween(at, next) });
    at = next;
  }
  return out;
}

/// Dove cade l'inizio del giorno `day`, da 0 (il bordo sinistro) a 1 (il
/// destro). Le colonne hanno tutte la stessa larghezza, come le righe del
/// prototipo, e dentro ognuna i giorni si dividono il posto: un mese di 28
/// giorni ha i giorni un po' più larghi di uno di 31. Fuori dalle colonne
/// la misura continua con la colonna più vicina.
export function dayPosition(day: IsoDay, columns: readonly TimelineColumn[]): number {
  const count = columns.length;
  const first = columns[0]!;
  const offset = daysBetween(first.start, day);
  if (offset < 0) return offset / first.days / count;
  let walked = 0;
  for (let index = 0; index < count; index++) {
    const column = columns[index]!;
    if (offset < walked + column.days) return (index + (offset - walked) / column.days) / count;
    walked += column.days;
  }
  const last = columns[count - 1]!;
  return 1 + (offset - walked) / last.days / count;
}

/// Il giorno sotto il punto `fraction` della scala (0 il bordo sinistro, 1
/// il destro): l'inverso di `dayPosition`.
export function dayAt(fraction: number, columns: readonly TimelineColumn[]): IsoDay {
  const count = columns.length;
  const first = columns[0]!;
  const scaled = fraction * count;
  if (scaled < 0) return addDays(first.start, Math.floor(scaled * first.days));
  if (scaled >= count) {
    const last = columns[count - 1]!;
    return addDays(last.start, Math.floor((scaled - (count - 1)) * last.days));
  }
  const index = Math.floor(scaled);
  const column = columns[index]!;
  return addDays(column.start, Math.min(column.days - 1, Math.floor((scaled - index) * column.days)));
}

/// Una barra (o un punto) che si vede, almeno in parte: `left` e `right` in
/// frazioni della scala, già dentro i bordi; `clipStart` e `clipEnd` se la
/// barra continua oltre.
export interface TimelineMark { readonly kind: "bar" | "point"; readonly left: number; readonly right: number; readonly clipStart: boolean; readonly clipEnd: boolean }
/// Una nota tutta prima o tutta dopo i giorni mostrati, con la data più
/// vicina.
export interface TimelineOff { readonly kind: "before" | "after"; readonly day: IsoDay }
/// Che cosa si disegna nella riga di una nota.
export type TimelineShape = TimelineMark | TimelineOff;

export function isOff(shape: TimelineShape): shape is TimelineOff {
  return shape.kind === "before" || shape.kind === "after";
}

/// La forma di un intervallo sulla scala. La barra va dal primo giorno alla
/// fine dell'ultimo (una nota di un giorno solo è larga un giorno); con la
/// fine prima dell'inizio va dalla fine all'inizio. Una data sola è un punto.
/// `null` se la nota non ha date.
export function spanShape(span: TimelineSpan, columns: readonly TimelineColumn[]): TimelineShape | null {
  const { low, high } = spanEdges(span);
  if (low === null || high === null) return null;
  const point = span.start === null || span.end === null;
  const left = dayPosition(low, columns);
  const right = point ? left : dayPosition(addDays(high, 1), columns);
  if (left >= 1) return { kind: "after", day: low };
  if (point ? left < 0 : right <= 0) return { kind: "before", day: high };
  return { kind: point ? "point" : "bar", left: Math.max(0, left), right: Math.min(1, right), clipStart: left < 0, clipEnd: right > 1 };
}

/// Il giorno a sinistra e quello a destra di un intervallo: inizio e fine,
/// scambiati se la fine viene prima; la data che c'è, se ce n'è una sola.
export function spanEdges(span: TimelineSpan): { low: IsoDay | null; high: IsoDay | null } {
  const { start, end } = span;
  if (start === null || end === null) {
    const only = start ?? end;
    return { low: only, high: only };
  }
  return end < start ? { low: end, high: start } : { low: start, high: end };
}

/// Quale parte di una barra si sposta: tutta, il bordo sinistro o il destro.
export type TimelineGrip = "move" | "low" | "high";

/// Le date nuove di un intervallo spostato di `delta` giorni con la presa
/// `grip`, per proprietà: `start` e `end` solo se cambiano. Un bordo non
/// passa oltre l'altro: una barra accorciata resta almeno di un giorno.
export function movedSpan(span: TimelineSpan, grip: TimelineGrip, delta: number): { start?: IsoDay; end?: IsoDay } {
  if (delta === 0) return {};
  const { start, end } = span;
  if (start === null || end === null || grip === "move") {
    const out: { start?: IsoDay; end?: IsoDay } = {};
    if (start !== null) out.start = addDays(start, delta);
    if (end !== null) out.end = addDays(end, delta);
    return out;
  }
  // Il bordo sinistro è l'inizio, o la fine se la barra è rovesciata.
  const lowKey = span.inverted ? "end" : "start";
  const highKey = span.inverted ? "start" : "end";
  const { low, high } = spanEdges(span) as { low: IsoDay; high: IsoDay };
  if (grip === "low") {
    const moved = addDays(low, delta);
    const day = moved > high ? high : moved;
    return day === low ? {} : { [lowKey]: day };
  }
  const moved = addDays(high, delta);
  const day = moved < low ? low : moved;
  return day === high ? {} : { [highKey]: day };
}

/// Una riga della Base con il suo intervallo.
export type TimelineRow = BaseRow & { readonly span: TimelineSpan };

/// Ciò che la linea del tempo chiede alla superficie.
export interface TimelineInput {
  readonly rows: readonly BaseRow[];
  /// Quante note della vista non hanno date: anche quelle oltre la pagina.
  readonly undated: number;
  readonly state: TimelineState;
  readonly locale: string;
  readonly today: IsoDay;
  /// Le proprietà d'inizio e di fine della vista; `null` se il file non le
  /// dice (senza fine, ogni nota è un punto).
  readonly startKey: string | null;
  readonly endKey: string | null;
  /// Il nome di una nota come la Base lo mostra.
  readonly title: (doc: string) => string;
  /// Le date che si possono scrivere in questa nota (`start`, `end`): la
  /// Base non è in sola lettura, la nota è Markdown, la proprietà è della
  /// nota e il suo valore è una data.
  readonly writable: (row: BaseRow, edge: "start" | "end") => boolean;
  /// Una scrittura in corso: niente gesti finché non finisce.
  readonly busy: boolean;
  /// Le proprietà data delle note, per scegliere l'inizio quando il file non
  /// lo dice; `null` se la Base non può scrivere il file.
  readonly dateChoices: readonly string[] | null;
  readonly chooseStartKey: (key: string) => void;
  readonly open: (doc: string) => void;
  readonly move: (row: TimelineRow, dates: { start?: IsoDay; end?: IsoDay }) => void;
  /// Ridisegna la linea del tempo dallo stato (la scala, i giorni mostrati).
  readonly redraw: () => void;
}

/// Il numero dell'ultimo titolo: la griglia lo nomina per id.
let titles = 0;

/// Le frecce che scorrono, o che spostano con Maiusc e Alt.
const STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };

function capitalized(text: string, locale: string): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

/// La linea del tempo dello stato, come elemento da mettere nella Base.
export function renderTimeline(input: TimelineInput): HTMLElement {
  const { state, locale } = input;
  const root = document.createElement("div");
  root.className = "base-timeline";
  if (input.startKey === null) {
    root.append(noStartKey(input));
    return root;
  }
  const weekStart = firstWeekday(locale);
  const columns = timelineColumns(state.start, state.zoom);
  const lastDay = addDays(shiftColumns(state.start, state.zoom, columns.length), -1);
  const yearly = state.zoom === "years";
  const short = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", ...(yearly ? { year: "numeric" } : {}), timeZone: "UTC" });
  const long = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const shortOf = (day: IsoDay) => short.format(utcOf(day)).replace(/\.(?=\s|$)/g, "");
  const longOf = (day: IsoDay) => long.format(utcOf(day));

  const timed: TimelineRow[] = [];
  for (const row of input.rows) {
    if (row.span && (row.span.start !== null || row.span.end !== null)) timed.push(row as TimelineRow);
  }
  if (state.focus !== null && !timed.some((row) => row.doc === state.focus)) state.focus = null;
  state.focus ??= timed[0]?.doc ?? null;

  // La testa: i giorni mostrati, i due passi, «Oggi», la scala; a destra le
  // note senza date.
  const head = document.createElement("div");
  head.className = "base-tl-head";
  const title = document.createElement("h2");
  title.className = "base-tl-title";
  title.id = `base-tl-title-${++titles}`;
  title.textContent = capitalized(rangeTitle(state, lastDay, locale), locale);
  const button = (className: string, label: string, run: () => void, figure: string | null): HTMLButtonElement => {
    const each = document.createElement("button");
    each.type = "button";
    each.className = className;
    if (figure) {
      const icon = iconEl(figure);
      if (icon) { icon.setAttribute("aria-hidden", "true"); each.append(icon); }
      each.setAttribute("aria-label", label);
      each.title = label;
    } else each.textContent = label;
    each.addEventListener("click", run);
    return each;
  };
  const step = (by: number) => {
    state.start = shiftColumns(state.start, state.zoom, by * columns.length);
    input.redraw();
  };
  const zoomTo = (zoom: TimelineZoom) => {
    if (zoom === state.zoom) return;
    // Il giorno al centro resta al centro, per quanto la scala lo permette.
    const middle = dayAt(0.5, columns);
    state.zoom = zoom;
    state.start = shiftColumns(unitStart(middle, zoom, weekStart), zoom, -Math.floor(TIMELINE_COLUMNS[zoom] / 2));
    input.redraw();
  };
  const zoom = document.createElement("div");
  zoom.className = "base-tl-zoom";
  zoom.setAttribute("role", "group");
  zoom.setAttribute("aria-label", t("base.timeline.zoom"));
  for (const each of TIMELINE_ZOOMS) {
    const option = button("base-tl-zoom-option", t(`base.timeline.zoom.${each}`), () => zoomTo(each), null);
    option.setAttribute("aria-pressed", String(each === state.zoom));
    zoom.append(option);
  }
  head.append(
    button("base-tl-nav base-tl-prev", t("base.timeline.previous"), () => step(-1), "chevron"),
    title,
    button("base-tl-nav base-tl-next", t("base.timeline.next"), () => step(1), "chevron"),
    button("base-tl-nav base-tl-today", t("base.timeline.today"), () => {
      state.start = openingStart(input.today, state.zoom, weekStart);
      input.redraw();
    }, null),
    zoom,
  );
  if (input.undated > 0) {
    const note = document.createElement("span");
    note.className = "base-tl-undated";
    note.textContent = plural(input.undated, "base.timeline.undated_one", "base.timeline.undated_other", { count: input.undated });
    head.append(note);
  }

  const grid = document.createElement("div");
  grid.className = "base-tl";
  grid.setAttribute("role", "grid");
  grid.setAttribute("aria-labelledby", title.id);
  grid.setAttribute("aria-description", t("base.timeline.keys"));
  if (input.busy) grid.setAttribute("aria-busy", "true");
  grid.style.setProperty("--tl-columns", String(columns.length));
  const now = dayPosition(input.today, columns);
  const nowShown = now >= 0 && now < 1;
  if (nowShown) grid.style.setProperty("--tl-now", `${now * 100}%`);
  else grid.dataset.nowOut = "true";

  // La riga della scala: le proprietà a sinistra, i nomi delle colonne e
  // «oggi» sopra le righe.
  const axis = document.createElement("div");
  axis.className = "base-tl-axis";
  axis.setAttribute("role", "row");
  const axisLabel = document.createElement("span");
  axisLabel.className = "base-tl-axis-label";
  axisLabel.setAttribute("role", "columnheader");
  axisLabel.textContent = input.endKey === null ? input.startKey : t("base.timeline.axis", { start: input.startKey, end: input.endKey });
  const scale = document.createElement("div");
  scale.className = "base-tl-scale";
  scale.setAttribute("role", "columnheader");
  // L'intestazione della scala ha un testo per chi legge con la voce: i nomi
  // delle colonne sono nascosti, e un'etichetta sola non basta (axe).
  const spoken = document.createElement("span");
  spoken.className = "sr-only";
  spoken.textContent = title.textContent;
  scale.append(spoken);
  columns.forEach((column, index) => {
    // Il nome di una colonna sotto «oggi» lascia il posto a «oggi».
    if (nowShown && Math.abs((index + 0.5) / columns.length - now) < 0.6 / columns.length) return;
    const tick = document.createElement("span");
    tick.className = "base-tl-tick";
    tick.setAttribute("aria-hidden", "true");
    tick.textContent = columnLabel(column, index, state.zoom, locale);
    tick.style.setProperty("left", `${((index + 0.5) / columns.length) * 100}%`);
    scale.append(tick);
  });
  if (nowShown) {
    const today = document.createElement("span");
    today.className = "base-tl-now";
    today.setAttribute("aria-hidden", "true");
    today.textContent = t("base.timeline.now");
    scale.append(today);
  }
  axis.append(axisLabel, scale);
  grid.append(axis);

  const tracks = new Map<string, HTMLElement>();
  const rowOf = new Map(timed.map((row) => [row.doc, row]));
  const spanText = (span: TimelineSpan): string => {
    if (span.start !== null && span.end !== null) return t("base.timeline.span", { start: shortOf(span.start), end: shortOf(span.end) });
    return shortOf((span.start ?? span.end)!);
  };
  const spokenSpan = (row: TimelineRow): string => {
    const { start, end, inverted } = row.span;
    const name = input.title(row.doc);
    if (start !== null && end !== null) {
      return t(inverted ? "base.timeline.row_inverted" : "base.timeline.row_span", { note: name, start: longOf(start), end: longOf(end) });
    }
    return t(start !== null ? "base.timeline.row_start" : "base.timeline.row_end", { note: name, date: longOf((start ?? end)!) });
  };
  // Che cosa sposta una presa: la barra intera si sposta se le sue date si
  // scrivono; un bordo, se si scrive la sua.
  const lowEdge = (span: TimelineSpan): "start" | "end" => span.start === null ? "end" : span.end === null ? "start" : span.inverted ? "end" : "start";
  const highEdge = (span: TimelineSpan): "start" | "end" => span.end === null ? "start" : span.start === null ? "end" : span.inverted ? "start" : "end";
  const canMove = (row: TimelineRow, grip: TimelineGrip): boolean => {
    if (input.busy) return false;
    const { start, end } = row.span;
    if (grip === "low") return start !== null && end !== null && input.writable(row, lowEdge(row.span));
    if (grip === "high") return start !== null && end !== null && input.writable(row, highEdge(row.span));
    return (start === null || input.writable(row, "start")) && (end === null || input.writable(row, "end"));
  };
  const shapeOf = (row: TimelineRow, track: HTMLElement, span: TimelineSpan): void => {
    track.querySelector(".base-tl-bar, .base-tl-point, .base-tl-off")?.remove();
    const shape = spanShape(span, columns);
    if (!shape) return;
    if (isOff(shape)) {
      const off = document.createElement("button");
      off.type = "button";
      off.className = "base-tl-off";
      off.tabIndex = -1;
      off.dataset.side = shape.kind;
      off.textContent = shape.kind === "before" ? `‹ ${shortOf(shape.day)}` : `${shortOf(shape.day)} ›`;
      off.setAttribute("aria-label", t("base.timeline.show", { date: longOf(shape.day) }));
      off.addEventListener("click", () => {
        state.start = openingStart(shape.day, state.zoom, weekStart);
        state.focus = row.doc;
        state.refocus = true;
        input.redraw();
      });
      track.append(off);
      return;
    }
    const mark = document.createElement("span");
    mark.className = shape.kind === "point" ? "base-tl-point" : "base-tl-bar";
    mark.setAttribute("aria-hidden", "true");
    mark.style.setProperty("--tl-left", `${shape.left * 100}%`);
    mark.style.setProperty("--tl-width", `${(shape.right - shape.left) * 100}%`);
    // Un punto verso la fine della riga ha la data prima, perché ci stia.
    if (shape.kind === "point" && shape.left > 0.75) mark.dataset.flip = "true";
    if (shape.clipStart) mark.dataset.clipStart = "true";
    if (shape.clipEnd) mark.dataset.clipEnd = "true";
    if (span.inverted) mark.dataset.inverted = "true";
    const label = document.createElement("span");
    label.className = "base-tl-label";
    label.textContent = spanText(span);
    mark.append(label);
    if (shape.kind === "bar") {
      if (canMove(row, "move")) mark.dataset.grip = "move";
      for (const edge of ["low", "high"] as const) {
        if (!canMove(row, edge) || (edge === "low" ? shape.clipStart : shape.clipEnd)) continue;
        const handle = document.createElement("span");
        handle.className = "base-tl-edge";
        handle.dataset.grip = edge;
        mark.append(handle);
      }
    } else if (canMove(row, "move")) mark.dataset.grip = "move";
    if (span.inverted) mark.title = t("base.timeline.inverted");
    track.append(mark);
  };

  for (const row of timed) {
    const line = document.createElement("div");
    line.className = "base-tl-row";
    line.setAttribute("role", "row");
    line.dataset.doc = row.doc;
    const name = document.createElement("span");
    name.className = "base-tl-name";
    name.setAttribute("role", "rowheader");
    name.textContent = input.title(row.doc);
    name.title = row.doc;
    name.addEventListener("click", () => input.open(row.doc));
    const track = document.createElement("div");
    track.className = "base-tl-track";
    track.setAttribute("role", "gridcell");
    track.setAttribute("aria-label", spokenSpan(row));
    if (row.span.inverted) track.dataset.inverted = "true";
    track.tabIndex = row.doc === state.focus ? 0 : -1;
    track.addEventListener("focus", () => {
      if (state.focus === row.doc) return;
      const before = state.focus === null ? undefined : tracks.get(state.focus);
      if (before) before.tabIndex = -1;
      state.focus = row.doc;
      track.tabIndex = 0;
    });
    shapeOf(row, track, row.span);
    tracks.set(row.doc, track);
    line.append(name, track);
    grid.append(line);
  }
  if (timed.length === 0) {
    const empty = document.createElement("p");
    empty.className = "base-tl-none";
    empty.textContent = t("base.timeline.no_dates");
    grid.append(empty);
  }

  const focusRow = (doc: string | undefined): void => {
    if (doc === undefined) return;
    tracks.get(doc)?.focus();
  };
  const order = timed.map((row) => row.doc);
  grid.addEventListener("keydown", (key) => {
    const track = key.target instanceof HTMLElement ? key.target.closest<HTMLElement>(".base-tl-track") : null;
    if (!track || key.ctrlKey || key.metaKey) return;
    const doc = track.closest<HTMLElement>(".base-tl-row")!.dataset.doc!;
    const row = rowOf.get(doc)!;
    const at = order.indexOf(doc);
    if (!key.altKey && !key.shiftKey) {
      if (key.key === "ArrowDown" || key.key === "ArrowUp") {
        key.preventDefault();
        focusRow(order[Math.max(0, Math.min(order.length - 1, at + (key.key === "ArrowDown" ? 1 : -1)))]);
        return;
      }
      if (key.key === "Home" || key.key === "End") {
        key.preventDefault();
        focusRow(order[key.key === "Home" ? 0 : order.length - 1]);
        return;
      }
      if (key.key === "Enter") {
        key.preventDefault();
        input.open(doc);
        return;
      }
    }
    // «+» avvicina (dagli anni ai mesi alle settimane), «-» allontana; su
    // certe tastiere «+» vuole Maiusc.
    if (!key.altKey && (key.key === "+" || key.key === "=" || key.key === "-")) {
      const next = TIMELINE_ZOOMS[TIMELINE_ZOOMS.indexOf(state.zoom) + (key.key === "-" ? 1 : -1)];
      key.preventDefault();
      if (!next) return;
      state.refocus = true;
      zoomTo(next);
      return;
    }
    const by = STEPS[key.key];
    if (by === undefined) return;
    key.preventDefault();
    // Le frecce da sole scorrono di una colonna.
    if (!key.altKey && !key.shiftKey) {
      state.start = shiftColumns(state.start, state.zoom, by);
      state.refocus = true;
      input.redraw();
      return;
    }
    // Maiusc sposta la barra di un giorno; Alt l'inizio, Alt e Maiusc la
    // fine (o la data che c'è, se ce n'è una sola).
    const { start, end } = row.span;
    let dates: { start?: IsoDay; end?: IsoDay };
    if (!key.altKey) {
      if (!canMove(row, "move")) return;
      dates = movedSpan(row.span, "move", by);
    } else {
      const edge: "start" | "end" = start === null ? "end" : end === null ? "start" : key.shiftKey ? "end" : "start";
      const current = row.span[edge];
      if (current === null || input.busy || !input.writable(row, edge)) return;
      dates = { [edge]: addDays(current, by) };
    }
    state.focus = doc;
    state.refocus = true;
    input.move(row, dates);
  });

  // Il trascinamento col puntatore: la barra segue a giorni interi, senza
  // chiedere niente a nessuno; il rilascio scrive, Esc annulla.
  let dragging: {
    readonly row: TimelineRow;
    readonly grip: TimelineGrip;
    readonly mark: HTMLElement;
    readonly track: HTMLElement;
    readonly pointer: number;
    readonly fromX: number;
    readonly fromDay: IsoDay;
    readonly width: number;
    readonly left: number;
    delta: number;
    moved: boolean;
  } | null = null;
  const dayUnder = (x: number, left: number, width: number) => dayAt((x - left) / width, columns);
  const preview = (delta: number): void => {
    if (!dragging) return;
    dragging.delta = delta;
    const dates = movedSpan(dragging.row.span, dragging.grip, delta);
    const span: TimelineSpan = { ...dragging.row.span, ...dates };
    const shape = spanShape(span, columns);
    const label = dragging.mark.querySelector<HTMLElement>(".base-tl-label");
    if (label) label.textContent = spanText(span);
    if (!shape || isOff(shape)) return;
    dragging.mark.style.setProperty("--tl-left", `${shape.left * 100}%`);
    dragging.mark.style.setProperty("--tl-width", `${(shape.right - shape.left) * 100}%`);
    if (shape.kind === "point") dragging.mark.dataset.flip = String(shape.left > 0.75);
  };
  const stopDrag = (): void => {
    if (!dragging) return;
    const { mark, track, pointer } = dragging;
    delete mark.dataset.dragging;
    delete track.dataset.dragging;
    if (mark.hasPointerCapture?.(pointer)) mark.releasePointerCapture(pointer);
    dragging = null;
  };
  grid.addEventListener("pointerdown", (down) => {
    if (down.button !== 0 || dragging) return;
    const target = down.target instanceof Element ? down.target : null;
    const mark = target?.closest<HTMLElement>(".base-tl-bar, .base-tl-point");
    if (!mark) return;
    const track = mark.closest<HTMLElement>(".base-tl-track")!;
    const row = rowOf.get(track.closest<HTMLElement>(".base-tl-row")!.dataset.doc!)!;
    const grip = (target?.closest<HTMLElement>(".base-tl-edge")?.dataset.grip ?? "move") as TimelineGrip;
    // La riga presa col puntatore ha il fuoco, senza l'anello della tastiera.
    track.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
    if (!canMove(row, grip)) return;
    const box = track.getBoundingClientRect();
    if (box.width <= 0) return;
    down.preventDefault();
    mark.setPointerCapture?.(down.pointerId);
    dragging = { row, grip, mark, track, pointer: down.pointerId, fromX: down.clientX, fromDay: dayUnder(down.clientX, box.left, box.width), width: box.width, left: box.left, delta: 0, moved: false };
  });
  grid.addEventListener("pointermove", (move) => {
    if (!dragging || move.pointerId !== dragging.pointer) return;
    if (!dragging.moved && Math.abs(move.clientX - dragging.fromX) < 3) return;
    if (!dragging.moved) {
      dragging.moved = true;
      dragging.mark.dataset.dragging = "true";
      dragging.track.dataset.dragging = "true";
    }
    const delta = daysBetween(dragging.fromDay, dayUnder(move.clientX, dragging.left, dragging.width));
    if (delta !== dragging.delta) preview(delta);
  });
  grid.addEventListener("pointerup", (up) => {
    if (!dragging || up.pointerId !== dragging.pointer) return;
    const { row, grip, moved, delta } = dragging;
    stopDrag();
    // Un clic senza trascinare apre la nota, come nel calendario.
    if (!moved) { input.open(row.doc); return; }
    const dates = movedSpan(row.span, grip, delta);
    if (dates.start === undefined && dates.end === undefined) { input.redraw(); return; }
    state.focus = row.doc;
    input.move(row, dates);
  });
  const cancel = (): void => {
    if (!dragging) return;
    const { row, track } = dragging;
    stopDrag();
    shapeOf(row, track, row.span);
  };
  // Una barra che non si sposta (sola lettura, una data che non è della
  // nota) si apre col clic; quella che si sposta si apre al rilascio senza
  // trascinare.
  grid.addEventListener("click", (click) => {
    const mark = click.target instanceof Element ? click.target.closest<HTMLElement>(".base-tl-bar, .base-tl-point") : null;
    if (!mark || mark.dataset.grip === "move") return;
    const doc = mark.closest<HTMLElement>(".base-tl-row")?.dataset.doc;
    if (doc !== undefined) input.open(doc);
  });
  grid.addEventListener("pointercancel", cancel);
  grid.addEventListener("lostpointercapture", (lost) => { if (dragging && lost.pointerId === dragging.pointer && !dragging.moved) stopDrag(); });
  grid.addEventListener("keydown", (key) => {
    if (key.key === "Escape" && dragging) { key.preventDefault(); key.stopPropagation(); cancel(); }
  }, true);

  // La griglia scorre di lato quando la Base è più stretta dei 600 px del
  // prototipo; la testa resta ferma.
  const scroll = document.createElement("div");
  scroll.className = "base-tl-scroll";
  scroll.append(grid);
  root.append(head, scroll);
  if (state.refocus) {
    // Durante una scrittura il fuoco si tiene, e il disegno che la chiude lo
    // rimette sulla riga.
    if (!input.busy) state.refocus = false;
    queueMicrotask(() => {
      const track = state.focus === null ? undefined : tracks.get(state.focus);
      if (track?.isConnected) track.focus();
    });
  }
  return root;
}

/// Il titolo dei giorni mostrati: «10 ago – 4 ott 2026», «Luglio – dicembre
/// 2026», «2025 – 2028».
function rangeTitle(state: TimelineState, lastDay: IsoDay, locale: string): string {
  // Le due date a parte: `formatRange` di ICU scrive «04 ott» in certe lingue.
  const from = utcOf(state.start), to = utcOf(lastDay);
  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  const options: Intl.DateTimeFormatOptions = state.zoom === "weeks"
    ? { day: "numeric", month: "short", timeZone: "UTC" }
    : state.zoom === "months" ? { month: "long", timeZone: "UTC" } : { timeZone: "UTC" };
  const withYear = new Intl.DateTimeFormat(locale, { ...options, year: "numeric" });
  const first = sameYear && state.zoom !== "years" ? new Intl.DateTimeFormat(locale, options) : withYear;
  return `${first.format(from)} – ${withYear.format(to)}`.replace(/\.(?=\s|$)/g, "");
}

/// Il nome di una colonna: il primo giorno della settimana, il mese (con
/// l'anno a gennaio e nella prima colonna), l'anno.
function columnLabel(column: TimelineColumn, index: number, zoom: TimelineZoom, locale: string): string {
  const day = utcOf(column.start);
  const options: Intl.DateTimeFormatOptions = zoom === "weeks"
    ? { day: "numeric", month: "short", timeZone: "UTC" }
    : zoom === "months"
      ? { month: "short", ...(index === 0 || day.getUTCMonth() === 0 ? { year: "numeric" } : {}), timeZone: "UTC" }
      : { year: "numeric", timeZone: "UTC" };
  return new Intl.DateTimeFormat(locale, options).format(day).replace(/\.(?=\s|$)/g, "");
}

/// La linea del tempo senza la sua proprietà d'inizio: lo dice, e se la Base
/// può scrivere il file offre le proprietà data delle note.
function noStartKey(input: TimelineInput): HTMLElement {
  const box = document.createElement("div");
  box.className = "base-tl-empty";
  const line = document.createElement("p");
  line.textContent = t("base.timeline.no_start_key");
  box.append(line);
  if (input.dateChoices === null) return box;
  if (input.dateChoices.length === 0) {
    const hint = document.createElement("p");
    hint.textContent = t("base.calendar.no_date_props");
    box.append(hint);
    return box;
  }
  const choose = document.createElement("select");
  choose.className = "base-tl-start-key";
  choose.setAttribute("aria-label", t("base.timeline.choose_start"));
  const prompt = document.createElement("option");
  prompt.value = "";
  prompt.textContent = t("base.timeline.choose_start");
  prompt.disabled = true;
  prompt.selected = true;
  choose.append(prompt, ...input.dateChoices.map((key) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = key;
    return option;
  }));
  choose.addEventListener("change", () => { if (choose.value) input.chooseStartKey(choose.value); });
  box.append(choose);
  return box;
}
