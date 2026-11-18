// Gli editor dei valori della testata (T8, T9), uno per tipo. Testo, numero e
// indirizzo si scrivono in riga; la casella si spunta col clic o con Spazio;
// data, elenco, etichette, persone, Selezione e Stato aprono un riquadro.
// Ogni modifica è una
// scrittura sola, con un passo d'annullamento suo (`PropertyRowHost.write`),
// e porta l'impronta del valore di quando l'editor si è aperto: se nel
// frattempo il valore è cambiato (un altro riquadro, il file da fuori) non si
// scrive, l'editor resta aperto con ciò che si stava scrivendo e lo dice; una
// seconda conferma scrive.
import type { PropertyType } from "../../../../../../host/enums.generated";
import { createList, openPopover, type PopoverHandle } from "../../../../../../kit";
import { resolvedLanguage } from "../../../../../../i18n/strings";
import { iconEl } from "../../../../../../ui/icons";
import { openLifetime, type Lifetime } from "../../../../../../ui/lifetime";
import type { PropertyEntry, PropertyWrite } from "../../properties";
import { saidDay } from "../../dates";
import { firstWeekday } from "../../../../../../state/dates";
import { liveStrings } from "../../strings";
import { freeColor, KIND_ICONS, linkName, linkTo, OPTION_GROUPS, optionsOf, parseNumber, targetOf, validDate, type OptionGroup, type PropertyOption, type RelationTarget, type RowKind } from "./kind";
import { entryStamp, longDate, optionElement, personElement, relationItems, type PropertyRowHost, type RelationNote, type WriteOutcome } from "./values";
import { errorText } from "../../../../../../host/errors";

/// Un editor aperto su una chiave: l'impronta che porta alla scrittura.
interface Session {
  readonly key: string;
  readonly host: PropertyRowHost;
  expected: string | null;
}

function session(entry: PropertyEntry, host: PropertyRowHost): Session {
  return { key: entry.key, host, expected: entryStamp(host.current(entry.key) ?? entry) };
}

/// Scrive e aggiorna l'impronta: dopo una scrittura riuscita il valore nuovo
/// è il nostro; dopo un conflitto chi conferma di nuovo scrive su quello che
/// ha visto.
function commit(session: Session, value: PropertyWrite | null): WriteOutcome {
  const outcome = session.host.write(session.key, value, session.expected);
  if (outcome !== "refused") session.expected = entryStamp(session.host.current(session.key));
  return outcome;
}

function conflictText(session: Session): string {
  return liveStrings.t("page.properties.conflict", { key: session.key, value: session.host.current(session.key)?.value ?? "" });
}

/// La riga che dice un conflitto o un valore che non va, dentro un riquadro.
function noteElement(): HTMLParagraphElement {
  const note = document.createElement("p");
  note.className = "cm-fub-prop-note";
  note.setAttribute("role", "alert");
  note.hidden = true;
  return note;
}

function say(note: HTMLElement, text: string | null): void {
  note.hidden = text === null;
  note.textContent = text ?? "";
}

/// Il conflitto in un riquadro (elenco, persone): la frase, e il pulsante che
/// scrive ciò che si era scelto sul valore di adesso. Il gesto non si perde.
function sayConflict(note: HTMLElement, text: string, own: Lifetime, confirm: () => void): void {
  say(note, text);
  const again = button("cm-fub-prop-note-action", liveStrings.t("page.properties.conflict.confirm"));
  own.listen(again, "click", confirm);
  note.append(" ", again);
}

/// Apre l'editor del tipo della riga sul valore `value`.
export function openEditor(entry: PropertyEntry, kind: RowKind, value: HTMLButtonElement, host: PropertyRowHost, life: Lifetime): void {
  switch (kind.kind) {
    case "date":
    case "date_time":
      openDateEditor(entry, kind.kind, value, host, life, kind.declared);
      return;
    case "list":
    case "tags":
      openListEditor(entry, kind.kind, value, host, life);
      return;
    case "people":
      openPeopleEditor(entry, value, host, life);
      return;
    case "relation":
      openRelationEditor(entry, value, host, life);
      return;
    case "select":
    case "status":
      openOptionsEditor(entry, kind.kind, value, host, life);
      return;
    case "checkbox":
      toggleCheckbox(entry, host);
      return;
    default:
      openInlineEditor(entry, kind.kind === "number" ? "number" : kind.kind === "url" ? "url" : "text", value, host, life);
  }
}

/// La casella: un clic (o Spazio, Invio) la spunta o la toglie.
export function toggleCheckbox(entry: PropertyEntry, host: PropertyRowHost): void {
  const on = /^true$/i.test((host.current(entry.key) ?? entry).value.trim());
  const outcome = commit(session(entry, host), !on);
  if (outcome === "conflict") host.notify?.(liveStrings.t("page.properties.conflict", { key: entry.key, value: host.current(entry.key)?.value ?? "" }), "info");
}

/// Testo, numero, indirizzo: il valore diventa un campo al suo posto. Invio
/// o l'uscita scrivono, Esc torna al valore di prima. Un numero che non è un
/// numero non si scrive: il valore resta, e la testata lo dice.
export function openInlineEditor(entry: PropertyEntry, kind: "text" | "number" | "url", value: HTMLButtonElement, host: PropertyRowHost, life: Lifetime): void {
  const state = session(entry, host);
  const box = document.createElement("div");
  box.className = "cm-fub-page-prop-value";
  box.dataset.editing = "";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "cm-fub-prop-input";
  if (kind === "number") input.inputMode = "decimal";
  if (kind === "url") input.inputMode = "url";
  input.spellcheck = kind === "text";
  input.value = entry.value;
  input.setAttribute("aria-label", entry.key);
  box.append(input);
  host.editing(true);
  value.replaceWith(box);
  input.focus();
  input.select();
  let closed = false;
  const own = openLifetime();
  const close = (focus: boolean) => {
    if (closed) return;
    closed = true;
    own.close();
    if (box.isConnected) box.replaceWith(value);
    if (focus && value.isConnected) value.focus({ preventScroll: true });
    host.editing(false);
  };
  life.add(() => {
    closed = true;
    own.close();
  });
  /// `true`: l'editor si chiude; `false`: resta aperto (un conflitto).
  const initial = input.value;
  const confirm = (): boolean => {
    // Un'uscita senza modifiche non scrive niente: il valore resta scritto
    // com'era (`007`, `1.10`, `'testo'`, gli spazi fra virgolette).
    if (input.value === initial && !box.hasAttribute("data-conflict")) return true;
    const text = input.value;
    let next: PropertyWrite = text;
    if (kind === "number" && text.trim() !== "") {
      const number = parseNumber(text);
      if (number === null) {
        host.notify?.(liveStrings.t("page.properties.not_number"), "info");
        return true;
      }
      next = number;
    }
    const outcome = commit(state, next);
    if (outcome === "conflict") {
      input.setAttribute("aria-invalid", "true");
      box.dataset.conflict = "";
      host.notify?.(conflictText(state), "info");
      return false;
    }
    return true;
  };
  own.listen(input, "keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (confirm()) close(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      // ↑ ↓ restano del campo: la testata non sposta il fuoco.
      event.stopPropagation();
    }
  });
  own.listen(input, "blur", () => {
    if (!closed && confirm()) close(false);
  });
}

/// Un riquadro della testata ancorato al valore: dura quanto `life`, e
/// mentre è aperto la testata non si rifà.
function popoverFor(anchor: HTMLElement, content: HTMLElement, label: string, host: PropertyRowHost, life: Lifetime, own: Lifetime): PopoverHandle {
  host.editing(true);
  anchor.setAttribute("aria-expanded", "true");
  return openPopover({
    anchor,
    content,
    label,
    role: "dialog",
    placement: "bottom",
    align: "start",
    className: "cm-fub-page-popover cm-fub-prop-popover",
    lifetime: life,
    onClose: () => {
      own.close();
      anchor.setAttribute("aria-expanded", "false");
      host.editing(false);
    },
  });
}

function button(className: string, text: string, label?: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = text;
  if (label) element.setAttribute("aria-label", label);
  return element;
}

// ——— le date ———

/// `aaaa-mm-gg` di una data locale.
export function isoOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateOf(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

function addDays(iso: string, days: number): string {
  const date = dateOf(iso);
  date.setDate(date.getDate() + days);
  return isoOf(date);
}

/// Lo stesso giorno `months` mesi dopo, o l'ultimo del mese se non c'è.
function addMonths(iso: string, months: number): string {
  const date = dateOf(iso);
  const day = date.getDate();
  const first = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return isoOf(new Date(first.getFullYear(), first.getMonth(), Math.min(day, last)));
}

/// Una data scritta nel campo, con la regola di `@` (`saidDay`): «venerdì»,
/// «fra due settimane», «20 marzo», «3/4», `2026-03-20`, `20/3/2026`. Dopo,
/// un'ora facoltativa: «venerdì 18:30», «domani alle 9», `2026-03-20T10:30`.
/// `null` se non è un giorno del calendario o l'ora non è un'ora: niente si
/// indovina.
export function parseDateInput(text: string, today: Date = new Date(), firstDay = 1, locale = "it"): { date: string; time: string | null } | null {
  const value = text.trim();
  const date = saidDay(value, today, firstDay, locale);
  if (date !== null) return { date, time: null };
  const clock = /^(.+?)(?:T|\s+(?:alle ore|alle|ore|at)\s+|\s+)(\d{1,2}):(\d{2})$/iu.exec(value)
    ?? /^(.+?)\s+(?:alle ore|alle|ore|at)\s+(\d{1,2})(?:\.(\d{2}))?$/iu.exec(value);
  if (!clock) return null;
  const day = saidDay(clock[1]!, today, firstDay, locale);
  const hours = Number(clock[2]);
  const minutes = Number(clock[3] ?? "0");
  if (day === null || hours > 23 || minutes > 59) return null;
  return { date: day, time: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}` };
}

/// Data, e Data e ora: il campo per scriverla, i giorni vicini, il mese da
/// sfogliare. Nella griglia ← → cambiano giorno, ↑ ↓ settimana, Pagina su e
/// giù mese, Inizio e Fine vanno ai capi della settimana; Invio sceglie. Il
/// campo capisce le parole come `@` (`parseDateInput`): ciò che capisce si
/// vede subito nel mese; ciò che non capisce resta scritto, lo dice, e il
/// valore non cambia. Il file riceve sempre `AAAA-MM-GG` (con l'ora,
/// `AAAA-MM-GGTHH:MM`). «Aggiungi l'ora» su una proprietà dichiarata Data la
/// dichiara Data e ora (`declared`): ogni data di prima ci sta ancora.
export function openDateEditor(entry: PropertyEntry, kind: "date" | "date_time", anchor: HTMLButtonElement, host: PropertyRowHost, life: Lifetime, declared: PropertyType | null = null): PopoverHandle {
  const state = session(entry, host);
  const own = openLifetime();
  const language = resolvedLanguage();
  const raw = entry.value.trim();
  const now = new Date();
  const today = isoOf(now);
  const firstDay = firstWeekday();
  const original = validDate(raw.slice(0, 10)) ? raw.slice(0, 10) : null;
  let selected = original;
  let withTime = kind === "date_time";
  // Una Data dichiarata passa a Data e ora solo se il registro si può
  // scrivere; altrimenti l'ora non si offre.
  const timeAllowed = declared !== "date" || host.setType !== undefined;
  // L'ora com'era scritta: il separatore, e ciò che segue `HH:MM` (secondi,
  // fuso) resta finché l'ora non cambia.
  const stamp = /^\d{4}-\d{2}-\d{2}([T ])(\d{2}:\d{2})(.*)$/.exec(raw);
  const separator = stamp?.[1] ?? "T";
  let time = stamp?.[2] ?? "";
  const written = time;
  let cursor = selected ?? today;

  const body = document.createElement("div");
  body.className = "cm-fub-prop-date";
  const field = document.createElement("div");
  field.className = "cm-fub-prop-date-field";
  const icon = iconEl(KIND_ICONS.date);
  icon?.setAttribute("aria-hidden", "true");
  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.placeholder = liveStrings.t("page.properties.date.placeholder");
  input.setAttribute("aria-label", liveStrings.t("page.properties.date.input"));
  field.append(...(icon ? [icon] : []), input);

  const quick = document.createElement("div");
  quick.className = "cm-fub-prop-date-quick";
  for (const [label, day] of [
    ["page.properties.date.today", today],
    ["page.properties.date.tomorrow", addDays(today, 1)],
    ["page.properties.date.week", addDays(today, 7)],
    // Il venerdì che viene, con la regola delle parole: mai oggi.
    ["page.properties.date.friday", saidDay("venerdì", now, firstDay, language) ?? addDays(today, 7)],
  ] as const) {
    const choice = button("cm-fub-prop-date-choice", liveStrings.t(label));
    choice.dataset.quick = day;
    choice.title = longDate(day);
    own.listen(choice, "click", () => choose(day));
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
  timeLabel.textContent = liveStrings.t("page.properties.date.time");
  const timeInput = document.createElement("input");
  timeInput.type = "time";
  timeInput.value = time;
  timeRow.append(timeLabel, timeInput);

  const note = noteElement();
  const foot = document.createElement("div");
  foot.className = "cm-fub-prop-date-foot";
  const clear = button("cm-fub-prop-date-action", liveStrings.t("page.properties.date.clear"));
  const timeToggle = button("cm-fub-prop-date-action", "");
  foot.append(clear, timeToggle);
  body.append(field, quick, head, grid, timeRow, note, foot);

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
    for (let i = -lead; i < days; i++) {
      const day = isoOf(new Date(first.getFullYear(), first.getMonth(), i + 1));
      const cell = button("cm-fub-prop-date-day", String(dateOf(day).getDate()), longDate(day));
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

  const drawTime = () => {
    timeRow.hidden = !withTime;
    timeToggle.hidden = !withTime && !timeAllowed;
    // L'orologio davanti al testo, come nel prototipo: decorativo, il nome del
    // pulsante resta il testo.
    const figure = iconEl("clock");
    figure?.setAttribute("aria-hidden", "true");
    timeToggle.replaceChildren(...(figure ? [figure] : []), liveStrings.t(withTime ? "page.properties.date.remove_time" : "page.properties.date.add_time"));
  };

  /// Scrive la data (con l'ora, se c'è), o la toglie con `""`.
  const write = (date: string, at: string | null = null): void => {
    const hour = at ?? (timeInput.value || time);
    const clock = hour || "09:00";
    const value = date === "" ? "" : withTime ? `${date}${separator}${clock}${clock === written ? stamp?.[3] ?? "" : ""}` : date;
    const outcome = commit(state, value === "" ? "" : { date: value });
    if (outcome === "conflict") {
      say(note, conflictText(state));
      selected = date || null;
      drawGrid(false);
      return;
    }
    popover.close();
    if (withTime && date !== "" && declared === "date") void promote();
  };
  /// La proprietà dichiarata Data diventa Data e ora nel registro, come
  /// «Tipo» del menu, e lo dice: le date senza ora delle altre note ci
  /// stanno ancora. Se il registro non si scrive, il valore scritto resta e
  /// la riga lo segna fuori dal tipo.
  const promote = async (): Promise<void> => {
    if (!host.setType) return;
    const problem = await host.setType(entry.key, "date_time").catch((error: unknown) => errorText(error, "specie"));
    if (problem === null) host.notify?.(liveStrings.t("page.properties.date.with_time", { key: entry.key }), "info");
    else host.notify?.(liveStrings.t("page.properties.type.failed", { key: entry.key, reason: problem }), "guasto");
  };
  const understood = () => parseDateInput(input.value, new Date(), firstDay, language);
  const choose = (day: string) => write(day);

  own.listen(grid, "click", (event) => {
    const cell = (event.target as Element).closest<HTMLElement>("[data-day]");
    if (cell?.dataset.day) choose(cell.dataset.day);
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
  // Mentre si scrive, il giorno capito si vede scelto nel suo mese; il
  // campo vuoto torna al valore di prima. La frase sotto parlava del testo
  // di prima: si toglie.
  own.listen(input, "input", () => {
    const parsed = understood();
    const empty = input.value.trim() === "";
    input.toggleAttribute("aria-invalid", !empty && !parsed);
    say(note, null);
    if (parsed || empty) {
      selected = parsed?.date ?? original;
      cursor = selected ?? today;
      drawGrid(false);
    }
  });
  own.listen(input, "keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    if (input.value.trim() === "") return;
    const parsed = understood();
    if (!parsed) {
      // Il mese torna sul valore di prima, che è quello che resta: mentre
      // si scriveva poteva mostrare il giorno di un testo capito a metà.
      selected = original;
      cursor = selected ?? today;
      drawGrid(false);
      say(note, liveStrings.t("page.properties.date.invalid", { text: input.value.trim() }));
      return;
    }
    if (parsed.time && !timeAllowed) {
      say(note, liveStrings.t("page.properties.date.no_time", { key: entry.key }));
      return;
    }
    if (parsed.time) {
      withTime = true;
      time = parsed.time;
      timeInput.value = parsed.time;
      drawTime();
    }
    write(parsed.date, parsed.time);
  });
  own.listen(timeInput, "keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (selected ?? cursor) write(selected ?? cursor);
  });
  own.listen(clear, "click", () => write(""));
  own.listen(timeToggle, "click", () => {
    withTime = !withTime;
    drawTime();
    if (withTime) timeInput.focus();
    else if (selected) write(selected);
  });

  drawGrid(false);
  drawTime();
  const popover = popoverFor(anchor, body, liveStrings.t("page.properties.date.label", { key: entry.key }), host, life, own);
  input.focus();
  return popover;
}

// ——— elenchi ed etichette ———

/// Le voci scritte nel campo: divise alle virgole, senza `#` davanti a
/// un'etichetta.
function typedItems(text: string, tags: boolean): string[] {
  return text.split(",").map((part) => part.trim()).map((part) => tags ? part.replace(/^#+/, "").trim() : part).filter(Boolean);
}

/// Elenco ed Etichette: le voci come pastiglie, ognuna col suo «×», e un
/// campo per aggiungerne (Invio, anche più d'una divisa da virgole);
/// Backspace nel campo vuoto toglie l'ultima. Cento voci scorrono dentro il
/// riquadro.
export function openListEditor(entry: PropertyEntry, kind: "list" | "tags", anchor: HTMLButtonElement, host: PropertyRowHost, life: Lifetime): PopoverHandle {
  const state = session(entry, host);
  const own = openLifetime();
  const read = (current: PropertyEntry | undefined): string[] => current?.items ? [...current.items] : current?.value.trim() ? [current.value.trim()] : [];
  let items = read(host.current(entry.key) ?? entry);
  const body = document.createElement("div");
  body.className = "cm-fub-prop-list";
  const chips = document.createElement("div");
  chips.className = "cm-fub-prop-chips";
  chips.setAttribute("role", "list");
  chips.setAttribute("aria-label", liveStrings.t("page.properties.list.label", { key: entry.key }));
  const input = document.createElement("input");
  input.type = "text";
  input.className = "cm-fub-prop-list-input";
  input.placeholder = liveStrings.t("page.properties.list.add");
  input.setAttribute("aria-label", liveStrings.t("page.properties.list.add"));
  const note = noteElement();
  body.append(chips, input, note);

  const draw = () => {
    chips.replaceChildren(...items.map((item, index) => {
      const chip = document.createElement("span");
      chip.className = kind === "tags" ? "cm-fub-prop-chip cm-fub-prop-tag" : "cm-fub-prop-chip";
      chip.setAttribute("role", "listitem");
      const text = document.createElement("span");
      text.textContent = kind === "tags" ? `#${item}` : item;
      const remove = button("cm-fub-prop-chip-remove", "×", liveStrings.t("page.properties.list.remove", { item }));
      own.listen(remove, "click", () => {
        apply(items.filter((_, i) => i !== index));
        input.focus();
      });
      chip.append(text, remove);
      return chip;
    }));
    chips.hidden = items.length === 0;
  };
  /// Ciò che si era scelto quando il valore è cambiato sotto: resta
  /// mostrato, e Invio (o «Scrivi la mia») lo scrive.
  let pending: string[] | null = null;
  /// `true` se è scritto.
  const apply = (next: string[]): boolean => {
    const outcome = commit(state, next);
    if (outcome === "conflict") {
      pending = next;
      items = next;
      sayConflict(note, conflictText(state), own, () => {
        if (pending) apply(pending);
        input.focus();
      });
      draw();
      return false;
    }
    pending = null;
    if (outcome === "written") {
      items = next;
      say(note, null);
    }
    draw();
    return outcome === "written";
  };
  own.listen(input, "keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      const added = typedItems(input.value, kind === "tags").filter((item) => !items.includes(item));
      if (input.value.trim() === "") {
        // Un conflitto aperto: Invio conferma ciò che si era scelto.
        if (pending) apply(pending);
        else popover.close();
        return;
      }
      // Scritta o no (un conflitto la tiene fra le voci, da confermare), la
      // voce lascia il campo.
      if (added.length > 0) apply([...items, ...added]);
      else if (pending) apply(pending);
      input.value = "";
    } else if (event.key === "Backspace" && input.value === "" && items.length > 0) {
      event.preventDefault();
      apply(items.slice(0, -1));
    }
  });
  draw();
  const popover = popoverFor(anchor, body, liveStrings.t("page.properties.list.label", { key: entry.key }), host, life, own);
  input.focus();
  return popover;
}

// ——— persone ———

interface PersonOption {
  readonly id: string;
  readonly name: string;
  /// Il link che sta nel valore (`[[Anna Rossi]]`), o quello da scrivere.
  readonly link: string;
  readonly chosen: boolean;
  /// «Aggiungi «nome»»: una persona che la ricerca non ha trovato.
  readonly add: boolean;
}

/// Persone: un elenco di link a note. La ricerca propone le persone (la
/// cartella delle persone, o le note); un clic, Invio o Spazio ne mette una
/// o la toglie, e il valore resta un elenco di link `[[Nome]]`.
export function openPeopleEditor(entry: PropertyEntry, anchor: HTMLButtonElement, host: PropertyRowHost, life: Lifetime): PopoverHandle {
  const state = session(entry, host);
  const own = openLifetime();
  const read = (current: PropertyEntry | undefined): string[] => [...(current?.items ?? [])];
  let chosen = read(host.current(entry.key) ?? entry);
  let found: string[] = [];
  let query = "";
  let asked = 0;
  const body = document.createElement("div");
  body.className = "cm-fub-prop-people";
  const search = document.createElement("div");
  search.className = "cm-fub-prop-search";
  const icon = iconEl("search");
  icon?.setAttribute("aria-hidden", "true");
  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.placeholder = liveStrings.t("page.properties.people.search");
  input.setAttribute("aria-label", liveStrings.t("page.properties.people.search"));
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");
  search.append(...(icon ? [icon] : []), input);
  const list = document.createElement("div");
  list.className = "cm-fub-block-menu cm-fub-prop-options";
  list.setAttribute("aria-label", liveStrings.t("page.properties.people.label", { key: entry.key }));
  list.setAttribute("aria-multiselectable", "true");
  const empty = document.createElement("p");
  empty.className = "cm-fub-page-empty";
  empty.textContent = liveStrings.t("page.properties.people.none");
  const note = noteElement();
  body.append(search, list, empty, note);

  const options = (): PersonOption[] => {
    const names = new Set(chosen.map((link) => linkName(link).toLocaleLowerCase()));
    const wanted = query.trim().toLocaleLowerCase();
    const mine = chosen.filter((link) => wanted === "" || linkName(link).toLocaleLowerCase().includes(wanted))
      .map((link): PersonOption => ({ id: `c:${link}`, name: linkName(link), link, chosen: true, add: false }));
    const others = found.filter((name) => !names.has(name.toLocaleLowerCase()))
      .map((name): PersonOption => ({ id: `f:${name}`, name, link: linkTo(name), chosen: false, add: false }));
    const exact = query.trim() !== "" && (names.has(wanted) || found.some((name) => name.toLocaleLowerCase() === wanted));
    const add: PersonOption[] = query.trim() !== "" && !exact && !/[[\]|#]/.test(query)
      ? [{ id: `a:${query.trim()}`, name: query.trim(), link: linkTo(query.trim()), chosen: false, add: true }]
      : [];
    return [...mine, ...others, ...add];
  };

  const handle = createList<PersonOption>({
    container: list,
    role: "listbox",
    items: [],
    key: (option) => option.id,
    render: (option, row) => {
      if (option.add) {
        row.textContent = liveStrings.t("page.properties.people.add", { name: option.name });
        return;
      }
      const check = document.createElement("span");
      check.className = "cm-fub-page-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = option.chosen ? "✓" : "";
      row.replaceChildren(check, personElement(option.link));
    },
    selected: (option) => option.chosen,
    onActivate: (option) => {
      write(option.chosen ? chosen.filter((link) => link !== option.link) : [...chosen, option.link]);
    },
    owner: input,
    focus: "activedescendant",
    lifetime: own,
  });
  /// Scrive le persone scelte. Se il valore è cambiato sotto, la scelta resta
  /// (le spunte la mostrano), lo si dice, e «Scrivi la mia» la scrive.
  function write(next: string[]): void {
    const outcome = commit(state, next);
    if (outcome === "conflict") {
      chosen = next;
      sayConflict(note, conflictText(state), own, () => write(chosen));
    } else if (outcome === "written") {
      chosen = next;
      say(note, null);
    }
    refresh();
    input.focus();
  }
  /// `first`: una ricerca nuova attiva la prima proposta, che Invio sceglie.
  const refresh = (first = false) => {
    const items = options();
    handle.setItems(items);
    if (first) handle.setActive(items[0]?.id ?? null);
    empty.hidden = items.length > 0;
  };
  const look = (text: string) => {
    query = text;
    const question = ++asked;
    refresh(true);
    if (!host.searchPeople) return;
    void host.searchPeople(text).then((names) => {
      if (question !== asked || own.closed) return;
      found = names;
      refresh(true);
    }, () => {});
  };
  own.listen(input, "input", () => look(input.value));
  look("");
  const popover = popoverFor(anchor, body, liveStrings.t("page.properties.people.label", { key: entry.key }), host, life, own);
  input.focus();
  return popover;
}

// ——— Relazione ———

/// La pagina di un link `[[Libri/Dune|Il libro]]`, com'è scritta (`Libri/Dune`),
/// in minuscolo: due link alla stessa pagina sono la stessa nota.
function linkPage(link: string): string {
  return link.trim().replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0]!.split("#")[0]!.trim().toLocaleLowerCase();
}

/// Il link scelto e la nota trovata sono la stessa? La stessa pagina, o un
/// link scritto col nome solo (`[[Dune]]`) e una nota che si chiama così: è
/// il nome con cui il vault lo risolve. Senza risolvere non si sa di più.
function sameNote(chosen: string, found: RelationNote): boolean {
  const page = linkPage(chosen);
  const other = linkPage(found.link);
  if (page === other) return true;
  return !page.includes("/") && other.slice(other.lastIndexOf("/") + 1) === page;
}

/// La cartella di un documento, per la riga che la dice sotto il nome.
function folderOf(doc: string): string {
  const at = doc.lastIndexOf("/");
  return at < 0 ? "" : doc.slice(0, at);
}

/// Il nome che un bersaglio ha nell'interfaccia: il tipo per il suo nome
/// (`Libro`), la cartella per il suo percorso.
function targetLabel(target: RelationTarget): string {
  return target.kind === "type" ? target.page.slice(target.page.lastIndexOf("/") + 1) : target.path;
}

type RelationRow =
  | { readonly kind: "group"; readonly id: string }
  | { readonly kind: "chosen"; readonly id: string; readonly item: string }
  | { readonly kind: "found"; readonly id: string; readonly note: RelationNote }
  | { readonly kind: "create"; readonly id: string; readonly name: string };

/// Relazione (T35): la scelta di più note, con la ricerca ristretta al
/// bersaglio del registro (le note di un tipo, o di una cartella; senza,
/// ogni nota). Le note legate stanno in cima, spuntate; un clic, Invio o
/// Spazio ne mette una o la toglie. Un nome che non c'è si crea («Crea
/// «nome»», nel tipo o nella cartella del bersaglio) e diventa subito una
/// nota legata. Il valore è un elenco di link `[[…]]`; un link solo scritto
/// come testo (`tipo: "[[Tipi/Libro]]"`) resta un link solo finché le note
/// legate sono al più una. Le voci che non sono link restano dove sono.
export function openRelationEditor(entry: PropertyEntry, anchor: HTMLButtonElement, host: PropertyRowHost, life: Lifetime): PopoverHandle {
  const state = session(entry, host);
  const own = openLifetime();
  const target = targetOf(host.types, entry.key);
  const port = host.relations;
  const scalar = (host.current(entry.key) ?? entry).items === null;
  let chosen = relationItems(host.current(entry.key) ?? entry);
  let found: RelationNote[] = [];
  let query = "";
  let asked = 0;
  let creating = false;
  const body = document.createElement("div");
  body.className = "cm-fub-prop-relation";
  const search = document.createElement("div");
  search.className = "cm-fub-prop-search";
  const icon = iconEl("search");
  icon?.setAttribute("aria-hidden", "true");
  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.placeholder = liveStrings.t("page.properties.relation.search");
  input.setAttribute("aria-label", liveStrings.t("page.properties.relation.search"));
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-autocomplete", "list");
  search.append(...(icon ? [icon] : []), input);
  const list = document.createElement("div");
  list.className = "cm-fub-block-menu cm-fub-prop-options";
  list.setAttribute("aria-label", liveStrings.t("page.properties.relation.label", { key: entry.key }));
  list.setAttribute("aria-multiselectable", "true");
  const empty = document.createElement("p");
  empty.className = "cm-fub-prop-empty";
  const note = noteElement();
  const foot = document.createElement("p");
  foot.className = "cm-fub-prop-foot";
  const footIcon = iconEl(target?.kind === "folder" ? "folder" : "backlink");
  footIcon?.setAttribute("aria-hidden", "true");
  const footText = document.createElement("span");
  footText.textContent = target === null
    ? liveStrings.t("page.properties.relation.foot.any")
    : liveStrings.t(target.kind === "type" ? "page.properties.relation.foot.type" : "page.properties.relation.foot.folder", { target: targetLabel(target) });
  foot.append(...(footIcon ? [footIcon] : []), footText);
  body.append(search, list, empty, note, foot);

  const rows = (): RelationRow[] => {
    const wanted = query.trim().toLocaleLowerCase();
    const mine = chosen
      .filter((item) => wanted === "" || linkName(item).toLocaleLowerCase().includes(wanted) || item.toLocaleLowerCase().includes(wanted))
      .map((item): RelationRow => ({ kind: "chosen", id: `c:${item}`, item }));
    const others = found
      .filter((each) => !chosen.some((item) => sameNote(item, each)))
      .map((each): RelationRow => ({ kind: "found", id: `f:${each.doc}`, note: each }));
    const name = query.trim();
    const exact = name !== "" && (chosen.some((item) => linkName(item).toLocaleLowerCase() === wanted)
      || found.some((each) => linkName(each.link).toLocaleLowerCase() === wanted));
    const create: RelationRow[] = port?.create && name !== "" && !exact && !/[[\]|#^]/.test(name)
      ? [{ kind: "create", id: `n:${name}`, name }]
      : [];
    const notes = [...mine, ...others];
    return [...(notes.length > 0 ? [{ kind: "group", id: "g" } as RelationRow] : []), ...notes, ...create];
  };

  const handle = createList<RelationRow>({
    container: list,
    role: "listbox",
    items: [],
    key: (row) => row.id,
    render: (row, element) => {
      if (row.kind === "group") {
        element.classList.add("cm-fub-prop-group");
        element.textContent = liveStrings.t("page.properties.relation.group");
        return;
      }
      if (row.kind === "create") {
        const figure = iconEl("plus");
        figure?.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.className = "cm-fub-prop-menu-label";
        const named = document.createElement("span");
        named.textContent = liveStrings.t("page.properties.relation.create", { name: row.name });
        const hint = document.createElement("small");
        hint.className = "cm-fub-prop-menu-hint";
        hint.textContent = target === null
          ? liveStrings.t("page.properties.relation.create.any")
          : liveStrings.t(target.kind === "type" ? "page.properties.relation.create.type" : "page.properties.relation.create.folder", { target: targetLabel(target) });
        label.append(named, hint);
        element.classList.add("cm-fub-prop-create");
        element.replaceChildren(...(figure ? [figure] : []), label);
        return;
      }
      const check = document.createElement("span");
      check.className = "cm-fub-page-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = row.kind === "chosen" ? "✓" : "";
      const figure = iconEl("notes");
      figure?.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "cm-fub-prop-menu-label";
      const named = document.createElement("span");
      const link = row.kind === "chosen" ? row.item : row.note.link;
      const isLink = /^\[\[[^[\]]+\]\]$/.test(link.trim());
      named.textContent = isLink ? linkName(link) : link;
      label.append(named);
      // Sotto il nome, più piano, dov'è: la cartella della nota trovata, o il
      // link com'è scritto per una nota legata.
      const where = row.kind === "found" ? folderOf(row.note.doc) : isLink ? link.trim().replace(/^\[\[|\]\]$/g, "") : "";
      if (where !== "" && where !== named.textContent) {
        const hint = document.createElement("small");
        hint.className = "cm-fub-prop-menu-hint";
        hint.textContent = where;
        label.append(hint);
      }
      element.replaceChildren(check, ...(figure ? [figure] : []), label);
    },
    disabled: (row) => row.kind === "group",
    selected: (row) => row.kind === "chosen",
    onActivate: (row) => {
      if (row.kind === "chosen") write(chosen.filter((item) => item !== row.item));
      else if (row.kind === "found") write([...chosen, row.note.link]);
      else if (row.kind === "create") void create(row.name);
    },
    owner: input,
    focus: "activedescendant",
    lifetime: own,
  });

  /// Il valore da scrivere: un link solo resta testo se lo era.
  const valueOf = (next: string[]): PropertyWrite => scalar && next.length <= 1 ? next[0] ?? "" : next;
  /// Scrive le note legate. Se il valore è cambiato sotto, la scelta resta
  /// (le spunte la mostrano), lo si dice, e «Scrivi la mia» la scrive.
  function write(next: string[]): void {
    const outcome = commit(state, valueOf(next));
    if (outcome === "conflict") {
      chosen = next;
      sayConflict(note, conflictText(state), own, () => write(chosen));
    } else if (outcome === "written") {
      chosen = next;
      say(note, null);
    }
    refresh();
    input.focus();
  }

  /// Crea la nota nel bersaglio, poi la lega. Se non si crea, il riquadro
  /// lo dice e la proprietà non cambia.
  async function create(name: string): Promise<void> {
    if (creating || !port?.create) return;
    creating = true;
    const made = await port.create(name, target).then(
      (created) => created ?? liveStrings.t("page.properties.relation.create.unknown"),
      (error: unknown) => errorText(error, "specie"),
    );
    creating = false;
    if (own.closed) return;
    if (typeof made === "string") {
      say(note, liveStrings.t("page.properties.relation.create.failed", { name, reason: made }));
      input.focus();
      return;
    }
    query = "";
    input.value = "";
    write([...chosen, made.link]);
  }

  /// `first`: una ricerca nuova attiva la prima proposta, che Invio sceglie.
  function refresh(first = false): void {
    const items = rows();
    handle.setItems(items);
    if (first) handle.setActive(items.find((row) => row.kind !== "group")?.id ?? null);
    const nothing = items.length === 0;
    empty.hidden = !nothing;
    if (nothing) {
      empty.textContent = query.trim() !== "" ? liveStrings.t("page.properties.relation.none")
        : target === null ? liveStrings.t("page.properties.relation.empty.any")
          : liveStrings.t(target.kind === "type" ? "page.properties.relation.empty.type" : "page.properties.relation.empty.folder", { target: targetLabel(target) });
    }
  }
  const look = (text: string) => {
    query = text;
    const question = ++asked;
    say(note, null);
    refresh(true);
    if (!port) return;
    void port.search(text, target).then((notes) => {
      if (question !== asked || own.closed) return;
      found = notes;
      refresh(true);
    }, () => {});
  };
  own.listen(input, "input", () => look(input.value));
  look("");
  const popover = popoverFor(anchor, body, liveStrings.t("page.properties.relation.label", { key: entry.key }), host, life, own);
  input.focus();
  return popover;
}

// ——— Selezione e Stato ———

type ChoiceRow =
  | { readonly kind: "group"; readonly id: string; readonly group: OptionGroup }
  | { readonly kind: "option"; readonly id: string; readonly option: PropertyOption }
  | { readonly kind: "create"; readonly id: string; readonly name: string };

/// Selezione e Stato: le opzioni del registro come pastiglie del loro colore;
/// lo Stato le raggruppa in Da fare, In corso, Fatto. La ricerca le filtra;
/// un nome che non c'è si crea («Crea «nome»»): l'opzione entra nel registro
/// del vault (`addOption`, lo Stato in Da fare, con un colore libero) e poi
/// diventa il valore. Se il registro non si scrive (illeggibile, di una
/// versione futura) il riquadro lo dice e la nota non cambia. Il valore è il
/// nome dell'opzione, scritto come testo.
export function openOptionsEditor(entry: PropertyEntry, kind: "select" | "status", anchor: HTMLButtonElement, host: PropertyRowHost, life: Lifetime): PopoverHandle {
  const state = session(entry, host);
  const own = openLifetime();
  const status = kind === "status";
  const options: PropertyOption[] = [...optionsOf(host.types, entry.key)];
  let chosen = (host.current(entry.key) ?? entry).value;
  let query = "";
  let creating = false;
  const body = document.createElement("div");
  body.className = "cm-fub-prop-choices";
  const search = document.createElement("div");
  search.className = "cm-fub-prop-search";
  const icon = iconEl("search");
  icon?.setAttribute("aria-hidden", "true");
  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.placeholder = liveStrings.t("page.properties.options.search");
  input.setAttribute("aria-label", liveStrings.t("page.properties.options.search"));
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-autocomplete", "list");
  search.append(...(icon ? [icon] : []), input);
  const list = document.createElement("div");
  list.className = "cm-fub-block-menu cm-fub-prop-options";
  list.setAttribute("aria-label", liveStrings.t("page.properties.options.label", { key: entry.key }));
  const empty = document.createElement("p");
  empty.className = "cm-fub-prop-empty";
  empty.textContent = liveStrings.t("page.properties.options.none");
  const note = noteElement();
  const foot = document.createElement("p");
  foot.className = "cm-fub-prop-foot";
  const footIcon = iconEl("base-sliders");
  footIcon?.setAttribute("aria-hidden", "true");
  const footText = document.createElement("span");
  footText.textContent = liveStrings.t("page.properties.options.foot", { key: entry.key });
  foot.append(...(footIcon ? [footIcon] : []), footText);
  body.append(search, list, empty, note, foot);

  const rows = (): ChoiceRow[] => {
    const wanted = query.trim().toLocaleLowerCase();
    const shown = options.filter((option) => wanted === "" || option.name.toLocaleLowerCase().includes(wanted));
    const row = (option: PropertyOption): ChoiceRow => ({ kind: "option", id: `o:${option.name}`, option });
    const out: ChoiceRow[] = status
      ? OPTION_GROUPS.flatMap((group): ChoiceRow[] => {
        const members = shown.filter((option) => option.group === group);
        return members.length === 0 ? [] : [{ kind: "group", id: `g:${group}`, group }, ...members.map(row)];
      })
      : shown.map(row);
    const name = query.trim();
    if (host.addOption && name !== "" && !options.some((option) => option.name === name)) out.push({ kind: "create", id: `c:${name}`, name });
    return out;
  };

  const handle = createList<ChoiceRow>({
    container: list,
    role: "listbox",
    items: [],
    key: (row) => row.id,
    render: (row, element) => {
      if (row.kind === "group") {
        // L'intestazione di un gruppo: si vede, non si sceglie, le frecce la
        // saltano (`disabled`).
        element.classList.add("cm-fub-prop-group");
        element.textContent = liveStrings.t(`page.properties.options.group.${row.group}`);
        return;
      }
      if (row.kind === "create") {
        const figure = iconEl("plus");
        figure?.setAttribute("aria-hidden", "true");
        // Il nome e, sotto, più piano, dove va e con che colore (`.lb small`).
        const label = document.createElement("span");
        label.className = "cm-fub-prop-menu-label";
        const named = document.createElement("span");
        named.textContent = liveStrings.t("page.properties.options.create", { name: row.name });
        const hint = document.createElement("small");
        hint.className = "cm-fub-prop-menu-hint";
        hint.textContent = liveStrings.t(status ? "page.properties.options.create.status" : "page.properties.options.create.select");
        label.append(named, hint);
        element.classList.add("cm-fub-prop-create");
        element.replaceChildren(...(figure ? [figure] : []), label);
        return;
      }
      const check = document.createElement("span");
      check.className = "cm-fub-page-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = row.option.name === chosen ? "✓" : "";
      element.replaceChildren(check, optionElement(row.option.name, row.option.color, status));
    },
    disabled: (row) => row.kind === "group",
    selected: (row) => row.kind === "option" && row.option.name === chosen,
    onActivate: (row) => {
      if (row.kind === "option") choose(row.option.name);
      else if (row.kind === "create") void create(row.name);
    },
    owner: input,
    focus: "activedescendant",
    lifetime: own,
  });

  /// `first`: una ricerca nuova attiva la prima proposta, che Invio sceglie;
  /// senza ricerca è attiva l'opzione del valore.
  const refresh = (first = false) => {
    const items = rows();
    handle.setItems(items);
    if (first) {
      const current = query.trim() === "" ? items.find((row) => row.kind === "option" && row.option.name === chosen) : undefined;
      handle.setActive((current ?? items.find((row) => row.kind !== "group"))?.id ?? null);
    }
    empty.hidden = items.length > 0;
  };

  /// Scrive l'opzione come valore e chiude. Se il valore è cambiato sotto, la
  /// scelta resta segnata, lo si dice, e «Scrivi la mia» la scrive.
  function choose(name: string): void {
    const outcome = commit(state, name);
    if (outcome === "conflict") {
      chosen = name;
      sayConflict(note, conflictText(state), own, () => choose(name));
      refresh();
      input.focus();
      return;
    }
    popover.close();
  }

  /// Crea l'opzione nel registro, poi la scrive. Un rifiuto del registro si
  /// dice nel riquadro, e la nota non cambia.
  async function create(name: string): Promise<void> {
    if (creating || !host.addOption) return;
    creating = true;
    const color = freeColor(options);
    const group: OptionGroup | null = status ? "todo" : null;
    const problem = await host.addOption(entry.key, { name, color, group }).catch((error: unknown) => errorText(error, "specie"));
    creating = false;
    if (own.closed) return;
    if (problem !== null) {
      say(note, liveStrings.t("page.properties.options.failed", { name, reason: problem }));
      input.focus();
      return;
    }
    options.push({ name, color, group: group ?? "todo" });
    query = "";
    input.value = "";
    choose(name);
  }

  own.listen(input, "input", () => {
    query = input.value;
    say(note, null);
    refresh(true);
  });
  refresh(true);
  const popover = popoverFor(anchor, body, liveStrings.t("page.properties.options.label", { key: entry.key }), host, life, own);
  input.focus();
  return popover;
}
