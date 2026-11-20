// I perché del motore dei fogli, in italiano.
//
// Il motore (GridCraft) e l'adattatore (`fub-format-xlsx`) spengono un
// comando o lo rifiutano con una frase inglese: «nothing to undo», «rewriting
// the workbook would lose 2 item(s)». Qui ogni frase che possono dire
// (`motivi.generated.json`, scritto da `ts_risultati.rs`) ha la chiave della
// sua traduzione (`fogli.motivo.*`). Una frase con un parametro ci sta col
// segnaposto: il valore passa nella traduzione, e un perché dentro un perché
// («command `x` is not available right now: nothing to undo») si traduce a
// sua volta. Una frase che non si conosce non si perde: la frase generica la
// cita tra virgolette.
import { hasFogliKey, t, type FogliKey } from "./palette/strings";

/// Una frase del motore e la chiave della sua traduzione. I segnaposti fra
/// graffe sono i parametri; quelli in `nested` sono a loro volta un perché.
interface Motivo {
  readonly frase: string;
  readonly chiave: FogliKey;
  readonly nested?: readonly string[];
  readonly command?: readonly string[];
}

/// Le frasi di `motivi.generated.json`, ciascuna con la sua chiave
/// (`motivi.test.ts` controlla che ci siano tutte).
export const MOTIVI: readonly Motivo[] = [
  {
    frase: "No dictionary is available on this system (GridCraft uses the system word list).",
    chiave: "fogli.motivo.no_dictionary",
  },
  { frase: "command `{0}` is not available right now: {1}", chiave: "fogli.motivo.not_now", nested: ["1"], command: ["0"] },
  { frase: "internal error in `{0}` (the workbook was kept as it was): {1}", chiave: "fogli.motivo.internal", command: ["0"] },
  { frase: "invalid parameters for `{cmd}`: {msg}", chiave: "fogli.motivo.invalid_params", command: ["cmd"] },
  { frase: "no workbook open", chiave: "fogli.motivo.no_workbook" },
  { frase: "not available", chiave: "fogli.motivo.not_available" },
  { frase: "nothing to redo", chiave: "fogli.motivo.nothing_to_redo" },
  { frase: "nothing to undo", chiave: "fogli.motivo.nothing_to_undo" },
  { frase: "rewriting the workbook would lose {n} item(s)", chiave: "fogli.motivo.would_lose" },
  { frase: "select a cell in a PivotTable (or pass `pivot`)", chiave: "fogli.motivo.pivot_cell" },
  { frase: "select a cell in a table", chiave: "fogli.motivo.context.table" },
  { frase: "the clipboard is empty", chiave: "fogli.motivo.clipboard_empty" },
  { frase: "the workbook cannot be measured: {error}", chiave: "fogli.motivo.cannot_measure" },
  { frase: "the workbook cannot be rewritten: {error}", chiave: "fogli.motivo.cannot_rewrite" },
  { frase: "the workbook's sheets have no unique ids", chiave: "fogli.motivo.no_sheet_ids" },
  { frase: "there are no comments in this workbook", chiave: "fogli.motivo.no_comments" },
  { frase: "unknown command `{0}`", chiave: "fogli.motivo.unknown_command", command: ["0"] },
];

interface Pattern {
  readonly motivo: Motivo;
  readonly names: readonly string[];
  readonly regex: RegExp;
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/// La frase come espressione: i segnaposti prendono il più corto possibile,
/// e dopo una frase che non finisce con un parametro può venire un
/// dettaglio (`: …`), che resta.
function compile(motivo: Motivo): Pattern {
  const names: string[] = [];
  let source = "";
  let last = 0;
  for (const match of motivo.frase.matchAll(/\{(\w+)\}/g)) {
    source += escape(motivo.frase.slice(last, match.index));
    names.push(match[1]!);
    source += "([\\s\\S]+?)";
    last = match.index! + match[0].length;
  }
  source += escape(motivo.frase.slice(last));
  const open = last < motivo.frase.length || names.length === 0;
  const tail = open ? "(?::\\s*([\\s\\S]*?))?" : "";
  return { motivo, names, regex: new RegExp(`^${source}${tail}\\.?$`, "i") };
}

let patterns: readonly Pattern[] | null = null;

interface Found {
  readonly motivo: Motivo;
  readonly params: Record<string, string>;
  readonly detail: string | null;
}

function match(frase: string): Found | null {
  patterns ??= MOTIVI.map(compile);
  const text = frase.trim();
  for (const { motivo, names, regex } of patterns) {
    const found = regex.exec(text);
    if (!found) continue;
    const params: Record<string, string> = {};
    names.forEach((name, at) => {
      params[name] = found[at + 1] ?? "";
    });
    const detail = found[names.length + 1]?.trim() || null;
    return { motivo, params, detail };
  }
  return null;
}

/// La chiave della traduzione di `frase` e i suoi parametri, o `null` se
/// la frase non è fra quelle note.
export function motivoKey(frase: string): { key: FogliKey; params: Record<string, string>; detail: string | null } | null {
  const found = match(frase);
  return found ? { key: found.motivo.chiave, params: found.params, detail: found.detail } : null;
}

/// Il titolo di un comando del catalogo nella lingua della shell, o il suo
/// nome com'è se il catalogo non lo conosce.
function commandName(id: string): string {
  const key = `fogli.cmd.${id}`;
  return hasFogliKey(key) ? t(key) : id;
}

/// `frase` del motore nella lingua della shell. Una frase vuota non dice
/// niente e torna `null`.
export function motivo(frase: string | null | undefined): string | null {
  const text = frase?.trim();
  if (!text) return null;
  return translate(text, 0);
}

function translate(text: string, depth: number): string {
  const direct = known(text, depth);
  if (direct !== null) return direct;
  // Chi passa la frase può averci messo davanti la sua (`errore: …`): si
  // cerca la frase nota dopo ogni `: `.
  for (let at = text.indexOf(": "); at >= 0; at = text.indexOf(": ", at + 2)) {
    const rest = known(text.slice(at + 2), depth);
    if (rest !== null) return rest;
  }
  return t("fogli.motivo.unknown", { frase: text.replace(/\.$/, "") });
}

function known(text: string, depth: number): string | null {
  const found = match(text);
  if (!found) return null;
  const { motivo: own } = found;
  const params: Record<string, string> = {};
  for (const [name, value] of Object.entries(found.params)) {
    if (own.command?.includes(name)) params[name] = commandName(value);
    else if (own.nested?.includes(name) && depth < 3) params[name] = known(value, depth + 1) ?? value;
    else params[name] = value;
  }
  const said = t(own.chiave, params);
  return found.detail ? t("fogli.motivo.with_detail", { motivo: said, detail: found.detail }) : said;
}
