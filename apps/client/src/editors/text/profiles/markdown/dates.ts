// Le date dette a parole, una regola sola per `@` (K6) e per il campo della
// data nelle proprietà (T10): «oggi», «domani», «venerdì», «prossimo
// venerdì», «fra due settimane», «4 novembre», «nov 4», «3/4», «2026-11-04»,
// in italiano e in inglese insieme, come le emoji. `saidDay` legge una frase
// intera; `mentionDates` propone anche mentre si scrive («@dom» → domani). Il
// giorno torna come `YYYY-MM-DD`, contato sul calendario locale (mai in UTC);
// il link alla giornaliera lo fa chi ne conosce cartella e formato
// (`state/dates.ts`). In fondo, il promemoria detto (T36): un giorno e un'ora.
import { DEFAULT_REMINDER_TIME } from "../../../../rules/mirrored";

/// Una data riconosciuta: il giorno e la parola che l'ha detta.
export interface SaidDate {
  readonly iso: string;
  readonly said: string;
}

const MONTHS: readonly (readonly string[])[] = [
  ["gennaio", "january"],
  ["febbraio", "february"],
  ["marzo", "march"],
  ["aprile", "april"],
  ["maggio", "may"],
  ["giugno", "june"],
  ["luglio", "july"],
  ["agosto", "august"],
  ["settembre", "september"],
  ["ottobre", "october"],
  ["novembre", "november"],
  ["dicembre", "december"],
];

/// Lunedì = 1, come ISO 8601 e `Intl.Locale.getWeekInfo`.
const WEEKDAYS: readonly (readonly string[])[] = [
  ["lunedi", "monday"],
  ["martedi", "tuesday"],
  ["mercoledi", "wednesday"],
  ["giovedi", "thursday"],
  ["venerdi", "friday"],
  ["sabato", "saturday"],
  ["domenica", "sunday"],
];

const RELATIVE: readonly (readonly [string, number])[] = [
  ["oggi", 0],
  ["today", 0],
  ["domani", 1],
  ["tomorrow", 1],
  ["dopodomani", 2],
  ["ieri", -1],
  ["yesterday", -1],
];

const NEXT = ["prossimo", "prossima", "next"];

/// Quante date propone `@` al massimo.
export const MAX_DATES = 5;

/// Minuscolo, senza accenti e con un solo spazio fra le parole.
function plain(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/// Il giorno di calendario locale di `date`, a mezzanotte.
function day(year: number, month: number, date: number): Date | null {
  const out = new Date(year, month, date);
  return out.getFullYear() === year && out.getMonth() === month && out.getDate() === date ? out : null;
}

function shifted(today: Date, days: number): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
}

/// `YYYY-MM-DD` del giorno locale.
export function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/// Il giorno della settimana ISO (lunedì = 1).
function isoWeekday(date: Date): number {
  return date.getDay() === 0 ? 7 : date.getDay();
}

/// Il mese che `word` comincia, se almeno tre lettere lo dicono senza dubbio.
function monthOf(word: string): number | null {
  if (word.length < 3) return null;
  const found = MONTHS.flatMap((names, index) => (names.some((name) => name.startsWith(word)) ? [index] : []));
  return found.length === 1 ? found[0]! : null;
}

/// I numeri detti a parole in «fra due settimane», «in three days».
const COUNTS: ReadonlyMap<string, number> = new Map([
  ["un", 1], ["uno", 1], ["una", 1], ["un'", 1], ["a", 1], ["an", 1], ["one", 1],
  ["due", 2], ["two", 2],
  ["tre", 3], ["three", 3],
  ["quattro", 4], ["four", 4],
  ["cinque", 5], ["five", 5],
  ["sei", 6], ["six", 6],
  ["sette", 7], ["seven", 7],
  ["otto", 8], ["eight", 8],
  ["nove", 9], ["nine", 9],
  ["dieci", 10], ["ten", 10],
]);

/// L'unità di «fra N …»: giorni, settimane, mesi, anni.
type Unit = "day" | "week" | "month" | "year";
const UNITS: readonly (readonly [RegExp, Unit])[] = [
  [/^(?:giorn[oi]|days?)$/, "day"],
  [/^(?:settiman[ae]|weeks?)$/, "week"],
  [/^(?:mes[ei]|months?)$/, "month"],
  [/^(?:ann[oi]|years?)$/, "year"],
];

/// Fin dove «fra N giorni» si conta: oltre, non è una data che si scrive.
const MAX_COUNT = 999;

/// Lo stesso giorno `months` mesi dopo, o l'ultimo del mese se non c'è
/// («fra un mese» dal 31 gennaio è il 28 o 29 febbraio).
function addMonths(from: Date, months: number): Date {
  const last = new Date(from.getFullYear(), from.getMonth() + months + 1, 0).getDate();
  return new Date(from.getFullYear(), from.getMonth() + months, Math.min(from.getDate(), last));
}

/// L'anno scritto: quattro cifre com'è, due cifre nel secolo 2000 (come
/// `YY` delle giornaliere).
function yearOf(written: string): number {
  return written.length === 2 ? 2000 + Number(written) : Number(written);
}

/// Il giorno e il mese senza anno: quest'anno, o il prossimo se è già
/// passato («20 marzo» detto a novembre è quello che viene).
function ahead(today: Date, month: number, date: number): Date | null {
  const thisYear = day(today.getFullYear(), month, date);
  if (thisYear && thisYear >= today) return thisYear;
  // Il 29 febbraio che quest'anno non c'è cade nel primo anno che ce l'ha.
  for (let year = today.getFullYear() + 1; year <= today.getFullYear() + 8; year++) {
    const next = day(year, month, date);
    if (next) return next;
  }
  return null;
}

/// Nelle date di sole cifre («3/4», «3/4/27») il giorno viene prima del mese
/// nella lingua `locale`? Si chiede a `Intl`: sì in italiano, no in inglese
/// americano.
function dayFirst(locale: string): boolean {
  try {
    const parts = new Intl.DateTimeFormat(locale, { day: "numeric", month: "numeric" }).formatToParts(new Date(2026, 2, 20));
    const order = parts.filter((part) => part.type === "day" || part.type === "month").map((part) => part.type);
    return order[0] !== "month";
  } catch {
    return true;
  }
}

/// Il giorno della settimana che `word` dice: il nome intero o le sue prime
/// tre lettere almeno, senza dubbio fra i nomi; lunedì = 1.
function weekdayOf(word: string): number | null {
  if (word.length < 3) return null;
  const found = WEEKDAYS.flatMap((names, index) => (names.some((name) => name.startsWith(word)) ? [index + 1] : []));
  return found.length === 1 ? found[0]! : null;
}

/// Il prossimo giorno col nome `target` (lunedì = 1), mai oggi.
function nextWeekday(today: Date, target: number): Date {
  return shifted(today, ((target - isoWeekday(today) + 6) % 7) + 1);
}

/// `target` nella settimana dopo questa, che comincia da `firstDay`.
function weekdayNextWeek(today: Date, target: number, firstDay: number): Date {
  const intoWeek = (isoWeekday(today) - firstDay + 7) % 7;
  return shifted(today, 7 - intoWeek + ((target - firstDay + 7) % 7));
}

/// Il giorno che `text` dice per intero, rispetto a `today`, come
/// `YYYY-MM-DD`; `null` se la frase non è una data o se il giorno non c'è
/// («31/2», «30 febbraio»): non si indovina. `firstDay` è il primo giorno
/// della settimana (1 = lunedì … 7 = domenica) per «prossimo venerdì»;
/// `locale` dice se in «3/4» viene prima il giorno o il mese. Le parole
/// valgono in italiano e in inglese insieme, qualunque sia la lingua.
export function saidDay(text: string, today: Date, firstDay: number, locale = "it"): string | null {
  const found = saidDate(plain(text), new Date(today.getFullYear(), today.getMonth(), today.getDate()), firstDay, locale);
  return found ? isoDay(found) : null;
}

function saidDate(q: string, today: Date, firstDay: number, locale: string): Date | null {
  if (q === "") return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(q);
  if (iso) return day(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const digits = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(q);
  if (digits) {
    const [first, second] = [Number(digits[1]), Number(digits[2])];
    // L'ordine della lingua, a meno che un numero oltre il 12 dica l'altro.
    let [date, month] = dayFirst(locale) ? [first, second] : [second, first];
    if (month > 12 && date <= 12) [date, month] = [month, date];
    return digits[3] ? day(yearOf(digits[3]), month - 1, date) : ahead(today, month - 1, date);
  }
  for (const [word, days] of RELATIVE) if (q === word) return shifted(today, days);
  const next = new RegExp(`^(?:${NEXT.join("|")}) (\\S+)$`).exec(q);
  if (next) {
    const target = weekdayOf(next[1]!);
    return target === null ? null : weekdayNextWeek(today, target, firstDay);
  }
  const weekday = weekdayOf(q);
  if (weekday !== null) return nextWeekday(today, weekday);
  // «fra due settimane», «tra 3 giorni», «in two weeks»; «3 giorni fa», «two days ago».
  const span = /^(?:(?:fra|tra|in) (\S+) (\S+)|(\S+) (\S+) (?:fa|ago))$/.exec(q);
  if (span) {
    const [written, unitWord, sign] = span[1] !== undefined ? [span[1], span[2]!, 1] : [span[3]!, span[4]!, -1];
    const count = /^\d{1,3}$/.test(written) ? Number(written) : COUNTS.get(written);
    const unit = UNITS.find(([pattern]) => pattern.test(unitWord))?.[1];
    if (count === undefined || count > MAX_COUNT || !unit) return null;
    const n = sign * count;
    if (unit === "day") return shifted(today, n);
    if (unit === "week") return shifted(today, 7 * n);
    return addMonths(today, unit === "month" ? n : 12 * n);
  }
  const dayMonth = /^(\d{1,2})°? ([a-z]+)\.?(?: (\d{2}|\d{4}))?$/.exec(q);
  const monthDay = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{2}|\d{4}))?$/.exec(q);
  if (dayMonth || monthDay) {
    const [d, m, y] = dayMonth ? [dayMonth[1], dayMonth[2], dayMonth[3]] : [monthDay![2], monthDay![1], monthDay![3]];
    const month = monthOf(m!);
    if (month === null) return null;
    return y ? day(yearOf(y), month, Number(d)) : ahead(today, month, Number(d));
  }
  return null;
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

/// Le date che `query` dice o comincia a dire, rispetto a `today`. `firstDay`
/// è il primo giorno della settimana (1 = lunedì … 7 = domenica): «prossimo
/// venerdì» è il venerdì della settimana dopo questa. Senza niente scritto,
/// oggi e domani, detti in `language`.
export function mentionDates(query: string, today: Date, firstDay: number, language: "it" | "en" = "it"): SaidDate[] {
  const q = plain(query);
  const out: SaidDate[] = [];
  const add = (date: Date | null, said: string) => {
    if (!date) return;
    const iso = isoDay(date);
    if (!out.some((each) => each.iso === iso)) out.push({ iso, said });
  };
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q);
  if (iso) add(day(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])), query.trim());
  const dayMonth = /^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/.exec(q);
  const monthDay = /^([a-z]+) (\d{1,2})(?:,? (\d{4}))?$/.exec(q);
  if (dayMonth || monthDay) {
    const [d, m, y] = dayMonth ? [dayMonth[1], dayMonth[2], dayMonth[3]] : [monthDay![2], monthDay![1], monthDay![3]];
    const month = monthOf(m!);
    if (month !== null) add(day(y ? Number(y) : today.getFullYear(), month, Number(d)), query.trim());
  }
  if (q === "") {
    add(today, language === "it" ? "oggi" : "today");
    add(shifted(today, 1), language === "it" ? "domani" : "tomorrow");
    return out;
  }
  for (const [word, days] of RELATIVE) if (word.startsWith(q)) add(shifted(today, days), word);
  if (q.length >= 2) {
    const weekday = isoWeekday(today);
    WEEKDAYS.forEach((names, index) => {
      const target = index + 1;
      for (const name of names) {
        // Il prossimo giorno con quel nome, mai oggi.
        if (name.startsWith(q)) add(shifted(today, ((target - weekday + 6) % 7) + 1), name);
        for (const next of NEXT) {
          const phrase = `${next} ${name}`;
          if (!phrase.startsWith(q) || q.length <= next.length) continue;
          const intoWeek = (weekday - firstDay + 7) % 7;
          add(shifted(today, 7 - intoWeek + ((target - firstDay + 7) % 7)), phrase);
        }
      }
    });
  }
  // La frase intera, con la regola del campo della data: «fra due
  // settimane», «3/4», «20 marzo» che viene. Resta fra le proposte anche
  // quando le parole a metà ne fanno già cinque.
  const whole = saidDay(query, today, firstDay, language);
  if (whole !== null && !out.some((each) => each.iso === whole)) {
    return [...out.slice(0, MAX_DATES - 1), { iso: whole, said: query.trim() }];
  }
  return out.slice(0, MAX_DATES);
}

/// La riga è un compito (`- [ ] …`): `@` offre anche la scadenza 📅.
export function isTaskLine(text: string): boolean {
  return /^[ \t]*(?:>[ \t]?)*(?:[-*+]|\d+[.)])[ \t]+\[[ xX]\][ \t]/.test(text);
}

// ── Il promemoria detto a parole (T36) ──────────────────────────────────────

/// Un promemoria: il giorno `AAAA-MM-GG` e l'ora `HH:MM`.
export interface ReminderTime {
  readonly date: string;
  readonly time: string;
}

function clockOf(hours: number, minutes: number): string | null {
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 23 || minutes > 59 ? null : `${pad(hours)}:${pad(minutes)}`;
}

/// Un promemoria detto a parole, con la regola delle date di T10 (`saidDay`,
/// `parseDateInput`) e un'ora facoltativa: «venerdì 9», «domani alle 18:30»,
/// «20 marzo 8.15», «3/4», «alle 9». Senza ora, le nove; senza giorno, oggi.
/// `null` se il giorno non c'è o l'ora non è un'ora: niente si indovina.
export function saidReminder(text: string, now: Date, firstDay = 1, locale = "it"): ReminderTime | null {
  const value = text.trim().replace(/\s+/g, " ");
  if (value === "") return null;
  const parsed = parseDateInput(value, now, firstDay, locale);
  if (parsed) return { date: parsed.date, time: parsed.time ?? DEFAULT_REMINDER_TIME };
  // Il giorno e poi un'ora nuda: «venerdì 9», «domani 18:30», «20 marzo 8.15».
  const tail = /^(.+?) (?:(?:alle ore|alle|ore|at) )?(\d{1,2})(?:[:.](\d{2}))?$/iu.exec(value);
  if (tail) {
    const date = saidDay(tail[1]!, now, firstDay, locale);
    const time = clockOf(Number(tail[2]), Number(tail[3] ?? "0"));
    if (date !== null && time !== null) return { date, time };
  }
  // Solo l'ora: oggi.
  const alone = /^(?:(?:alle ore|alle|ore|at) )?(\d{1,2})(?:[:.](\d{2}))?$/iu.exec(value);
  if (alone && (alone[2] !== undefined || /^\D/u.test(value))) {
    const time = clockOf(Number(alone[1]), Number(alone[2] ?? "0"));
    if (time !== null) return { date: isoDay(now), time };
  }
  return null;
}
