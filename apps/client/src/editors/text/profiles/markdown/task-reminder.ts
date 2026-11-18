// Il promemoria di un compito nella nota (E10, T36): `⏰ 2026-11-13 09:00`.
//
// La regola del `⏰` è una sola, nel contratto (`fub_abi::rules::tasks::
// task_reminder`, gemella `taskReminder` in `rules/mirrored.ts`), e vale sul
// testo del compito come la scadenza (`task-due.ts`): qui stanno ciò che la
// Live ne fa — la pastiglia blu con l'ora, e il giorno se non è oggi — e la
// scrittura del promemoria, una sola per la pastiglia, il gruppo «Compito»
// della barra e il «/». Il file riceve sempre `⏰ AAAA-MM-GG HH:MM`: è la
// forma che l'indice dei promemoria legge e il plugin Reminder di Obsidian
// scrive. Chi suona lo decide il core (l'indice in `fub-features`, la
// notifica nell'app): la nota non sa niente delle notifiche.
import { syntaxTree } from "@codemirror/language";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import { REMINDER_MARK, taskChecked, taskReminder, type TaskReminder } from "../../../../rules/mirrored";
import { listItem } from "../../../../rules/syntax";
import { liveProjection, liveTaskEnd, type Projection } from "./task-due";

/// Un promemoria scritto, e quello detto a parole: stanno con le date dette
/// (`dates.ts`), che il «/» legge senza caricare l'editor.
export { saidReminder, type ReminderTime } from "./dates";
import type { ReminderTime } from "./dates";

/// Il promemoria di una proiezione, riportato alle posizioni d'origine:
/// `[from, to)` copre il segno, la data e l'ora nel testo. `whole` dice se il
/// tratto d'origine è tutto testo del compito, senza segni in mezzo (un
/// codice, un link): solo allora la pastiglia lo sostituisce e la scrittura
/// lo riscrive al suo posto.
export function projectedReminder(projection: Projection): (TaskReminder & { source: [number, number]; whole: boolean }) | null {
  const reminder = taskReminder(projection.text);
  if (!reminder || reminder.to <= reminder.from) return null;
  const from = projection.at[reminder.from]!;
  const to = projection.at[reminder.to - 1]! + 1;
  return { ...reminder, source: [from, to], whole: to - from === reminder.to - reminder.from };
}

/// Il compito sulla riga di `pos` e il suo promemoria, letti dallo stato.
export interface ReminderTask {
  /// Il byte del segno del compito (`[`): la posizione dell'indice.
  readonly boxFrom: number;
  /// Dove finisce il testo del compito (il primo paragrafo).
  readonly textEnd: number;
  readonly checked: boolean;
  /// Il promemoria che c'è, se c'è.
  readonly reminder: (TaskReminder & { source: [number, number]; whole: boolean }) | null;
}

/// Il compito sulla riga di `pos`, o `null` se la riga non è un compito.
export function reminderTaskAt(state: EditorState, pos: number): ReminderTask | null {
  const row = state.doc.lineAt(pos);
  const entry = listItem(row.text);
  if (!entry || entry.symbol === null || entry.boxFrom < 0) return null;
  const boxFrom = row.from + entry.boxFrom;
  const tree = syntaxTree(state);
  const taskEnd = liveTaskEnd(tree, boxFrom, row.to);
  const source = state.doc.sliceString(row.from, taskEnd);
  const projection = liveProjection(tree, source, row.from, row.from + entry.boxTo, taskEnd);
  return {
    boxFrom,
    textEnd: taskEnd,
    checked: taskChecked(entry.symbol),
    reminder: projectedReminder(projection),
  };
}

/// Il testo di un promemoria, come lo legge l'indice.
export function reminderSource(when: ReminderTime): string {
  return `${REMINDER_MARK} ${when.date} ${when.time}`;
}

/// La scrittura del promemoria del compito `task`: al posto di quello che
/// c'è, se si può riscrivere dove sta, altrimenti in fondo al testo del
/// compito, dove diventa l'ultimo `⏰` (quello che conta). `null` lo toglie,
/// con lo spazio che lo precedeva. Un passo d'annullamento solo.
export function writeReminder(state: EditorState, task: ReminderTask, when: ReminderTime | null): TransactionSpec | null {
  const current = task.reminder;
  if (current && current.whole) {
    const [from, to] = current.source;
    if (when) return { changes: { from, to, insert: reminderSource(when) }, userEvent: "input" };
    const before = state.doc.sliceString(Math.max(0, from - 1), from);
    return { changes: { from: before === " " || before === "\t" ? from - 1 : from, to, insert: "" }, userEvent: "input" };
  }
  if (!when) return null;
  const line = state.doc.lineAt(task.textEnd);
  const text = state.doc.sliceString(line.from, task.textEnd);
  const end = line.from + text.trimEnd().length;
  return { changes: { from: end, to: task.textEnd, insert: ` ${reminderSource(when)}` }, userEvent: "input" };
}

/// `AAAA-MM-GG HH:MM` letto.
export function reminderTimeOf(when: string | null): ReminderTime | null {
  const match = when === null ? null : /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(when);
  return match ? { date: match[1]!, time: match[2]! } : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

function isoOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateOf(when: ReminderTime): Date {
  const [year, month, day] = when.date.split("-").map(Number) as [number, number, number];
  const [hours, minutes] = when.time.split(":").map(Number) as [number, number];
  return new Date(year, month - 1, day, hours, minutes);
}

/// L'ora nella lingua dell'interfaccia: «09:00», «09:00 AM».
function clockText(when: ReminderTime, language: string): string {
  return new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit" }).format(dateOf(when));
}

/// Ciò che la pastiglia scrive: l'ora, e il giorno breve se non è oggi
/// («ven 13 nov, 09:00»), con l'anno se non è questo.
export function reminderLabel(when: ReminderTime, now: Date, language: string): string {
  if (when.date === isoOf(now)) return clockText(when, language);
  const date = dateOf(when);
  const day = new Intl.DateTimeFormat(language, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
  return `${day}, ${clockText(when, language)}`;
}

/// Il giorno e l'ora per esteso: «venerdì 13 novembre 2026, 09:00».
export function reminderLong(when: ReminderTime, language: string): string {
  const date = dateOf(when);
  const day = new Intl.DateTimeFormat(language, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
  return `${day}, ${clockText(when, language)}`;
}

/// Il promemoria è già passato rispetto a `now`, sull'ora del muro.
export function reminderPassed(when: ReminderTime, now: Date): boolean {
  return `${when.date} ${when.time}` <= `${isoOf(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/// La sveglia del promemoria (`i-alarm` del prototipo, `fmt-alarm` della
/// barra), disegnata qui: la pastiglia c'è anche con la barra spenta, quando
/// la serie della barra non è registrata.
export function alarmFigure(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "cm-fub-reminder-figure");
  for (const d of ALARM_PATHS) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/// Le linee della sveglia, che sono anche `fmt-alarm` della barra
/// (`panels/format-bar.ts`).
export const ALARM_PATHS: readonly string[] = [
  "M4.8 13.5a7.2 7.2 0 1 0 14.4 0 7.2 7.2 0 1 0-14.4 0",
  "M12 9.9v3.6l2.4 1.5",
  "M4.2 5.4l3-2.4M19.8 5.4l-3-2.4",
];

/// Le notifiche dei promemoria sono accese (`fub:notifications` di
/// «Compiti»)? Lo dice la shell, che legge le impostazioni
/// (`panels/reminders.ts`); la pastiglia e la scelta lo leggono al passaggio,
/// per dire che il promemoria resta ma non suona. Di serie sì: un permesso
/// che non si è ancora letto non si dà per spento.
let notificationsOn = true;

export function setReminderNotifications(on: boolean): void {
  notificationsOn = on;
}

export function reminderNotificationsOn(): boolean {
  return notificationsOn;
}
