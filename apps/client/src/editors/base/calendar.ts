// La vista Calendario della Base (T17): un mese, con le note nei giorni della
// proprietà data della vista (`fub.date`, il giorno che `derive` dice per ogni
// riga). Trascinare una nota su un altro giorno, o Maiusc con le frecce,
// riscrive la data nella nota con `note.property.set`: la superficie fa la
// scrittura (con il valore letto come confronto, e l'annulla), qui si
// disegna il mese e si decide che cosa scrivere.
//
// Il prototipo è `PLAN-ui/editor.html` (`.cal`, `.dow`, `.out`, `.d`,
// `.today`, `.over`, `.ev`, riga 430; il passo «Bacheca e calendario»).
import { plural, t } from "../../i18n/strings";
import { iconEl } from "../../ui/icons";
import type { BaseRow } from "./data";
import { sameKey } from "./sort";
import { viewKeyPicker } from "./view-keys";

/// Quante note un giorno mostra prima di raccogliere le altre in «+N».
export const DAY_LIMIT = 3;
/// Il tipo dei dati di un trascinamento di una nota della Base.
export const BASE_DOC_MIME = "application/x-fub-base-doc";

/// Un giorno civile, `2026-11-14`.
export type IsoDay = string;

/// Lo stato del calendario che sopravvive a un ridisegno (una nota salvata,
/// la lingua): il mese mostrato, il giorno col fuoco, la nota scelta e i
/// giorni aperti oltre «+N». È della superficie, come lo scroll: il file
/// `.base` non lo conosce.
export interface CalendarState {
  year: number;
  /// Da 1 a 12.
  month: number;
  /// Il giorno su cui stanno le frecce.
  focus: IsoDay;
  /// La nota che Maiusc con le frecce sposta, se è nel giorno del fuoco.
  chosen: string | null;
  /// I giorni che mostrano tutte le note, non solo le prime tre.
  readonly expanded: Set<IsoDay>;
  /// Al prossimo disegno il fuoco torna sul giorno (o sulla nota scelta, se
  /// c'è ancora lì): dopo un gesto da tastiera che ha ridisegnato il mese.
  refocus: "day" | "note" | null;
}

/// Lo stato di partenza: il mese di oggi, col fuoco su oggi.
export function calendarState(today: IsoDay): CalendarState {
  const [year, month] = today.split("-").map(Number) as [number, number];
  return { year, month, focus: today, chosen: null, expanded: new Set(), refocus: null };
}

/// Oggi, nel fuso di chi guarda.
export function localDay(now: Date = new Date()): IsoDay {
  return isoOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function isoOf(year: number, month: number, day: number): IsoDay {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function utcOf(day: IsoDay): Date {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date));
}

/// Il giorno `count` giorni dopo (o prima) di `day`. In UTC: l'ora legale non
/// salta né ripete un giorno.
export function addDays(day: IsoDay, count: number): IsoDay {
  const date = utcOf(day);
  date.setUTCDate(date.getUTCDate() + count);
  return isoOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/// Il primo giorno della settimana nella lingua (0 domenica … 6 sabato), dal
/// browser (`Intl.Locale`) dove lo sa dire. Altrimenti il lunedì, tranne le
/// lingue che cominciano di domenica in quasi tutti i loro paesi.
export function firstWeekday(locale: string): number {
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay?: number };
      weekInfo?: { firstDay?: number };
    };
    const firstDay = (info.getWeekInfo?.() ?? info.weekInfo)?.firstDay;
    if (typeof firstDay === "number" && firstDay >= 1 && firstDay <= 7) return firstDay % 7;
  } catch {
    // Una lingua che Intl non conosce: il ripiego qui sotto.
  }
  return /^(en(-(us|ca|ph|in))?|ja|ko|he|pt-br|zh-tw|hi)$/i.test(locale) && !/^en-(gb|ie|au|nz)$/i.test(locale) ? 0 : 1;
}

/// Un giorno della griglia del mese.
export interface CalendarCell {
  readonly day: IsoDay;
  /// Il numero del giorno nel mese.
  readonly date: number;
  /// Il giorno è del mese mostrato, non di quello prima o dopo.
  readonly inMonth: boolean;
}

/// Le settimane del mese `month` (da 1 a 12) di `year`, ognuna di sette giorni
/// a partire da `weekStart` (0 domenica): i giorni del mese prima e del mese
/// dopo completano la prima e l'ultima settimana, come nel prototipo.
export function monthWeeks(year: number, month: number, weekStart: number): CalendarCell[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() - weekStart + 7) % 7;
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const count = Math.ceil((lead + length) / 7) * 7;
  const start = addDays(isoOf(year, month, 1), -lead);
  const weeks: CalendarCell[][] = [];
  for (let index = 0; index < count; index++) {
    const day = addDays(start, index);
    const [y, m, d] = day.split("-").map(Number) as [number, number, number];
    if (index % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1]!.push({ day, date: d, inMonth: y === year && m === month });
  }
  return weeks;
}

/// Il valore da scrivere perché una data passi al giorno `day`, nella forma
/// che `note.property.set` legge. La data resta quella che era: una data
/// sola resta una data sola, una data con l'ora tiene ora, minuti, secondi e
/// fuso. `null` se il valore non è una data (un testo, una lista).
export function movedDateValue(raw: unknown, day: IsoDay): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { kind, value } = raw as { kind?: unknown; value?: unknown };
  if (kind !== "date" || !value || typeof value !== "object") return null;
  const time = (value as { time?: unknown }).time;
  if (time === null || time === undefined) return day;
  if (typeof time !== "object") return null;
  const { hour, minute, second, offset_minutes: offset } = time as Record<string, unknown>;
  const two = (n: number) => String(n).padStart(2, "0");
  const whole = (n: unknown, max: number): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max;
  if (!whole(hour, 23) || !whole(minute, 59) || !whole(second, 60)) return null;
  let zone = "";
  if (typeof offset === "number" && Number.isInteger(offset)) {
    const size = Math.abs(offset);
    zone = offset === 0 ? "Z" : `${offset < 0 ? "-" : "+"}${two(Math.floor(size / 60))}:${two(size % 60)}`;
  } else if (offset !== null && offset !== undefined) return null;
  return `${day}T${two(hour)}:${two(minute)}${second ? `:${two(second)}` : ""}${zone}`;
}

/// Ciò che il calendario chiede alla superficie.
export interface CalendarInput {
  readonly rows: readonly BaseRow[];
  readonly state: CalendarState;
  readonly locale: string;
  readonly today: IsoDay;
  /// La proprietà data della vista, `null` se il file non la dice.
  readonly dateKey: string | null;
  /// Il nome di una nota come la Base lo mostra.
  readonly title: (doc: string) => string;
  /// La nota si può spostare: la Base non è in sola lettura, la data è una
  /// proprietà della nota e il suo valore è una data.
  readonly movable: (row: BaseRow) => boolean;
  /// Una scrittura in corso: niente gesti finché non finisce.
  readonly busy: boolean;
  /// Le proprietà data che le note hanno, per scegliere quella della vista
  /// quando il file non la dice; `null` se la Base non può scrivere il file.
  readonly dateChoices: readonly string[] | null;
  /// Il nome da mostrare di una proprietà (il `display_name` del file).
  readonly labelOf?: (key: string) => string;
  readonly chooseDateKey: (key: string) => void;
  readonly open: (doc: string) => void;
  readonly move: (row: BaseRow, day: IsoDay) => void;
  /// Ridisegna il calendario dallo stato (un mese cambiato, un giorno aperto).
  readonly redraw: () => void;
}

/// Il numero dell'ultimo titolo di mese: la griglia lo nomina per id.
let titles = 0;

/// Il calendario del mese dello stato, come elemento da mettere nella Base.
export function renderCalendar(input: CalendarInput): HTMLElement {
  const { state, locale } = input;
  const root = document.createElement("div");
  root.className = "base-calendar";
  if (input.dateKey === null) {
    root.append(noDateKey(input));
    return root;
  }
  const byDay = new Map<IsoDay, BaseRow[]>();
  let undated = 0;
  for (const row of input.rows) {
    if (!row.day) { undated++; continue; }
    const list = byDay.get(row.day);
    if (list) list.push(row);
    else byDay.set(row.day, [row]);
  }
  const rowOf = new Map(input.rows.map((row) => [row.doc, row]));
  const weekStart = firstWeekday(locale);
  const weeks = monthWeeks(state.year, state.month, weekStart);
  const shown = weeks.flat();
  // Il fuoco su un giorno che il mese non mostra (un mese cambiato coi
  // pulsanti) torna al primo del mese, o a oggi se è di questo mese.
  if (!shown.some((cell) => cell.inMonth && cell.day === state.focus)) {
    const todayHere = shown.some((cell) => cell.inMonth && cell.day === input.today);
    state.focus = todayHere ? input.today : isoOf(state.year, state.month, 1);
  }

  const monthName = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(utcOf(isoOf(state.year, state.month, 1)));
  const monthTitle = monthName.charAt(0).toLocaleUpperCase(locale) + monthName.slice(1);
  const longDay = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const weekdayShort = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });

  // La testa: il mese, i due passi e «Oggi»; a destra le note senza data.
  const head = document.createElement("div");
  head.className = "base-cal-head";
  // Un `h2`: il titolo che lo precede nella pagina cambia con la larghezza
  // (a finestra stretta e al telefono il cassetto delle note, col suo `h2`,
  // non c'è), e un `h3` lì salterebbe un livello.
  const title = document.createElement("h2");
  title.className = "base-cal-title";
  title.textContent = monthTitle;
  title.id = `base-cal-title-${++titles}`;
  const step = (by: number) => {
    const at = new Date(Date.UTC(state.year, state.month - 1 + by, 1));
    state.year = at.getUTCFullYear();
    state.month = at.getUTCMonth() + 1;
    input.redraw();
  };
  const nav = (className: string, label: string, run: () => void, figure: string | null): HTMLButtonElement => {
    const each = document.createElement("button");
    each.type = "button";
    each.className = `base-cal-nav ${className}`;
    if (figure) {
      const icon = iconEl(figure);
      if (icon) { icon.setAttribute("aria-hidden", "true"); each.append(icon); }
      each.setAttribute("aria-label", label);
      each.title = label;
    } else each.textContent = label;
    each.addEventListener("click", run);
    return each;
  };
  head.append(
    nav("base-cal-prev", t("base.calendar.previous"), () => step(-1), "chevron"),
    title,
    nav("base-cal-next", t("base.calendar.next"), () => step(1), "chevron"),
    nav("base-cal-today", t("base.calendar.today"), () => {
      const [year, month] = input.today.split("-").map(Number) as [number, number];
      state.year = year;
      state.month = month;
      state.focus = input.today;
      state.refocus = "day";
      input.redraw();
    }, null),
  );
  if (undated > 0) {
    const note = document.createElement("span");
    note.className = "base-cal-undated";
    note.textContent = plural(undated, "base.calendar.undated_one", "base.calendar.undated_other", { count: undated });
    head.append(note);
  }
  // La proprietà della data, che si cambia da qui (IMP-3810): in sola
  // lettura e in una Base dentro una nota si vede soltanto.
  const dateKey = input.dateKey;
  head.append(viewKeyPicker({
    className: "base-cal-date", label: t("base.calendar.date_key"),
    choices: input.dateChoices ?? [], current: dateKey,
    labelOf: input.labelOf ?? ((key) => key), same: sameKey,
    disabled: input.dateChoices === null || input.busy,
    choose: input.chooseDateKey,
  }));

  const grid = document.createElement("div");
  grid.className = "base-cal-grid";
  grid.setAttribute("role", "grid");
  grid.setAttribute("aria-labelledby", title.id);
  grid.setAttribute("aria-description", t("base.calendar.keys"));
  if (input.busy) grid.setAttribute("aria-busy", "true");
  const headRow = document.createElement("div");
  headRow.className = "base-cal-week";
  headRow.setAttribute("role", "row");
  for (const cell of weeks[0] ?? []) {
    const name = document.createElement("div");
    name.className = "base-cal-dow";
    name.setAttribute("role", "columnheader");
    name.textContent = weekdayShort.format(utcOf(cell.day)).replace(/\.$/, "");
    headRow.append(name);
  }
  grid.append(headRow);

  const cells = new Map<IsoDay, HTMLElement>();
  const event = (row: BaseRow): HTMLButtonElement => {
    const each = document.createElement("button");
    each.type = "button";
    each.className = "base-cal-event";
    each.dataset.doc = row.doc;
    each.textContent = input.title(row.doc);
    each.title = row.doc;
    each.tabIndex = -1;
    const movable = !input.busy && input.movable(row);
    each.draggable = movable;
    if (movable) {
      each.addEventListener("dragstart", (drag) => {
        if (!drag.dataTransfer) return;
        drag.dataTransfer.setData(BASE_DOC_MIME, row.doc);
        drag.dataTransfer.setData("text/plain", row.doc);
        drag.dataTransfer.effectAllowed = "move";
        each.dataset.dragging = "true";
      });
      each.addEventListener("dragend", () => {
        delete each.dataset.dragging;
        clearOver();
      });
    }
    each.addEventListener("click", () => input.open(row.doc));
    each.addEventListener("focus", () => { state.chosen = row.doc; });
    return each;
  };
  for (const week of weeks) {
    const line = document.createElement("div");
    line.className = "base-cal-week";
    line.setAttribute("role", "row");
    for (const cell of week) {
      const day = document.createElement("div");
      day.className = "base-cal-day";
      day.dataset.day = cell.day;
      day.setAttribute("role", "gridcell");
      if (!cell.inMonth) day.dataset.out = "true";
      if (cell.day === input.today) {
        day.dataset.today = "true";
        day.setAttribute("aria-current", "date");
      }
      const notes = byDay.get(cell.day) ?? [];
      const spoken = longDay.format(utcOf(cell.day));
      day.setAttribute("aria-label", notes.length === 0 ? spoken : plural(notes.length, "base.calendar.day_one", "base.calendar.day_other", { date: spoken, count: notes.length }));
      day.tabIndex = cell.day === state.focus ? 0 : -1;
      const number = document.createElement("span");
      number.className = "base-cal-num";
      number.textContent = String(cell.date);
      const weekday = document.createElement("span");
      weekday.className = "base-cal-weekday";
      weekday.setAttribute("aria-hidden", "true");
      weekday.textContent = weekdayShort.format(utcOf(cell.day)).replace(/\.$/, "");
      day.append(number, weekday);
      const open = state.expanded.has(cell.day);
      const visible = open || notes.length <= DAY_LIMIT ? notes : notes.slice(0, DAY_LIMIT);
      for (const row of visible) day.append(event(row));
      if (notes.length > DAY_LIMIT) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "base-cal-more";
        more.tabIndex = -1;
        const hidden = notes.length - DAY_LIMIT;
        more.textContent = open ? t("base.calendar.less") : t("base.calendar.more", { count: hidden });
        more.setAttribute("aria-expanded", String(open));
        if (!open) more.setAttribute("aria-label", t("base.calendar.more_label", { count: hidden }));
        more.addEventListener("click", () => {
          if (!state.expanded.delete(cell.day)) state.expanded.add(cell.day);
          state.focus = cell.day;
          state.refocus = "day";
          input.redraw();
        });
        day.append(more);
      }
      cells.set(cell.day, day);
      line.append(day);
    }
    grid.append(line);
  }

  // I pulsanti del giorno col fuoco sono nel giro del Tab; gli altri no:
  // le frecce vanno fra i giorni, il Tab fra le note del giorno.
  const reachable = (day: HTMLElement, on: boolean) => {
    for (const each of day.querySelectorAll<HTMLButtonElement>(".base-cal-event, .base-cal-more")) each.tabIndex = on ? 0 : -1;
  };
  reachable(cells.get(state.focus)!, true);
  const focusDay = (day: IsoDay): void => {
    const [year, month] = day.split("-").map(Number) as [number, number];
    if (year !== state.year || month !== state.month) {
      state.year = year;
      state.month = month;
      state.focus = day;
      state.refocus = "day";
      input.redraw();
      return;
    }
    const before = cells.get(state.focus);
    const next = cells.get(day);
    if (!next) return;
    if (before && before !== next) { before.tabIndex = -1; reachable(before, false); }
    state.focus = day;
    next.tabIndex = 0;
    reachable(next, true);
    next.focus();
  };
  // La nota che un gesto sposta: quella col fuoco, o la scelta del giorno, o
  // la prima.
  const noteIn = (day: HTMLElement, target: EventTarget | null): BaseRow | null => {
    const own = target instanceof HTMLElement ? target.closest<HTMLElement>(".base-cal-event") : null;
    const docs = [...day.querySelectorAll<HTMLElement>(".base-cal-event")].map((each) => each.dataset.doc!);
    const doc = own?.dataset.doc ?? (state.chosen !== null && docs.includes(state.chosen) ? state.chosen : docs[0]);
    return doc === undefined ? null : rowOf.get(doc) ?? null;
  };
  const STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  grid.addEventListener("keydown", (key) => {
    const day = key.target instanceof HTMLElement ? key.target.closest<HTMLElement>(".base-cal-day") : null;
    if (!day || key.altKey || key.ctrlKey || key.metaKey) return;
    const from = day.dataset.day!;
    const by = STEPS[key.key];
    if (by !== undefined) {
      key.preventDefault();
      const to = addDays(from, by);
      if (!key.shiftKey) { focusDay(to); return; }
      const row = noteIn(day, key.target);
      if (!row || input.busy || !input.movable(row)) return;
      state.chosen = row.doc;
      state.focus = to;
      state.refocus = "note";
      input.move(row, to);
      return;
    }
    if (key.key === "Enter" && key.target === day) {
      const row = noteIn(day, null);
      if (!row) return;
      key.preventDefault();
      input.open(row.doc);
    }
  });
  // Un clic su un giorno (non su una nota) gli dà il fuoco.
  grid.addEventListener("click", (click) => {
    const target = click.target instanceof HTMLElement ? click.target : null;
    if (!target || target.closest("button")) return;
    const day = target.closest<HTMLElement>(".base-cal-day");
    if (day) focusDay(day.dataset.day!);
  });

  // Il trascinamento: il giorno sotto la nota si accende, il rilascio scrive.
  let over: HTMLElement | null = null;
  const clearOver = () => { if (over) { delete over.dataset.over; over = null; } };
  const ours = (drag: DragEvent) => drag.dataTransfer?.types.includes(BASE_DOC_MIME) === true;
  grid.addEventListener("dragover", (drag) => {
    const day = drag.target instanceof Element ? drag.target.closest<HTMLElement>(".base-cal-day") : null;
    if (!day || !ours(drag) || input.busy) return;
    drag.preventDefault();
    if (drag.dataTransfer) drag.dataTransfer.dropEffect = "move";
    if (over === day) return;
    clearOver();
    over = day;
    day.dataset.over = "true";
  });
  grid.addEventListener("dragleave", (drag) => {
    const next = drag.relatedTarget instanceof Node ? drag.relatedTarget : null;
    if (!next || !grid.contains(next)) clearOver();
  });
  grid.addEventListener("drop", (drag) => {
    const day = drag.target instanceof Element ? drag.target.closest<HTMLElement>(".base-cal-day") : null;
    clearOver();
    if (!day || !ours(drag)) return;
    drag.preventDefault();
    const row = rowOf.get(drag.dataTransfer?.getData(BASE_DOC_MIME) ?? "");
    const to = day.dataset.day!;
    if (!row || row.day === to || input.busy || !input.movable(row)) return;
    state.chosen = row.doc;
    state.focus = to;
    input.move(row, to);
  });

  // La griglia scorre di lato quando la Base è più stretta del mese; la testa
  // resta ferma.
  const scroll = document.createElement("div");
  scroll.className = "base-cal-scroll";
  scroll.append(grid);
  root.append(head, scroll);
  if (state.refocus) {
    const wanted = state.refocus;
    // Durante una scrittura il fuoco si tiene, e il disegno che la chiude lo
    // rimette sulla nota arrivata.
    if (!input.busy) state.refocus = null;
    // Dopo che la superficie ha messo il calendario nella pagina.
    queueMicrotask(() => {
      const day = cells.get(state.focus);
      if (!day?.isConnected) return;
      const note = wanted === "note" && state.chosen !== null
        ? [...day.querySelectorAll<HTMLElement>(".base-cal-event")].find((each) => each.dataset.doc === state.chosen)
        : undefined;
      (note ?? day).focus();
    });
  }
  return root;
}

/// Il calendario senza la sua proprietà data: lo dice, e se la Base può
/// scrivere il file offre le proprietà data delle note.
function noDateKey(input: CalendarInput): HTMLElement {
  const box = document.createElement("div");
  box.className = "base-cal-empty";
  const line = document.createElement("p");
  line.textContent = t("base.calendar.no_date_key");
  box.append(line);
  if (input.dateChoices === null) return box;
  if (input.dateChoices.length === 0) {
    const hint = document.createElement("p");
    hint.className = "base-cal-empty-hint";
    hint.textContent = t("base.calendar.no_date_props");
    box.append(hint);
    return box;
  }
  const choose = document.createElement("select");
  choose.className = "base-cal-date-key";
  choose.setAttribute("aria-label", t("base.calendar.choose_date"));
  const prompt = document.createElement("option");
  prompt.value = "";
  prompt.textContent = t("base.calendar.choose_date");
  prompt.disabled = true;
  prompt.selected = true;
  choose.append(prompt, ...input.dateChoices.map((key) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = input.labelOf?.(key) ?? key;
    return option;
  }));
  choose.addEventListener("change", () => { if (choose.value) input.chooseDateKey(choose.value); });
  box.append(choose);
  return box;
}
