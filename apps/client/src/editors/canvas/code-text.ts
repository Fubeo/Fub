// Le parole di «Incolla codice» (LIC T25): il testo degli appunti letto una
// volta come lista, il primo problema del controllo, il riassunto e gli
// avvisi, come li legge chi usa la lavagna. Le regole delle operazioni le
// decide il nucleo (`canvas_check`): qui c'è la lettura del testo e il modo
// di dirle.

import { plural, t, type Key } from "../../i18n/strings";
import { readClipboard } from "../../platform/clipboard";
import type { CanvasCheckProblem, CanvasCheckWarning, CanvasSummary } from "./wasm/core";

/** Il primo `text/plain` degli appunti; `""` se non ce n'è. Rifiuta se il sistema non li fa leggere. */
export async function clipboardText(): Promise<string> {
  for (const entry of await readClipboard()) {
    if (entry.types.includes("text/plain")) return (await entry.getType("text/plain")).text();
  }
  return "";
}

/**
 * I livelli uno dentro l'altro che una lista può avere. Il nucleo legge la
 * richiesta con un tetto di 128, contando anche l'oggetto che la porta: il
 * client si ferma molto prima, così check e scrittura non arrivano mai a
 * leggere la stessa lista in due modi.
 */
export const MAX_CODE_DEPTH = 64;

/** Perché il testo degli appunti non è una lista da controllare: le frasi in `canvas.paste_code.<codice>`. */
export type CodeTextProblem = "empty" | "not_json" | "not_list" | "nothing" | "too_deep" | "bad_number" | "bad_text";

export type CodeList =
  | { readonly ok: true; readonly ops: readonly Record<string, unknown>[] }
  | { readonly ok: false; readonly problem: CodeTextProblem };

/**
 * Legge il testo degli appunti una volta: senza il BOM in testa, `JSON.parse`,
 * una lista non vuota. Un numero che JSON non dice esatto (`1e999` diventa
 * infinito), un testo con un surrogato spaiato o più di `MAX_CODE_DEPTH`
 * livelli non passano: sono la stessa risposta per il controllo e per la
 * scrittura, che ricevono lo stesso valore. Gli elementi della lista che non
 * sono oggetti li giudica il nucleo.
 */
export function readCodeList(text: string): CodeList {
  const body = text.startsWith("﻿") ? text.slice(1) : text;
  if (body.trim() === "") return { ok: false, problem: "empty" };
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return { ok: false, problem: "not_json" };
  }
  if (!Array.isArray(value)) return { ok: false, problem: "not_list" };
  if (value.length === 0) return { ok: false, problem: "nothing" };
  const wrong = unreadable(value, 1);
  if (wrong !== null) return { ok: false, problem: wrong };
  return { ok: true, ops: value as Record<string, unknown>[] };
}

function unreadable(value: unknown, depth: number): CodeTextProblem | null {
  if (typeof value === "number") return Number.isFinite(value) ? null : "bad_number";
  if (typeof value === "string") return wellFormed(value) ? null : "bad_text";
  if (value === null || typeof value !== "object") return null;
  if (depth > MAX_CODE_DEPTH) return "too_deep";
  const children = Array.isArray(value) ? value : Object.entries(value).flat();
  for (const child of children) {
    const wrong = unreadable(child, depth + 1);
    if (wrong !== null) return wrong;
  }
  return null;
}

function wellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

/** L'avviso per un testo che non è una lista da controllare. */
export function codeTextProblem(problem: CodeTextProblem): string {
  return t(`canvas.paste_code.${problem}` as Key);
}

/**
 * I codici dei problemi del nucleo (`Code` di `check.rs`) che il catalogo sa
 * dire; un codice nuovo si dice come `invalid`, e la guardia di
 * `code-text.test.ts` chiede di aggiungerlo.
 */
export const PROBLEMS: ReadonlySet<string> = new Set([
  "invalid", "unknown_op", "unknown_field", "missing_field", "wrong_type", "bad_value", "unknown_node",
  "unknown_edge", "duplicate_id", "too_many", "too_many_moved", "unknown_stroke", "foreign_layer",
]);

/** La frase di un problema del nucleo. */
export function problemPhrase(problem: CanvasCheckProblem): string {
  return t(`canvas.code.problem.${PROBLEMS.has(problem.code) ? problem.code : "invalid"}` as Key);
}

/**
 * L'avviso per una lista che il controllo rifiuta: l'operazione (da uno), il
 * campo, la frase e, se c'è, il nome più vicino.
 */
export function checkProblemText(problem: CanvasCheckProblem | undefined): string {
  if (!problem) return t("canvas.paste_code.not_list");
  const suggestion = problem.suggestion ? ` ${t("canvas.paste_code.suggestion", { suggestion: problem.suggestion })}` : "";
  return t("canvas.paste_code.problem", {
    n: String((problem.index ?? 0) + 1),
    path: problem.path === "" ? "/" : problem.path,
    problem: problemPhrase(problem),
    suggestion,
  });
}

/**
 * Il riassunto in una frase: quante schede nascono, si spostano, cambiano
 * misura o campi, quante si tolgono, lo stesso per archi e tratti, e se
 * cambia l'ordine. Le schede di `updated` (quelle che «Aggiorna le schede»
 * riscrive) si contano a parte, come aggiornate. `""` se la lista non cambia
 * niente.
 */
export function summaryText(summary: CanvasSummary, updated: ReadonlySet<string> = new Set()): string {
  const parts: string[] = [];
  const say = (count: number, key: string): void => {
    if (count > 0) parts.push(plural(count, `canvas.paste_code.${key}.one` as Key, `canvas.paste_code.${key}` as Key));
  };
  const changed = summary.cards_changed.filter((card) => !updated.has(card.id));
  say(summary.cards_changed.length - changed.length, "cards_updated");
  say(summary.cards_added.length, "cards_added");
  say(summary.edges_added.length, "edges_added");
  say(changed.filter((card) => card.moved).length, "cards_moved");
  say(changed.filter((card) => card.resized).length, "cards_resized");
  say(changed.filter((card) => card.fields && card.fields.length > 0).length, "cards_changed");
  say(summary.cards_removed.length, "cards_removed");
  say(summary.edges_changed.length, "edges_changed");
  say(summary.edges_removed.length, "edges_removed");
  say(summary.strokes_added?.length ?? 0, "strokes_added");
  say(summary.strokes_changed?.length ?? 0, "strokes_changed");
  say(summary.strokes_removed?.length ?? 0, "strokes_removed");
  if (summary.order_changed) parts.push(t("canvas.paste_code.order"));
  return parts.join(", ");
}

/** Gli avvisi sulle schede: si contano per codice, ognuno con la sua frase. */
const LOOK_AT = ["overlap", "half_in_group", "text_overflow"] as const;

/** La frase di una nota delle operazioni, per codice (`canvas-check.md`). */
const NOTES: Readonly<Record<string, Key>> = {
  ink_kept: "canvas.paste_code.note.ink",
  pages_cut: "canvas.paste_code.note.pages_cut",
  page_size_not_file: "canvas.paste_code.note.page_size_not_file",
  page_count_from_file: "canvas.paste_code.note.page_count_from_file",
  shape_dropped: "canvas.paste_code.note.import",
  style_dropped: "canvas.paste_code.note.import",
  line_skipped: "canvas.paste_code.note.import",
  indent_rounded: "canvas.paste_code.note.import",
};

/**
 * Gli avvisi del controllo in parole: da una parte quelli da guardare dopo
 * (schede che si coprono, a metà in un gruppo, testi che non ci stanno, e
 * gli avvisi oltre i primi cento), contati per codice; dall'altra le note
 * delle operazioni, una frase per specie. `""` senza avvisi.
 */
export function warningsText(warnings: readonly CanvasCheckWarning[], omitted: number): string {
  const look: string[] = [];
  for (const code of LOOK_AT) {
    const count = warnings.filter((warning) => warning.code === code).length;
    if (count > 0) look.push(plural(count, `canvas.paste_code.warn.${code}.one` as Key, `canvas.paste_code.warn.${code}` as Key));
  }
  if (omitted > 0) look.push(plural(omitted, "canvas.paste_code.warn.omitted.one", "canvas.paste_code.warn.omitted"));
  const notes = [...new Set(warnings
    .filter((warning) => !(LOOK_AT as readonly string[]).includes(warning.code))
    .map((warning) => t(NOTES[warning.code] ?? "canvas.paste_code.note.other")))];
  return [
    look.length > 0 ? t("canvas.paste_code.warnings", { list: look.join(", ") }) : "",
    notes.length > 0 ? t("canvas.paste_code.notes", { list: notes.join("; ") }) : "",
  ].filter(Boolean).join(" ");
}
