// Le date di `@` (K6): «oggi», «domani», «venerdì», «prossimo venerdì»,
// «4 novembre», «nov 4», «2026-11-04», in italiano e in inglese insieme, come
// le emoji. Una parola a metà propone già («@dom» → domani). Il giorno torna
// come `YYYY-MM-DD`; il link alla giornaliera lo fa chi ne conosce cartella e
// formato (`state/dates.ts`).

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
  return out.slice(0, MAX_DATES);
}

/// La riga è un compito (`- [ ] …`): `@` offre anche la scadenza 📅.
export function isTaskLine(text: string): boolean {
  return /^[ \t]*(?:>[ \t]?)*(?:[-*+]|\d+[.)])[ \t]+\[[ xX]\][ \t]/.test(text);
}
