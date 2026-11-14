// Il recinto ```tasks``` del plugin Tasks di Obsidian, letto con la ricerca di
// Fub. Le righe più usate del plugin diventano termini della barra di ricerca
// (`task:`, `due:`, `path:`, `tag:`): la ricerca sceglie le note, e dentro ogni
// nota si tengono i compiti che rispondono alle stesse righe. Una riga che non
// si capisce non rompe il recinto: si mostra com'è e si salta.
//
// Qui sta anche la lettura della scadenza `📅` di una riga, per la pastiglia
// della Live e della Lettura: la stessa regola del provider dei compiti
// (`fub-features/src/tasks.rs`, `due_of`), cioè la parola dopo l'ultimo `📅`.
import type { Tree } from "@lezer/common";
import { scanTags, taskChecked } from "../../../../rules/mirrored";
import { charToByteIndices } from "../../../../rules/offsets";
import { listItem } from "../../../../rules/syntax";
import { markdownGrammar } from "./grammar";

/// Il simbolo che introduce la scadenza, come lo scrive il plugin Tasks.
export const DUE_MARK = "📅";

/// Quanti giorni prima della scadenza la pastiglia diventa arancio. Una
/// scadenza passata è vicina anche lei: il compito è ancora da fare.
export const NEAR_DAYS = 7;

/// La scadenza di una riga: dove sta (`📅` compreso, in code unit della riga) e
/// che giorno dice. `day` è `null` quando dopo `📅` non c'è una data che esiste
/// (`📅 2026-02-30`): la pastiglia resta, il compito non ha una data.
export interface TaskDue {
  from: number;
  to: number;
  day: string | null;
}

/// La scadenza scritta in una riga, o `null` se non ce n'è.
export function taskDue(text: string): TaskDue | null {
  const from = text.lastIndexOf(DUE_MARK);
  if (from < 0) return null;
  const after = from + DUE_MARK.length;
  const word = /^\s*(\S*)/u.exec(text.slice(after))!;
  const to = after + word[0].length;
  const day = civilDay(word[1]!) ? word[1]! : null;
  return { from, to: to > after ? to : after, day };
}

/// `AAAA-MM-GG` ed è un giorno che esiste.
function civilDay(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/// Il giorno di oggi di chi guarda, nel fuso della macchina.
export function localDay(now: Date = new Date()): string {
  return isoOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function isoOf(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/// Il giorno `days` dopo `day` (anche prima, con un numero negativo).
export function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, date + days));
  return isoOf(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/// La scadenza è vicina: passata, oggi o entro [`NEAR_DAYS`] giorni.
export function dueIsNear(day: string, today: string): boolean {
  return day < shiftDay(today, NEAR_DAYS);
}

// ---------------------------------------------------------------------------
// Le righe del recinto
// ---------------------------------------------------------------------------

/// Una condizione sulla scadenza: prima, dopo o in quel giorno.
export interface DueTest {
  op: "before" | "after" | "on";
  day: string;
}

/// Le condizioni che valgono per il singolo compito, oltre a quelle della nota.
export interface TaskFilter {
  /// `open` = `not done`, `done` = `done`; `null` = tutti. Le due righe insieme
  /// non lasciano passare niente, come nel plugin.
  status: "open" | "done" | "both" | null;
  due: DueTest[];
  tags: string[];
}

/// Una riga del recinto che non si è capita, col suo numero (da 1).
export interface SkippedLine {
  line: number;
  text: string;
}

/// Il recinto tradotto: la ricerca della barra, ciò che si chiede a ogni
/// compito, e le righe saltate.
export interface TasksQuery {
  search: string;
  filter: TaskFilter;
  skipped: SkippedLine[];
}

/// Una data del plugin: `AAAA-MM-GG`, `today`, `tomorrow`, `yesterday`.
function dayOf(word: string, today: string): string | null {
  const lower = word.toLowerCase();
  if (lower === "today") return today;
  if (lower === "tomorrow") return shiftDay(today, 1);
  if (lower === "yesterday") return shiftDay(today, -1);
  return civilDay(word) ? word : null;
}

/// Un valore come lo legge la barra: fra virgolette se ha spazi. Le virgolette
/// dentro il valore la barra non le sa dire: la riga non si capisce.
function searchValue(value: string): string | null {
  if (value.includes('"')) return null;
  return /\s|^[-(]|[()]/.test(value) ? `"${value}"` : value;
}

/// Traduce le righe di un recinto ```tasks``` nella ricerca di oggi.
///
/// Le righe capite: `not done`, `done`, `due before|after|on <data>` (anche
/// `due <data>`), `path includes <testo>`, `tag includes <tag>`. Le righe vuote
/// e i commenti (`#`) non dicono niente. Ogni altra riga va in `skipped`.
export function translateTasksQuery(source: string, today: string): TasksQuery {
  const terms: string[] = [];
  const filter: TaskFilter = { status: null, due: [], tags: [] };
  const skipped: SkippedLine[] = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const skip = () => skipped.push({ line: index + 1, text: line });
    const lower = line.toLowerCase();
    if (lower === "not done") {
      filter.status = filter.status === "done" || filter.status === "both" ? "both" : "open";
      terms.push("task:todo");
      return;
    }
    if (lower === "done") {
      filter.status = filter.status === "open" || filter.status === "both" ? "both" : "done";
      terms.push("task:done");
      return;
    }
    const due = /^due\s+(?:(before|after|on)\s+)?(\S+)$/i.exec(line);
    if (due) {
      const op = (due[1]?.toLowerCase() ?? "on") as DueTest["op"];
      const day = dayOf(due[2]!, today);
      if (day === null) return skip();
      filter.due.push({ op, day });
      terms.push(`due:${op === "before" ? "<" : op === "after" ? ">" : ""}${day}`);
      return;
    }
    const path = /^path\s+includes\s+(.+)$/i.exec(line);
    if (path) {
      const value = searchValue(path[1]!.trim());
      if (value === null) return skip();
      terms.push(`path:${value}`);
      return;
    }
    const tag = /^tags?\s+includes?\s+#?(\S+)$/i.exec(line);
    if (tag) {
      const name = tag[1]!;
      if (name.includes('"') || /[()]/.test(name)) return skip();
      filter.tags.push(name);
      terms.push(`tag:${name}`);
      return;
    }
    skip();
  });
  // Senza una riga sullo stato il plugin mostra tutti i compiti: la ricerca
  // vuole comunque le sole note che ne hanno.
  if (filter.status === null) terms.unshift("(task:todo OR task:done)");
  return { search: terms.join(" "), filter, skipped };
}

// ---------------------------------------------------------------------------
// I compiti di una nota
// ---------------------------------------------------------------------------

/// Un compito letto dal sorgente di una nota.
export interface FoundTask {
  /// Il simbolo fra le parentesi: `" "` per la casella vuota.
  symbol: string;
  /// Dove sta il simbolo, in code unit del sorgente.
  at: number;
  /// Lo stesso punto in byte: è la posizione che vuole `note.task.toggle`.
  byte: number;
  /// Il testo della prima riga del compito, dopo la casella.
  text: string;
  due: TaskDue | null;
}

/// I compiti di un sorgente Markdown, nell'ordine in cui stanno. Le voci
/// d'elenco le dice la grammatica dell'editor, quindi un `- [ ]` in un blocco
/// di codice non conta; la casella la legge `listItem`, la regola dei comandi
/// di lista, che conosce anche gli stati personalizzati (`[/]`, `[-]`) che la
/// grammatica GFM non vede.
export function tasksOf(source: string, tree: Tree = markdownGrammar.parser.parse(source)): FoundTask[] {
  const found: FoundTask[] = [];
  tree.iterate({
    enter(node) {
      if (node.name !== "ListItem") return;
      const lineFrom = source.lastIndexOf("\n", node.from - 1) + 1;
      const lineEnd = source.indexOf("\n", node.from);
      const row = source.slice(lineFrom, lineEnd < 0 ? source.length : lineEnd).replace(/\r$/, "");
      const entry = listItem(row);
      if (!entry || entry.symbol === null || entry.boxFrom < 0) return;
      const at = lineFrom + entry.boxFrom + 1;
      // Due voci sulla stessa riga (`- - [ ] x`) hanno una casella sola.
      if (at <= node.from || found[found.length - 1]?.at === at) return;
      const text = row.slice(entry.boxTo).trim();
      found.push({ symbol: entry.symbol, at, byte: 0, text, due: taskDue(text) });
    },
  });
  // In byte, con una passata sola sul testo.
  const bytes = charToByteIndices(source, found.map((task) => task.at));
  found.forEach((task, index) => {
    task.byte = bytes[index]!;
  });
  return found;
}

/// Il compito risponde alle righe che valgono per lui (lo stato, la scadenza,
/// i tag); la cartella e il percorso li ha già detti la ricerca.
export function taskMatches(task: FoundTask, filter: TaskFilter): boolean {
  const done = taskChecked(task.symbol);
  if (filter.status === "open" && done) return false;
  if (filter.status === "done" && !done) return false;
  if (filter.status === "both") return false;
  for (const test of filter.due) {
    // Come la ricerca: la scadenza conta solo per i compiti da fare.
    const day = task.due?.day;
    if (!day || done) return false;
    if (test.op === "before" && !(day < test.day)) return false;
    if (test.op === "after" && !(day > test.day)) return false;
    if (test.op === "on" && day !== test.day) return false;
  }
  if (filter.tags.length > 0) {
    const own = scanTags(task.text).map((tag) => tag.name.toLowerCase());
    for (const wanted of filter.tags) {
      const name = wanted.toLowerCase();
      if (!own.some((tag) => tag === name || tag.startsWith(`${name}/`))) return false;
    }
  }
  return true;
}
