// Le date di `@` (K6): dove sta la giornaliera di un giorno e quando comincia
// la settimana. La cartella e il formato sono le impostazioni di
// `fub.template` (`daily.folder`, `daily.format`), il primo giorno è
// `locale.first-day-of-week` o, vuoto, quello del sistema. Si rileggono
// quando cambiano; il nome della giornaliera è il gemello di `daily_name` in
// `crates/fub-features/src/template.rs`.

import { resolvedLanguage, catalogLanguage } from "../i18n/strings";
import { settings } from "../host/query";
import type { Weekday } from "../host/contract";
import { Race } from "../ui/race";
import type { Lifetime } from "../ui/lifetime";
import { onEvent } from "./kernel";
import { systemLocale } from "./locale";
import { on, openVaultRoot } from "./store";

const TEMPLATE_PLUGIN = "fub.template";
export const DAILY_FOLDER_KEY = "daily.folder";
export const DAILY_FORMAT_KEY = "daily.format";
export const FIRST_DAY_KEY = "locale.first-day-of-week";
const DEFAULT_FOLDER = "Daily";
const DEFAULT_FORMAT = "YYYY-MM-DD";
const WATCHED = new Set([DAILY_FOLDER_KEY, DAILY_FORMAT_KEY, FIRST_DAY_KEY]);

const WEEKDAYS: readonly Weekday[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

let folder = DEFAULT_FOLDER;
let format = DEFAULT_FORMAT;
let firstDay: Weekday | null = null;
const race = new Race();

const MONTHS_IT = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS_IT = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"];
const WEEKDAYS_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/// Il nome della giornaliera di `iso` (`YYYY-MM-DD`) nel formato dichiarato,
/// come lo scrive `note.daily`: token `YYYY`, `YY`, `MMMM`, `MMM`, `MM`, `M`,
/// `DD`, `D`, `dddd`, `ddd`, il più lungo prima; `[…]` resta com'è. I nomi in
/// italiano o, per ogni altra lingua, in inglese.
export function dailyName(pattern: string, iso: string, language: string): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const weekday = ((new Date(year, month - 1, day).getDay() + 6) % 7) + 1;
  const [months, weekdays] = language === "it" ? [MONTHS_IT, WEEKDAYS_IT] : [MONTHS_EN, WEEKDAYS_EN];
  const monthName = months[Math.min(Math.max(month, 1), 12) - 1]!;
  const weekdayName = weekdays[weekday - 1]!;
  const short = (name: string) => [...name].slice(0, 3).join("");
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const tokens: readonly (readonly [string, string])[] = [
    ["YYYY", pad(year, 4)],
    ["YY", pad(((year % 100) + 100) % 100)],
    ["MMMM", monthName],
    ["MMM", short(monthName)],
    ["MM", pad(month)],
    ["M", String(month)],
    ["DD", pad(day)],
    ["D", String(day)],
    ["dddd", weekdayName],
    ["ddd", short(weekdayName)],
  ];
  let out = "";
  let rest = pattern;
  while (rest.length > 0) {
    if (rest.startsWith("[")) {
      const end = rest.indexOf("]");
      if (end !== -1) {
        out += rest.slice(1, end);
        rest = rest.slice(end + 1);
        continue;
      }
    }
    const token = tokens.find(([name]) => rest.startsWith(name));
    if (token) {
      out += token[1];
      rest = rest.slice(token[0].length);
    } else {
      const char = String.fromCodePoint(rest.codePointAt(0)!);
      out += char;
      rest = rest.slice(char.length);
    }
  }
  return out;
}

/// Il path della giornaliera di `iso`, senza estensione.
export function dailyPath(iso: string): string {
  const language = catalogLanguage(resolvedLanguage()) === "it" ? "it" : "en";
  return `${folder}/${dailyName(format, iso, language)}`;
}

/// Il primo giorno della settimana: 1 = lunedì … 7 = domenica.
export function firstWeekday(): number {
  const chosen = firstDay ?? systemLocale().first_day_of_week;
  return WEEKDAYS.indexOf(chosen) + 1 || 1;
}

/// La cartella come `valid_folder` la legge: senza spazi e barre ai bordi;
/// vuota o assente, quella di sempre.
export function dailyFolder(value: unknown): string {
  const written = typeof value === "string" ? value.trim().replace(/^\/+|\/+$/g, "") : "";
  return written || DEFAULT_FOLDER;
}

/// Il formato scritto, o quello di sempre se è vuoto.
export function dailyFormat(value: unknown): string {
  const written = typeof value === "string" ? value.trim() : "";
  return written || DEFAULT_FORMAT;
}

async function refresh(): Promise<void> {
  await race.last(async (expected) => {
    const [template, host] = await expected(Promise.all([settings(TEMPLATE_PLUGIN), settings()]));
    const value = (key: string) => [...template, ...host].find((entry) => entry.spec.key === key)?.value;
    folder = dailyFolder(value(DAILY_FOLDER_KEY));
    format = dailyFormat(value(DAILY_FORMAT_KEY));
    const day = value(FIRST_DAY_KEY);
    firstDay = WEEKDAYS.includes(day as Weekday) ? (day as Weekday) : null;
  });
}

/// Tiene cartella, formato e primo giorno allineati alle impostazioni finché
/// `lifetime` è vivo. Un'impostazione che non si legge lascia i valori di prima.
export function mountDates(lifetime: Lifetime): void {
  const again = (): void => void refresh().catch(() => {});
  lifetime.add(onEvent("setting_changed", (event) => {
    if (WATCHED.has(event.key)) again();
  }));
  lifetime.add(onEvent("vault_opened", again));
  lifetime.add(on("vault", again));
  lifetime.add(() => {
    race.cancel();
    folder = DEFAULT_FOLDER;
    format = DEFAULT_FORMAT;
    firstDay = null;
  });
  if (openVaultRoot() !== undefined) again();
}
