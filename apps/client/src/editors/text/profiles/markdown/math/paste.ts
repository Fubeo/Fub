// Copiare e incollare le formule (T65, E27). Una formula incollata coi suoi
// delimitatori (`\( \)`, `\[ \]`, i dollari, un recinto `latex`) entra senza:
// è il caso di ciò che si copia da un assistente. Nel riquadro della formula
// entra il TeX nudo; nella nota `\( \)` diventa `$…$` e `\[ \]` diventa
// `$$…$$`, la scrittura delle formule di Fub, e i dollari restano com'erano.
// Il testo con dollari che non fanno una formula (`costa $5 e $6`) entra
// com'è.
//
// Qui anche la copia per Word: il MathML di KaTeX senza l'annotazione del TeX,
// che Word e LibreOffice leggono come un'equazione.
//
// Le regole sono senza DOM; in fondo l'aggancio all'incolla della nota.
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { textLines } from "../../../line-breaks";
import { carriedMarkdown } from "../comments/copy";
import { formulaAt } from "../menu";
import { isStrictlyInsideCode } from "../parser";

/// Una formula tolta dai suoi delimitatori.
export interface Unwrapped {
  readonly tex: string;
  /// Era a blocco (`\[ \]`, `$$`, un recinto) o in riga (`\( \)`, `$`).
  readonly display: boolean;
}

/// In `text`, da `from`, la prima `\` seguita da `close` che non sia a sua
/// volta protetta da una `\`: `\\[2pt]` (a capo con uno spazio) non chiude
/// niente. -1 se non c'è.
function delimiter(text: string, close: string, from = 0): number {
  for (let at = from; at < text.length - 1; at++) {
    if (text[at] !== "\\") continue;
    if (text[at + 1] === close) return at;
    at++;
  }
  return -1;
}

/// Un dollaro non protetto da `\`.
function hasDollar(text: string): boolean {
  for (let at = 0; at < text.length; at++) {
    if (text[at] === "\\") at++;
    else if (text[at] === "$") return true;
  }
  return false;
}

const FENCE = /^(`{3,}|~{3,})[ \t]*(?:latex|tex|math|katex)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\1$/i;

/// La formula di `text` senza i suoi delimitatori, se `text` è tutto e
/// soltanto una formula: `\(x\)`, `\[x\]`, `$x$`, `$$x$$`, o un recinto
/// `latex`/`tex`/`math` con dentro il TeX (con o senza delimitatori).
/// `null` per tutto il resto: più formule, testo intorno, dollari che non
/// fanno una formula.
export function unwrapFormula(text: string): Unwrapped | null {
  const trimmed = text.trim();
  const fenced = FENCE.exec(trimmed);
  if (fenced) {
    const inner = fenced[2]!;
    const nested = unwrapFormula(inner);
    if (nested) return { tex: nested.tex, display: true };
    const tex = inner.trim();
    return tex && !hasDollar(tex) ? { tex, display: true } : null;
  }
  let inner: string | null = null;
  let display = false;
  if (trimmed.startsWith("\\[") && trimmed.endsWith("\\]") && trimmed.length >= 4) {
    inner = trimmed.slice(2, -2);
    display = true;
    if (delimiter(inner, "]") >= 0 || delimiter(inner, "[") >= 0) return null;
  } else if (trimmed.startsWith("\\(") && trimmed.endsWith("\\)") && trimmed.length >= 4) {
    inner = trimmed.slice(2, -2);
    if (delimiter(inner, ")") >= 0 || delimiter(inner, "(") >= 0) return null;
  } else if (trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length >= 4) {
    inner = trimmed.slice(2, -2);
    display = true;
    if (hasDollar(inner)) return null;
  } else if (trimmed.startsWith("$") && trimmed.endsWith("$") && trimmed.length >= 2 && !trimmed.startsWith("$$")) {
    inner = trimmed.slice(1, -1);
    // Le regole dei dollari della nota: niente spazio subito dentro.
    if (hasDollar(inner) || /^\s|\s$/.test(inner)) return null;
  }
  if (inner === null || inner.endsWith("\\") && !inner.endsWith("\\\\")) return null;
  const tex = inner.trim();
  return tex ? { tex, display } : null;
}

/// Il testo di un incolla nella nota con `\( \)` e `\[ \]` scritti come le
/// formule di Fub: `$…$` e `$$…$$`. Il codice (recinti e `` ` ``) resta com'è,
/// e una coppia non si cerca oltre una riga vuota. `null` se non c'era niente
/// da cambiare: il testo entra per la sua strada di sempre.
export function pastedFormulas(text: string): string | null {
  if (!text.includes("\\(") && !text.includes("\\[")) return null;
  const lines = text.split("\n");
  const out: string[] = [];
  let prose: string[] = [];
  let fence: string | null = null;
  let changed = false;
  const flush = () => {
    if (prose.length === 0) return;
    const joined = prose.join("\n");
    const converted = convertProse(joined);
    if (converted !== joined) changed = true;
    out.push(converted);
    prose = [];
  };
  for (const line of lines) {
    const mark = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== null) {
      out.push(line);
      if (mark && mark[0] === fence[0] && mark.length >= fence.length && line.trim() === mark) fence = null;
      continue;
    }
    if (mark) {
      flush();
      fence = mark;
      out.push(line);
      continue;
    }
    prose.push(line);
  }
  flush();
  return changed ? out.join("\n") : null;
}

/// `\( \)` e `\[ \]` in un pezzo di testo senza recinti, saltando il codice in
/// riga.
function convertProse(text: string): string {
  let out = "";
  let at = 0;
  while (at < text.length) {
    const ch = text[at]!;
    if (ch === "`") {
      let run = 1;
      while (text[at + run] === "`") run++;
      const ticks = "`".repeat(run);
      let close = text.indexOf(ticks, at + run);
      while (close >= 0 && text[close + run] === "`") close = text.indexOf(ticks, close + run + 1);
      const end = close < 0 ? at + run : close + run;
      out += text.slice(at, end);
      at = end;
      continue;
    }
    if (ch !== "\\") {
      out += ch;
      at++;
      continue;
    }
    const open = text[at + 1];
    if (open !== "(" && open !== "[") {
      out += text.slice(at, at + 2);
      at += 2;
      continue;
    }
    const close = delimiter(text, open === "(" ? ")" : "]", at + 2);
    const inner = close < 0 ? "" : text.slice(at + 2, close);
    if (close < 0 || /\n[ \t]*\n/.test(inner) || !inner.trim()) {
      out += text.slice(at, at + 2);
      at += 2;
      continue;
    }
    if (open === "[") {
      out += `$$${inner}$$`;
    } else {
      const tex = inner.trim().replace(/\s*\n\s*/g, " ");
      // Un dollaro di chiusura seguito da una cifra non chiude (`$x$2`): lì
      // la formula si scrive coi due dollari.
      const after = text[close + 2];
      out += after !== undefined && after >= "0" && after <= "9" ? `$$${tex}$$` : `$${tex}$`;
    }
    at = close + 2;
  }
  return out;
}

/// Il MathML di KaTeX (`output: "mathml"`) come lo vuole Word: il solo
/// elemento `<math>`, con lo spazio dei nomi, senza `<semantics>` e senza
/// l'annotazione col TeX, che Word scriverebbe come testo. `null` se dentro
/// non c'è un `<math>`.
export function wordMathml(katexMathml: string): string | null {
  const start = katexMathml.indexOf("<math");
  const end = katexMathml.lastIndexOf("</math>");
  if (start < 0 || end < start) return null;
  let math = katexMathml.slice(start, end + "</math>".length);
  math = math.replace(/<annotation\b[^>]*>[\s\S]*?<\/annotation>/g, "").replace(/<\/?semantics>/g, "");
  if (!/^<math[^>]*\sxmlns=/.test(math)) math = math.replace(/^<math/, "<math xmlns=\"http://www.w3.org/1998/Math/MathML\"");
  return math;
}

/// L'HTML che accompagna il MathML negli appunti: chi legge l'HTML (Word,
/// LibreOffice, un'email) trova l'equazione.
export function mathmlHtml(mathml: string): string {
  return `<!DOCTYPE html><html><body>${mathml}</body></html>`;
}

// ── L'incolla nella nota ─────────────────────────────────────────────────────

/// Che cosa entra nella nota da un incolla di `plain` in `pos`: il TeX nudo
/// dentro una formula, le formule di Fub fuori. `null`: l'incolla segue la
/// sua strada (`../paste.ts`).
export function notePaste(state: EditorState, pos: number, plain: string): string | null {
  if (isStrictlyInsideCode(state, pos)) return null;
  const formula = formulaAt(state, pos);
  if (formula && pos >= formula.from + formula.dollars && pos <= formula.to - formula.dollars) {
    const unwrapped = unwrapFormula(plain);
    return unwrapped ? unwrapped.tex : null;
  }
  return pastedFormulas(plain);
}

/// L'aggancio all'incolla della nota, prima di quello del Markdown: entra
/// soltanto quando ci sono formule da riscrivere, e lascia stare il testo
/// portato da Fub (`comments/copy.ts`).
export const formulaPaste = EditorView.domEventHandlers({
  paste(event, view) {
    const data = event.clipboardData;
    if (view.state.readOnly || view.compositionStarted || !data) return false;
    if (carriedMarkdown(data) !== null) return false;
    const plain = data.getData("text/plain");
    if (!plain) return false;
    const insert = notePaste(view.state, view.state.selection.main.from, plain.replace(/\r\n?/g, "\n"));
    if (insert === null) return false;
    event.preventDefault();
    view.dispatch(view.state.replaceSelection(textLines(insert)), { userEvent: "input.paste" });
    return true;
  },
});
