import katex from "katex";
import { describe, expect, it } from "vitest";
import { readOptions } from "../math";
import { editOptions, instrument } from "./caret";
import { CORPUS, LONG_FORMULA } from "./corpus";
import { backspace, deleteForward, typeChar, type MathState, type Outcome } from "./edit";
import { holesOf, mapFormula, placeAt, stopsOf } from "./points";

// I punti del cursore sul corpus di formule vere (T60): scrivere in un punto
// buono non rompe mai la formula, e nemmeno Backspace e Canc.

function reads(tex: string, display = false): boolean {
  try {
    katex.renderToString(tex, readOptions(display));
    return true;
  } catch {
    return false;
  }
}

function drawn(tex: string, display = false): string {
  return katex.renderToString(tex, { ...editOptions(display), output: "html" });
}

const after = (state: MathState, outcome: Outcome): MathState => outcome.kind === "edit" ? outcome.state
  : outcome.kind === "move" ? { tex: state.tex, caret: outcome.caret } : state;

describe("il corpus", () => {
  it("ogni formula del corpus si legge con le regole della lettura", () => {
    for (const { tex, display } of CORPUS) expect(reads(tex, display), tex).toBe(true);
    expect(reads(LONG_FORMULA)).toBe(true);
    expect(LONG_FORMULA.length).toBeGreaterThan(1_800);
  });
});

describe("i punti buoni", () => {
  it("cominciano e finiscono la formula, e non stanno mai a metà di un comando", () => {
    for (const { tex } of CORPUS) {
      const stops = stopsOf(mapFormula(tex));
      expect(stops[0], tex).toBe(0);
      expect(stops.at(-1), tex).toBe(tex.length);
      for (const at of stops) {
        // Mai fra la barra e il nome, né dentro il nome di un comando.
        expect(/\\[a-zA-Z]*$/.test(tex.slice(0, at)) && /^[a-zA-Z]/.test(tex.slice(at)), `${tex} @${at}`).toBe(false);
      }
    }
  });

  it("non entrano nel colore, nelle misure, nelle colonne di un array", () => {
    const inside = (tex: string, word: string) => {
      const from = tex.indexOf(word);
      return stopsOf(mapFormula(tex)).some((at) => at > from && at < from + word.length);
    };
    expect(inside("\\color{red}{x} + y", "red")).toBe(false);
    expect(inside("a \\kern2pt b", "2pt")).toBe(false);
    expect(inside("a \\hspace{1em} b", "1em")).toBe(false);
    expect(inside("\\begin{array}{cc} a & b \\end{array}", "{cc}")).toBe(false);
    expect(inside("\\begin{array}{c|c} 1 & 2 \\\\[2pt] 3 & 4 \\end{array}", "[2pt]")).toBe(false);
  });

  it("disegnati, ogni segno è un `data-fubp` e la formula si legge ancora", () => {
    for (const { tex, display } of CORPUS) {
      const html = drawn(instrument(tex), display);
      for (const at of stopsOf(mapFormula(tex))) expect(html, `${tex} @${at}`).toContain(`data-fubp="${at}"`);
    }
  });

  it("scrivere in un punto buono non rompe mai la formula", () => {
    const failures: string[] = [];
    for (const { tex, display } of CORPUS) {
      for (const caret of stopsOf(mapFormula(tex))) {
        for (const ch of ["x", "2", "^", "_", "*", "+", "%", "$", "&", "{", "}", "'", "|", "\\"]) {
          const outcome = typeChar({ tex, caret }, ch);
          if (outcome.kind !== "edit") continue;
          // La `\` comincia un comando, che resta in sospeso: la provano le
          // regole del comando.
          if (ch === "\\") continue;
          if (!reads(outcome.state.tex, display)) failures.push(`${ch} in ${tex} @${caret} → ${outcome.state.tex}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("dopo un tasto il cursore sta ancora in un punto buono", () => {
    const failures: string[] = [];
    for (const { tex } of CORPUS) {
      for (const caret of stopsOf(mapFormula(tex))) {
        for (const ch of ["x", "2", "^", "*"]) {
          const next = after({ tex, caret }, typeChar({ tex, caret }, ch));
          if (!stopsOf(mapFormula(next.tex)).includes(next.caret)) failures.push(`${ch} in ${tex} @${caret} → ${next.tex} @${next.caret}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("Backspace e Canc in ogni punto non rompono mai la formula", () => {
    const failures: string[] = [];
    for (const { tex, display } of CORPUS) {
      for (const caret of stopsOf(mapFormula(tex))) {
        for (const [name, rule] of [["Backspace", backspace], ["Canc", deleteForward]] as const) {
          const outcome = rule({ tex, caret });
          if (outcome.kind === "edit" && !reads(outcome.state.tex, display)) failures.push(`${name} in ${tex} @${caret} → ${outcome.state.tex}`);
          const next = after({ tex, caret }, outcome);
          if (!stopsOf(mapFormula(next.tex)).includes(next.caret)) failures.push(`${name} in ${tex} @${caret}: cursore fuori @${next.caret}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("Backspace ripetuto svuota ogni formula senza romperla mai", () => {
    for (const { tex, display } of CORPUS) {
      let state: MathState = { tex, caret: tex.length };
      for (let step = 0; step < 4 * tex.length + 10 && state.tex !== ""; step++) {
        let outcome = backspace(state);
        if (outcome.kind === "none") {
          // All'inizio di un tratto pieno Backspace non fa niente: si va in fondo.
          outcome = { kind: "move", caret: state.tex.length };
          if (state.caret === state.tex.length) break;
        }
        state = after(state, outcome);
        expect(reads(state.tex, display) || state.tex === "", `${tex} → ${state.tex}`).toBe(true);
      }
    }
  });

  it("la formula lunga: punti e segni in pochi millisecondi", () => {
    const started = performance.now();
    const stops = stopsOf(mapFormula(LONG_FORMULA));
    const html = drawn(instrument(LONG_FORMULA));
    expect(stops.length).toBeGreaterThan(500);
    expect(html).toContain(`data-fubp="${LONG_FORMULA.length}"`);
    // Largo: la macchina della CI è lenta, e la prova è che non esploda.
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("dove si è", () => {
  const place = (tex: string, at: number) => placeAt(mapFormula(tex), at);

  it("numeratore, denominatore, esponente di x, pedice, sotto la radice, testo", () => {
    expect(place("\\frac{a}{b}", 6).role).toBe("numerator");
    expect(place("\\frac{a}{b}", 9).role).toBe("denominator");
    expect(place("x^{2}", 3)).toEqual({ role: "exponent", base: "x" });
    expect(place("x_{i}", 3)).toEqual({ role: "subscript", base: "x" });
    expect(place("\\sqrt{2}", 6).role).toBe("radicand");
    expect(place("\\text{ab}", 7).role).toBe("text");
    expect(place("a + b", 2).role).toBe("formula");
    expect(place("\\vec{v}", 5)).toEqual({ role: "argument", command: "vec" });
  });

  it("in un ambiente, la riga e la colonna", () => {
    const tex = "\\begin{matrix} a & b \\\\ c & d \\end{matrix}";
    expect(place(tex, tex.indexOf("d"))).toEqual({ role: "cell", row: 2, column: 2 });
    expect(place(tex, tex.indexOf("a"))).toEqual({ role: "cell", row: 1, column: 1 });
  });

  it("gli spazi vuoti sono fra due graffe", () => {
    expect(holesOf(mapFormula("\\frac{}{}"))).toEqual([6, 8]);
    expect(holesOf(mapFormula("\\frac{a}{b}"))).toEqual([]);
  });
});
