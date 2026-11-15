// Le parole di «Incolla codice» (LIC T25): il testo degli appunti, la lista
// che contiene, il primo problema del controllo e il riassunto, come li
// legge chi usa la lavagna. Le regole le decide il nucleo (`canvas_check`):
// qui c'è solo il modo di dirle.

import { plural, t, type Key } from "../../i18n/strings";
import { readClipboard } from "../../platform/clipboard";
import type { CanvasCheckProblem, CanvasIntentOp, CanvasSummary } from "./wasm/core";

/** Il primo `text/plain` degli appunti; `""` se non ce n'è. Rifiuta se il sistema non li fa leggere. */
export async function clipboardText(): Promise<string> {
  for (const entry of await readClipboard()) {
    if (entry.types.includes("text/plain")) return (await entry.getType("text/plain")).text();
  }
  return "";
}

/** Il testo senza il BOM in testa, come lo legge il nucleo. */
function withoutBom(text: string): string {
  return text.startsWith("﻿") ? text.slice(1) : text;
}

/**
 * La lista di operazioni del testo `text`, se è una lista JSON; `null`
 * altrimenti. Non la controlla: lo fa il nucleo.
 */
export function codeList(text: string | undefined): CanvasIntentOp[] | null {
  if (text === undefined) return null;
  try {
    const value: unknown = JSON.parse(withoutBom(text));
    return Array.isArray(value) ? (value as CanvasIntentOp[]) : null;
  } catch {
    return null;
  }
}

/** I codici dei problemi che il catalogo sa dire; un codice nuovo del nucleo si dice come `invalid`. */
const PROBLEMS = new Set([
  "invalid", "unknown_op", "unknown_field", "missing_field", "wrong_type", "bad_value", "unknown_node",
  "unknown_edge", "duplicate_id", "too_many", "too_many_moved", "unknown_stroke", "foreign_layer",
]);

/**
 * L'avviso per una lista che il controllo rifiuta: appunti vuoti, un testo
 * che non è una lista, una lista vuota (non cambia niente), o il primo
 * problema con l'operazione (da uno), il
 * campo e, se c'è, il nome più vicino.
 */
export function checkProblemText(text: string, problem: CanvasCheckProblem | undefined): string {
  if (withoutBom(text).trim() === "") return t("canvas.paste_code.empty");
  if (!problem || problem.index === null) {
    // `[]` è una lista che il nucleo rifiuta perché non ha operazioni: non cambia niente.
    return t(codeList(text)?.length === 0 ? "canvas.paste_code.nothing" : "canvas.paste_code.not_list");
  }
  const code = PROBLEMS.has(problem.code) ? problem.code : "invalid";
  const said = t("canvas.paste_code.problem", {
    n: String(problem.index + 1),
    path: problem.path === "" ? "/" : problem.path,
    problem: t(`canvas.code.problem.${code}` as Key),
  });
  return problem.suggestion ? `${said} ${t("canvas.paste_code.suggestion", { suggestion: problem.suggestion })}` : said;
}

/**
 * Il riassunto in una frase: quante schede nascono, si spostano, cambiano
 * misura o campi, quante si tolgono, lo stesso per archi e tratti, e se
 * cambia l'ordine. `""` se la lista non cambia niente.
 */
export function summaryText(summary: CanvasSummary): string {
  const parts: string[] = [];
  const say = (count: number, key: string): void => {
    if (count > 0) parts.push(plural(count, `canvas.paste_code.${key}.one` as Key, `canvas.paste_code.${key}` as Key));
  };
  const changed = summary.cards_changed;
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
