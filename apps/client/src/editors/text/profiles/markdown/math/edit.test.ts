import katex from "katex";
import { describe, expect, it } from "vitest";
import { readOptions } from "../math";
import { arrow, backspace, deleteForward, edge, finishCommand, insertText, space, tab, typeChar, type MathState, type Outcome } from "./edit";

// Le regole dei tasti nella formula toccata (T60, E27), senza DOM. Il cursore
// si scrive `|` nel TeX: `s("x^{|}")` è la formula `x^{}` col cursore dentro.

const s = (marked: string): MathState => ({ tex: marked.replace("|", ""), caret: marked.indexOf("|") });
const show = (state: MathState) => state.tex.slice(0, state.caret) + "|" + state.tex.slice(state.caret);
function result(before: MathState, outcome: Outcome): string {
  if (outcome.kind === "edit") return show(outcome.state);
  if (outcome.kind === "move") return show({ tex: before.tex, caret: outcome.caret });
  return outcome.kind === "leave" ? `leave:${outcome.side}` : "none";
}
const renders = (tex: string) => {
  try {
    katex.renderToString(tex, readOptions(false));
    return true;
  } catch {
    return false;
  }
};

describe("le frecce", () => {
  it("attraversano un pezzo alla volta, entrando ed uscendo dalla frazione", () => {
    let state = s("|\\frac{a}{b}");
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const outcome = arrow(state, 1);
      seen.push(result(state, outcome));
      if (outcome.kind !== "move") break;
      state = { tex: state.tex, caret: outcome.caret };
    }
    expect(seen).toEqual(["\\frac{|a}{b}", "\\frac{a|}{b}", "\\frac{a}{|b}", "\\frac{a}{b|}", "\\frac{a}{b}|", "leave:after"]);
    expect(result(s("|x"), arrow(s("|x"), -1))).toBe("leave:before");
  });

  it("Inizio e Fine vanno ai due capi", () => {
    expect(result(s("a+\\frac{b|}{c}"), edge(s("a+\\frac{b|}{c}"), -1))).toBe("|a+\\frac{b}{c}");
    expect(result(s("a+\\frac{b|}{c}"), edge(s("a+\\frac{b|}{c}"), 1))).toBe("a+\\frac{b}{c}|");
  });
});

describe("gli spazi vuoti", () => {
  it("Tab va al quadretto dopo, Maiusc Tab a quello prima; senza, esce dal pezzo e poi dalla formula", () => {
    expect(result(s("\\frac{|}{}"), tab(s("\\frac{|}{}"), false))).toBe("\\frac{}{|}");
    expect(result(s("\\frac{}{|}"), tab(s("\\frac{}{|}"), true))).toBe("\\frac{|}{}");
    expect(result(s("\\frac{a|}{b}"), tab(s("\\frac{a|}{b}"), false))).toBe("\\frac{a}{|b}");
    expect(result(s("\\frac{a}{b|}+c"), tab(s("\\frac{a}{b|}+c"), false))).toBe("\\frac{a}{b}|+c");
    expect(result(s("a|+b"), tab(s("a|+b"), false))).toBe("leave:after");
  });
});

describe("lo spazio", () => {
  it("esce dall'esponente, come nelle equazioni di Word", () => {
    expect(result(s("x^{2|}"), space(s("x^{2|}")))).toBe("x^{2}|");
    expect(result(s("x^{2|}+1"), space(s("x^{2|}+1")))).toBe("x^{2}|+1");
  });

  it("in mezzo a un pezzo non fa niente; nel testo è uno spazio", () => {
    expect(result(s("a|+b"), space(s("a|+b")))).toBe("none");
    expect(result(s("\\text{due|}"), space(s("\\text{due|}")))).toBe("\\text{due |}");
  });
});

describe("i tasti che scrivono", () => {
  it("^ e _ mettono un esponente o un pedice col suo spazio vuoto", () => {
    expect(result(s("x|"), typeChar(s("x|"), "^"))).toBe("x^{|}");
    expect(result(s("x|"), typeChar(s("x|"), "_"))).toBe("x_{|}");
  });

  it("un secondo ^ sullo stesso pezzo entra in quello che c'è, invece di rompere la formula", () => {
    expect(result(s("x^{2}|"), typeChar(s("x^{2}|"), "^"))).toBe("x^{2|}");
    expect(result(s("x^2|"), typeChar(s("x^2|"), "^"))).toBe("x^{2|}");
    expect(result(s("x^{2}_{i}|"), typeChar(s("x^{2}_{i}|"), "^"))).toBe("x^{2|}_{i}");
  });

  it("* è il punto della moltiplicazione; i segni speciali entrano col loro comando", () => {
    expect(result(s("a|"), typeChar(s("a|"), "*"))).toBe("a\\cdot |");
    expect(result(s("5|"), typeChar(s("5|"), "%"))).toBe("5\\%|");
    expect(result(s("|5"), typeChar(s("|5"), "$"))).toBe("\\$|5");
    expect(result(s("a|"), typeChar(s("a|"), "&"))).toBe("a\\&|");
  });

  it("le graffe restano in pari: { non scrive, } esce dal pezzo", () => {
    expect(result(s("a|"), typeChar(s("a|"), "{"))).toBe("none");
    expect(result(s("x^{2|}"), typeChar(s("x^{2|}"), "}"))).toBe("x^{2}|");
  });

  it("una lettera dopo un comando di lettere non si incolla al suo nome", () => {
    expect(result(s("\\alpha|"), typeChar(s("\\alpha|"), "b"))).toBe("\\alpha b|");
  });

  it("in una riga di tabella | diventa \\vert, che non chiude la cella", () => {
    expect(result(s("|"), typeChar(s("|"), "|", { inTable: true }))).toBe("\\vert |");
    expect(result(s("|"), typeChar(s("|"), "|"))).toBe("||");
  });

  it("l'accento grave non entra mai: chiuderebbe il codice della nota", () => {
    expect(typeChar(s("a|"), "`").kind).toBe("none");
  });
});

describe("Backspace non rompe mai la formula", () => {
  it("un simbolo se ne va intero", () => {
    expect(result(s("a+\\alpha |"), backspace(s("a+\\alpha |")))).toBe("a+|");
    expect(result(s("5\\%|"), backspace(s("5\\%|")))).toBe("5|");
  });

  it("dopo una frazione ci entra, non la distrugge", () => {
    expect(result(s("\\frac{a}{b}|"), backspace(s("\\frac{a}{b}|")))).toBe("\\frac{a}{b|}");
    expect(result(s("\\sqrt{2}|"), backspace(s("\\sqrt{2}|")))).toBe("\\sqrt{2|}");
  });

  it("un pezzo tutto vuoto se ne va con un tasto solo", () => {
    expect(result(s("a+\\frac{|}{}"), backspace(s("a+\\frac{|}{}")))).toBe("a+|");
    expect(result(s("x^{|}"), backspace(s("x^{|}")))).toBe("x|");
    expect(result(s("\\sqrt{|}"), backspace(s("\\sqrt{|}")))).toBe("|");
  });

  it("all'inizio di un pezzo pieno torna al punto prima", () => {
    expect(result(s("\\frac{a}{|b}"), backspace(s("\\frac{a}{|b}")))).toBe("\\frac{a|}{b}");
  });

  it("le righe e le colonne di una matrice restano", () => {
    expect(result(s("\\begin{matrix} a &|b \\end{matrix}"), backspace(s("\\begin{matrix} a &|b \\end{matrix}"))))
      .toBe("\\begin{matrix} a |&b \\end{matrix}");
  });

  it("Canc davanti a una base lascia il suo spazio vuoto all'esponente", () => {
    expect(result(s("|x^{2}"), deleteForward(s("|x^{2}")))).toBe("{|}^{2}");
  });
});

describe("i comandi scritti per nome", () => {
  it("prendono gli spazi vuoti dei loro argomenti", () => {
    expect(result(s("\\frac|"), finishCommand(s("\\frac|"), 0, renders)!)).toBe("\\frac{|}{}");
    expect(result(s("1+\\sqrt|"), finishCommand(s("1+\\sqrt|"), 2, renders)!)).toBe("1+\\sqrt{|}");
    expect(result(s("\\alpha|b"), finishCommand(s("\\alpha|b"), 0, renders)!)).toBe("\\alpha |b");
  });

  it("un nome che non esiste resta in sospeso, una barra da sola se ne va", () => {
    expect(finishCommand(s("\\alfa|"), 0, renders)).toBeNull();
    expect(finishCommand(s("\\color|"), 0, renders)).toBeNull();
    expect(result(s("a\\|"), finishCommand(s("a\\|"), 1, renders)!)).toBe("a|");
  });
});

describe("l'incolla", () => {
  it("toglie i delimitatori di una formula", () => {
    expect(result(s("|"), insertText(s("|"), "\\(x^2\\)"))).toBe("x^2|");
    expect(result(s("|"), insertText(s("|"), "$$a+b$$"))).toBe("a+b|");
  });

  it("rifiuta graffe dispari, dollari e accenti gravi", () => {
    expect(insertText(s("|"), "\\frac{a").kind).toBe("none");
    expect(insertText(s("|"), "a $ b").kind).toBe("none");
    expect(insertText(s("|"), "`a`").kind).toBe("none");
  });
});
