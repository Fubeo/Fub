// La scelta del giorno e dell'ora di un promemoria (E10, T36): si apre dalla
// pastiglia `⏰`, dal gruppo «Compito» della barra e dal «/». È il riquadro
// della data delle proprietà (T10, `.dp` del prototipo), con l'ora sempre in
// vista: il campo capisce le parole di T10 con un'ora («venerdì 9», «domani
// alle 18:30»), i giorni vicini e il mese scelgono il giorno all'ora del
// campo dell'ora, e ciò che non si capisce resta scritto e lo dice, senza
// toccare il promemoria di prima. Si carica al primo uso.
import { EditorView } from "@codemirror/view";
import { openPopover, type PopoverAnchor, type PopoverHandle } from "../../../../kit";
import { resolvedLanguage } from "../../../../i18n/strings";
import { openLifetime } from "../../../../ui/lifetime";
import { DEFAULT_REMINDER_TIME } from "../../../../rules/mirrored";
import { firstWeekday } from "../../../../state/dates";
import { isoDay, saidDay } from "./dates";
import { liveStrings } from "./strings";
import {
  alarmFigure,
  reminderLong,
  reminderNotificationsOn,
  reminderTaskAt,
  reminderTimeOf,
  saidReminder,
  writeReminder,
  type ReminderTime,
} from "./task-reminder";

/// Il riquadro aperto, uno per finestra: aprirne un altro chiude questo.
let open: PopoverHandle | null = null;

function button(className: string, text: string, label?: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = text;
  if (label) element.setAttribute("aria-label", label);
  return element;
}

function dateOf(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

function addDays(iso: string, days: number): string {
  const date = dateOf(iso);
  date.setDate(date.getDate() + days);
  return isoDay(date);
}

function addMonths(iso: string, months: number): string {
  const date = dateOf(iso);
  const first = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return isoDay(new Date(first.getFullYear(), first.getMonth(), Math.min(date.getDate(), last)));
}

/// Apre la scelta del promemoria del compito sulla riga di `pos`, ancorata ad
/// `anchor`. `false` se lì non c'è un compito o la nota non si scrive.
export function openReminderPicker(view: EditorView, pos: number, anchor: PopoverAnchor): boolean {
  if (view.state.readOnly || !view.state.facet(EditorView.editable)) return false;
  const task = reminderTaskAt(view.state, pos);
  if (!task) return false;
  open?.close();
  const own = openLifetime();
  const language = resolvedLanguage();
  const now = new Date();
  const today = isoDay(now);
  const firstDay = firstWeekday();
  const original = reminderTimeOf(task.reminder?.when ?? null);
  let selected: string | null = original?.date ?? null;
  let cursor = selected ?? today;
  const boxFrom = task.boxFrom;

  const body = document.createElement("div");
  body.className = "cm-fub-prop-date cm-fub-reminder-picker";
  const field = document.createElement("div");
  field.className = "cm-fub-prop-date-field";
  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.placeholder = liveStrings.t("reminder.picker.placeholder");
  input.setAttribute("aria-label", liveStrings.t("reminder.picker.input"));
  field.append(alarmFigure(), input);

  const quick = document.createElement("div");
  quick.className = "cm-fub-prop-date-quick";
  for (const [label, day] of [
    ["page.properties.date.today", today],
    ["page.properties.date.tomorrow", addDays(today, 1)],
    ["page.properties.date.week", addDays(today, 7)],
    ["page.properties.date.friday", saidDay("venerdì", now, firstDay, language) ?? addDays(today, 7)],
  ] as const) {
    const choice = button("cm-fub-prop-date-choice", liveStrings.t(label));
    choice.dataset.quick = day;
    own.listen(choice, "click", () => write({ date: day, time: clock() }));
    quick.append(choice);
  }

  const head = document.createElement("div");
  head.className = "cm-fub-prop-date-head";
  const previous = button("cm-fub-prop-date-nav", "‹", liveStrings.t("page.properties.date.previous"));
  const next = button("cm-fub-prop-date-nav", "›", liveStrings.t("page.properties.date.next"));
  const title = document.createElement("span");
  title.setAttribute("aria-live", "polite");
  head.append(previous, title, next);

  const grid = document.createElement("div");
  grid.className = "cm-fub-prop-date-grid";
  grid.setAttribute("role", "group");

  const timeRow = document.createElement("label");
  timeRow.className = "cm-fub-prop-date-time";
  const timeLabel = document.createElement("span");
  timeLabel.textContent = liveStrings.t("reminder.picker.time");
  const timeInput = document.createElement("input");
  timeInput.type = "time";
  timeInput.value = original?.time ?? DEFAULT_REMINDER_TIME;
  timeRow.append(timeLabel, timeInput);

  const note = document.createElement("p");
  note.className = "cm-fub-prop-note";
  note.setAttribute("role", "alert");
  const say = (text: string | null) => {
    note.hidden = text === null;
    note.textContent = text ?? "";
  };
  say(null);
  // Le notifiche spente non fermano il promemoria: resta nella nota e
  // nell'elenco all'avvio. Lo si dice qui, dove lo si sceglie.
  const silent = document.createElement("p");
  silent.className = "cm-fub-reminder-silent";
  silent.textContent = liveStrings.t("reminder.picker.off");
  silent.hidden = reminderNotificationsOn();

  const foot = document.createElement("div");
  foot.className = "cm-fub-prop-date-foot";
  const clear = button("cm-fub-prop-date-action", liveStrings.t("reminder.picker.clear"));
  foot.append(clear);
  // «Togli il promemoria» c'è soltanto dove c'è un promemoria da togliere.
  body.append(field, quick, head, grid, timeRow, note, silent, ...(task.reminder ? [foot] : []));

  const clock = () => (/^\d{2}:\d{2}$/.test(timeInput.value) ? timeInput.value : DEFAULT_REMINDER_TIME);

  const weekdays = (() => {
    const format = new Intl.DateTimeFormat(language, { weekday: "narrow" });
    // Il 5 gennaio 2026 è un lunedì: la settimana comincia da lì.
    return Array.from({ length: 7 }, (_, i) => format.format(new Date(2026, 0, 5 + i)));
  })();

  const drawGrid = (focus: boolean) => {
    const first = dateOf(`${cursor.slice(0, 7)}-01`);
    const month = new Intl.DateTimeFormat(language, { month: "long", year: "numeric" }).format(first);
    title.textContent = month;
    grid.setAttribute("aria-label", month);
    const lead = (first.getDay() + 6) % 7;
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const cells: HTMLElement[] = weekdays.map((name) => {
      const cell = document.createElement("span");
      cell.setAttribute("aria-hidden", "true");
      cell.textContent = name;
      return cell;
    });
    const long = new Intl.DateTimeFormat(language, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    for (let i = -lead; i < days; i++) {
      const day = isoDay(new Date(first.getFullYear(), first.getMonth(), i + 1));
      const cell = button("cm-fub-prop-date-day", String(dateOf(day).getDate()), long.format(dateOf(day)));
      cell.dataset.day = day;
      if (i < 0) cell.dataset.outside = "";
      if (day === today) {
        cell.dataset.today = "";
        cell.setAttribute("aria-current", "date");
      }
      cell.setAttribute("aria-pressed", String(day === selected));
      if (day === selected) cell.dataset.selected = "";
      cell.tabIndex = day === cursor ? 0 : -1;
      cells.push(cell);
    }
    grid.replaceChildren(...cells);
    if (focus) grid.querySelector<HTMLButtonElement>(`[data-day="${cursor}"]:not([data-outside])`)?.focus();
  };

  /// Scrive il promemoria (o lo toglie con `null`) sul compito di adesso: se
  /// intanto la riga non è più quel compito, non scrive e lo dice.
  const write = (when: ReminderTime | null): void => {
    const fresh = reminderTaskAt(view.state, Math.min(pos, view.state.doc.length));
    if (!fresh || fresh.boxFrom !== boxFrom) {
      say(liveStrings.t("reminder.picker.gone"));
      return;
    }
    const spec = writeReminder(view.state, fresh, when);
    popover.close();
    if (spec) view.dispatch(spec);
    view.focus();
  };

  own.listen(grid, "click", (event) => {
    const cell = (event.target as Element).closest<HTMLElement>("[data-day]");
    if (cell?.dataset.day) write({ date: cell.dataset.day, time: clock() });
  });
  own.listen(grid, "keydown", (event) => {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(cursor, -1),
      ArrowRight: () => addDays(cursor, 1),
      ArrowUp: () => addDays(cursor, -7),
      ArrowDown: () => addDays(cursor, 7),
      PageUp: () => addMonths(cursor, -1),
      PageDown: () => addMonths(cursor, 1),
      Home: () => addDays(cursor, -((dateOf(cursor).getDay() + 6) % 7)),
      End: () => addDays(cursor, 6 - ((dateOf(cursor).getDay() + 6) % 7)),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    event.stopPropagation();
    cursor = move();
    drawGrid(true);
  });
  own.listen(previous, "click", () => {
    cursor = addMonths(cursor, -1);
    drawGrid(false);
  });
  own.listen(next, "click", () => {
    cursor = addMonths(cursor, 1);
    drawGrid(false);
  });
  const understood = () => saidReminder(input.value, new Date(), firstDay, language);
  // Mentre si scrive, il giorno capito si vede scelto nel suo mese e l'ora
  // nel suo campo; il campo vuoto torna al promemoria di prima.
  own.listen(input, "input", () => {
    const parsed = understood();
    const empty = input.value.trim() === "";
    input.toggleAttribute("aria-invalid", !empty && !parsed);
    say(null);
    if (parsed || empty) {
      selected = parsed?.date ?? original?.date ?? null;
      cursor = selected ?? today;
      timeInput.value = parsed?.time ?? original?.time ?? DEFAULT_REMINDER_TIME;
      drawGrid(false);
    }
  });
  own.listen(input, "keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    if (input.value.trim() === "") return;
    const parsed = understood();
    if (!parsed) {
      selected = original?.date ?? null;
      cursor = selected ?? today;
      timeInput.value = original?.time ?? DEFAULT_REMINDER_TIME;
      drawGrid(false);
      say(liveStrings.t("reminder.picker.invalid", { text: input.value.trim() }));
      return;
    }
    write(parsed);
  });
  own.listen(timeInput, "keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    write({ date: selected ?? cursor, time: clock() });
  });
  own.listen(clear, "click", () => write(null));

  drawGrid(false);
  const label = original
    ? liveStrings.t("reminder.picker.label_set", { when: reminderLong(original, language) })
    : liveStrings.t("reminder.picker.label");
  const popover = openPopover({
    anchor,
    content: body,
    label,
    role: "dialog",
    placement: "bottom",
    align: "start",
    className: "cm-fub-page-popover cm-fub-prop-popover",
    lifetime: own,
    onClose: () => {
      own.close();
      if (open === popover) open = null;
    },
  });
  open = popover;
  input.focus();
  return true;
}

/// Il punto del cursore come ancora: per la barra e il «/», che non hanno
/// una pastiglia sotto la mano.
export function caretAnchor(view: EditorView, pos: number): PopoverAnchor {
  return {
    getBoundingClientRect: () => {
      const box = view.coordsAtPos(Math.min(pos, view.state.doc.length));
      const fallback = view.contentDOM.getBoundingClientRect();
      return box
        ? { left: box.left, top: box.top, width: Math.max(1, box.right - box.left), height: box.bottom - box.top }
        : { left: fallback.left, top: fallback.top, width: 1, height: 1 };
    },
  };
}
