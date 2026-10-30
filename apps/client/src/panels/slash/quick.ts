// I comandi rapidi del menu «/»: ciò che si scrive con gli argomenti, e che
// va in cima ai risultati con un'icona sua. Ognuno è un comando del registro
// con i suoi parametri: «/tab 3x4» è `markdown.table { rows: 3, cols: 4 }`,
// lo stesso che la riga di comando può chiamare.
import { t } from "../../i18n/strings";
import { fold } from "./rank";

export interface QuickCommand {
  readonly id: string;
  readonly params: Readonly<Record<string, unknown>>;
  /// Che cosa farà, detto per intero: «Tabella 3 × 4».
  readonly label: string;
  readonly icon: string;
}

/// I tipi di riquadro, come li riconosce la resa, coi nomi con cui li si
/// chiama in italiano. L'ordine è quello della galleria.
export const CALLOUTS: readonly { readonly type: string; readonly emoji: string; readonly names: readonly string[] }[] = [
  { type: "note", emoji: "📝", names: ["nota"] },
  { type: "tip", emoji: "💡", names: ["suggerimento", "consiglio"] },
  { type: "info", emoji: "ℹ️", names: ["informazione"] },
  { type: "warning", emoji: "⚠️", names: ["attenzione", "avviso"] },
  { type: "danger", emoji: "⚡", names: ["pericolo"] },
  { type: "question", emoji: "❓", names: ["domanda"] },
  { type: "success", emoji: "✅", names: ["riuscito", "fatto"] },
  { type: "failure", emoji: "❌", names: ["fallito", "non riuscito"] },
  { type: "todo", emoji: "☑️", names: ["da fare"] },
  { type: "example", emoji: "📎", names: ["esempio"] },
  { type: "quote", emoji: "💬", names: ["citazione"] },
  { type: "abstract", emoji: "📋", names: ["riassunto", "sommario"] },
  { type: "bug", emoji: "🐞", names: ["errore", "baco"] },
];

/// I nomi brevi dei linguaggi, verso quelli che la resa conosce.
const LANGUAGES: Readonly<Record<string, string>> = {
  py: "python", js: "javascript", ts: "typescript", sh: "bash", shell: "bash", rs: "rust",
  md: "markdown", "c++": "cpp", "c#": "csharp", cs: "csharp", yml: "yaml", kt: "kotlin",
  rb: "ruby", tex: "latex",
};

const WEEKDAYS = ["lunedi", "martedi", "mercoledi", "giovedi", "venerdi", "sabato", "domenica"];

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

/// `YYYY-MM-DD` del giorno locale.
export function isoOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shifted(today: Date, days: number): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
}

/// Il giorno detto a parole, rispetto a `today`; un giorno della settimana è
/// il prossimo con quel nome, mai oggi.
export function resolveDay(word: string, today: Date): Date | null {
  const said = fold(word).replace(/\s+/g, " ");
  const relative: Readonly<Record<string, number>> = { oggi: 0, domani: 1, dopodomani: 2, "fra una settimana": 7, "tra una settimana": 7 };
  if (said in relative) return shifted(today, relative[said]!);
  const index = WEEKDAYS.indexOf(said);
  if (index < 0) return null;
  const weekday = today.getDay() === 0 ? 7 : today.getDay();
  return shifted(today, ((index + 1 - weekday + 6) % 7) + 1);
}

/// La data per esteso, nella lingua dell'interfaccia: «venerdì 30 ottobre».
export function longDay(date: Date): string {
  return new Intl.DateTimeFormat(t("slash.locale"), { weekday: "long", day: "numeric", month: "long" }).format(date);
}

/// Il comando rapido che `raw` scrive per intero, o `null`.
export function quickCommand(raw: string, today: Date): QuickCommand | null {
  const q = fold(raw.trim()).replace(/\s+/g, " ");
  let m = /^(?:tab|tabella|table) ?(\d{1,2}) ?[x×*] ?(\d{1,2})$/.exec(q);
  if (m) {
    const rows = clamp(Number(m[1]), 1, 50);
    const cols = clamp(Number(m[2]), 1, 12);
    return { id: "markdown.table", params: { rows, cols }, label: t("slash.quick.table", { rows, cols }), icon: "fmt-table" };
  }
  m = /^(?:col|colonne|columns) ?([2-4])$/.exec(q);
  if (m) {
    const count = Number(m[1]);
    return { id: "markdown.columns", params: { count }, label: t("slash.quick.columns", { count }), icon: "fmt-columns" };
  }
  m = /^(?:code|codice) ([\w+#.-]+)$/.exec(q);
  if (m) {
    const language = LANGUAGES[m[1]!] ?? m[1]!;
    return { id: "markdown.codeblock", params: { language }, label: t("slash.quick.code", { language }), icon: "fmt-codeblock" };
  }
  m = /^h([1-6])$/.exec(q);
  if (m) return { id: `markdown.heading.${m[1]}`, params: {}, label: t("slash.quick.heading", { level: Number(m[1]) }), icon: `fmt-h${m[1]}` };
  m = /^(?:riquadro|callout) (.+)$/.exec(q);
  if (m) {
    const word = m[1]!;
    const found = CALLOUTS.find((each) => each.type === word || each.names.includes(word));
    if (!found) return null;
    return { id: "markdown.callout", params: { type: found.type }, label: t("slash.quick.callout", { name: calloutLabel(found.type) }), icon: "fmt-callout" };
  }
  const day = resolveDay(q, today);
  if (day) return { id: "markdown.date", params: { date: isoOf(day) }, label: t("slash.quick.date", { date: longDay(day) }), icon: "fmt-date" };
  return null;
}

/// Il nome di un tipo di riquadro, nella lingua dell'interfaccia.
export function calloutLabel(type: string): string {
  const key = `slash.callout.${type}` as const;
  const label = t(key as Parameters<typeof t>[0]);
  return label === key ? type : label;
}
