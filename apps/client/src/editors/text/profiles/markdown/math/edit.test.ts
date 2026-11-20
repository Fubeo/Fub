import katex from "katex";
import { describe, expect, it } from "vitest";
import { readOptions } from "../math";
import { arrow, backspace, cellEnter, choosePiece, deleteForward, dropPair, edge, emptyCells, finishCommand, inTextGroup, insertTemplate, insertText, openPair, pieceText, QUICK_WORDS, quickWrite, removePiece, sourceHoles, sourceTab, space, stack, stepOver, stepPiece, tab, typeChar, undoQuick, wrapPair, wrapPiece, type MathState, type Outcome, type QuickOptions, type QuickUndo } from "./edit";
import { mapFormula } from "./points";
import { SYMBOLS } from "./symbols";

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

describe("le frecce su e giù", () => {
  it("vanno dal numeratore al denominatore e ritorno, a pari distanza", () => {
    expect(result(s("\\frac{a|b}{cd}"), stack(s("\\frac{a|b}{cd}"), 1))).toBe("\\frac{ab}{c|d}");
    expect(result(s("\\frac{ab}{c|d}"), stack(s("\\frac{ab}{c|d}"), -1))).toBe("\\frac{a|b}{cd}");
    expect(result(s("\\frac{abc|}{d}"), stack(s("\\frac{abc|}{d}"), 1))).toBe("\\frac{abc}{d|}");
    expect(result(s("\\frac{|}{}"), stack(s("\\frac{|}{}"), 1))).toBe("\\frac{}{|}");
  });

  it("fuori da una frazione lasciano fare al disegno", () => {
    expect(stack(s("\\frac{a|}{b}"), -1).kind).toBe("none");
    expect(stack(s("x^{2|}"), 1).kind).toBe("none");
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

// ── La scrittura veloce (T63) ───────────────────────────────────────────────

const FULL: QuickOptions = { help: "piene", decimalComma: true };

/// Scrive `text` un tasto alla volta in un campo, come l'evento `input`: ogni
/// segno entra, poi la scrittura veloce. `undo` è l'ultima trasformazione, se
/// il tasto ne ha fatta una.
function write(text: string, options: QuickOptions = FULL, from: MathState = s("|")) {
  let state = from;
  let undo: QuickUndo | null = null;
  for (const ch of text) {
    state = { tex: state.tex.slice(0, state.caret) + ch + state.tex.slice(state.caret), caret: state.caret + ch.length };
    const quick = quickWrite(state, ch, options);
    undo = quick?.undo ?? null;
    if (quick) state = quick.state;
  }
  return { state, undo, shown: show(state) };
}

/// Backspace subito dopo: rimette ciò che si era scritto.
function undone(text: string, options: QuickOptions = FULL): string {
  const { state, undo } = write(text, options);
  expect(undo, `«${text}» non si annulla`).not.toBeNull();
  return show(undoQuick(state, undo!)!);
}

describe("la scrittura veloce", () => {
  it("la tabella di E27, e ogni trasformazione si annulla con Backspace", () => {
    const table: readonly (readonly [string, string])[] = [
      ["a/", "\\frac{a}{|}"],
      ["(a+b)/", "\\frac{a+b}{|}"],
      ["x^2/", "\\frac{x^2}{|}"],
      ["x^10", "x^{10|}"],
      ["x_12", "x_{12|}"],
      ["->", "\\to |"],
      ["<->", "\\leftrightarrow |"],
      ["=>", "\\Rightarrow |"],
      ["<=", "\\le |"],
      [">=", "\\ge |"],
      ["!=", "\\ne |"],
      ["+-", "\\pm |"],
      ["~=", "\\approx |"],
      ["...", "\\dots |"],
      ["pi ", "\\pi |"],
      ["alpha+", "\\alpha+|"],
      ["sin(", "\\sin(|"],
      ["sqrt ", "\\sqrt{|}"],
      ["sqrt2", "\\sqrt{2|}"],
      ["inf ", "\\infty |"],
      ["3,1", "3{,}1|"],
      ["\"due parole\"", "\\text{due parole}|"],
      ["α", "\\alpha |"],
      ["×", "\\times |"],
      ["²", "^2|"],
      ["√", "\\sqrt{|}"],
    ];
    for (const [typed, expected] of table) {
      expect(write(typed).shown, typed).toBe(expected);
      expect(undone(typed), typed).toBe(`${typed}|`);
    }
  });

  it("Backspace annulla soltanto subito dopo, col cursore dov'era", () => {
    const { state, undo } = write("->");
    expect(undoQuick({ tex: state.tex, caret: state.caret - 1 }, undo!)).toBeNull();
    expect(undoQuick({ tex: `${state.tex}x`, caret: state.caret }, { ...undo!, replaced: "\\ne " })).toBeNull();
  });

  it("le parentesi si chiudono, si scavalcano e Backspace fra due vuote le toglie", () => {
    expect(show(openPair(s("a|"), "(")!)).toBe("a(|)");
    expect(show(openPair(s("|"), "[")!)).toBe("[|]");
    expect(show(openPair(s("|"), "{")!)).toBe("{|}");
    // `\{` è una graffa da vedere, non un gruppo.
    expect(openPair(s("\\|"), "{")).toBeNull();
    expect(openPair(s("|"), "a")).toBeNull();
    expect(stepOver(s("(a|)"), ")")).toBe(3);
    expect(stepOver(s("(a|"), ")")).toBeNull();
    expect(show(dropPair(s("a(|)")!)!)).toBe("a|");
    expect(show(dropPair(s("x^{|}")!)!)).toBe("x^|");
    expect(dropPair(s("\\{|}"))).toBeNull();
    expect(dropPair(s("(a|)"))).toBeNull();
  });

  it("un esponente di più cifre raggruppato: il primo segno che non è una cifra ne esce", () => {
    const { state } = write("x^10");
    const out = quickWrite({ tex: `${state.tex.slice(0, state.caret)}+${state.tex.slice(state.caret)}`, caret: state.caret + 1 }, "+", FULL);
    expect(show(out!.state)).toBe("x^{10}+|");
    // Un salto del cursore, non una trasformazione: non c'è niente da annullare.
    expect(out!.undo).toBeNull();
  });

  it("nel testo `->` resta com'è, e così ogni altra scrittura veloce", () => {
    expect(write("->", FULL, s("\\text{a |}")).shown).toBe("\\text{a ->|}");
    expect(write("pi ", FULL, s("\\text{|}")).shown).toBe("\\text{pi |}");
    expect(write("a/", FULL, s("\\textbf{|}")).shown).toBe("\\textbf{a/|}");
    expect(inTextGroup("\\text{a")).toBe(true);
    expect(inTextGroup("\\text{a} b")).toBe(false);
    // Fuori dal testo sì.
    expect(write("->", FULL, s("\\text{a} |")).shown).toBe("\\text{a} \\to |");
  });

  it("`3,14` in inglese resta una virgola che separa", () => {
    const english: QuickOptions = { help: "piene", decimalComma: false };
    expect(write("3,14", english).shown).toBe("3,14|");
    expect(write("f(1,2)", english).shown).toBe("f(1,2)|");
    // In italiano sì, e il resto delle cifre segue.
    expect(write("3,14").shown).toBe("3{,}14|");
  });

  it("una parola dentro un'altra, o dopo `\\`, non si trasforma", () => {
    expect(write("pin ").shown).toBe("pin |");
    expect(write("\\pi ").shown).toBe("\\pi |");
    // Il numeratore è soltanto ciò che si è appena scritto, non la frazione prima.
    expect(write("x/", FULL, s("\\frac{a}{b}|")).shown).toBe("\\frac{a}{b}\\frac{x}{|}");
  });

  it("con gli aiuti discreti valgono soltanto i segni già disegnati e le cifre di un esponente", () => {
    const discreet: QuickOptions = { help: "discrete", decimalComma: true };
    expect(write("a/", discreet).shown).toBe("a/|");
    expect(write("->", discreet).shown).toBe("->|");
    expect(write("pi ", discreet).shown).toBe("pi |");
    expect(write("3,14", discreet).shown).toBe("3,14|");
    expect(write("\"a\"", discreet).shown).toBe("\"a\"|");
    expect(write("α", discreet).shown).toBe("\\alpha |");
    expect(write("x^10", discreet).shown).toBe("x^{10|}");
  });

  it("con gli aiuti spenti niente si trasforma", () => {
    const off: QuickOptions = { help: "spente", decimalComma: true };
    for (const typed of ["a/", "->", "pi ", "3,14", "α", "x^10", "\"a\""]) expect(write(typed, off).shown).toBe(`${typed}|`);
  });

  it("ogni scrittura veloce del catalogo funziona e si annulla", () => {
    for (const symbol of SYMBOLS) {
      const quick = symbol.quick;
      // `^` e `_` sono tasti della formula che si tocca; `a/b` una frazione.
      if (!quick || quick === "^" || quick === "_") continue;
      const typed = quick === "a/b" ? "a/" : /[a-zA-Z]$/.test(quick) ? `${quick} ` : quick;
      const { state, undo } = write(typed);
      expect(state.tex, `${symbol.id}: «${typed}»`).not.toBe(typed);
      expect(renders(state.tex.replace("{}", "{x}")), `${symbol.id}: ${state.tex}`).toBe(true);
      expect(show(undoQuick(state, undo!)!)).toBe(`${typed}|`);
    }
    for (const word of QUICK_WORDS) expect(write(`${word} `).state.tex).toMatch(/^\\/);
  });
});

describe("il campo del LaTeX", () => {
  it("gli spazi vuoti sono le graffe vuote, non `\\{}`", () => {
    expect(sourceHoles("\\frac{}{}")).toEqual([6, 8]);
    expect(sourceHoles("\\{}+x^{}")).toEqual([7]);
  });

  it("Tab va allo spazio vuoto dopo, poi fuori dalla graffa, poi fuori dalla formula", () => {
    expect(result(s("\\frac{|}{}"), sourceTab(s("\\frac{|}{}"), false))).toBe("\\frac{}{|}");
    expect(result(s("\\frac{a}{|b}"), sourceTab(s("\\frac{a}{|b}"), false))).toBe("\\frac{a}{b}|");
    expect(sourceTab(s("x|"), false)).toEqual({ kind: "leave", side: "after" });
    expect(result(s("\\frac{}{|}"), sourceTab(s("\\frac{}{|}"), true))).toBe("\\frac{|}{}");
    expect(sourceTab(s("|\\frac{}{}"), true).kind).toBe("none");
  });

  it("un modello del catalogo entra al posto del nome, col cursore nel primo spazio vuoto", () => {
    expect(show(insertTemplate(s("a+\\fr|"), "\\frac{}{}", 2))).toBe("a+\\frac{|}{}");
    expect(show(insertTemplate(s("|"), "\\alpha", 0))).toBe("\\alpha|");
    // Una selezione se ne va.
    expect(show(insertTemplate({ tex: "abc", caret: 0 }, "\\sqrt{}", 0, 3))).toBe("\\sqrt{|}");
  });
});

// ── Scegliere un pezzo, le celle delle matrici (T66) ────────────────────────
//
// Una scelta si scrive fra quadre nel TeX: `a+[bc]` è la formula `a+bc` col
// pezzo `bc` scelto. `chosen` ne dà le due punte (l'àncora e la punta).

const chosen = (marked: string) => {
  const anchor = marked.indexOf("[");
  const head = marked.indexOf("]") - 1;
  return { tex: marked.replace("[", "").replace("]", ""), anchor, head };
};
const showPiece = (tex: string, piece: { from: number; to: number } | null) =>
  piece ? `${tex.slice(0, piece.from)}[${tex.slice(piece.from, piece.to)}]${tex.slice(piece.to)}` : "nessuno";
const choose = (marked: string) => {
  const { tex, anchor, head } = chosen(marked);
  return showPiece(tex, choosePiece(tex, anchor, head));
};
const wrap = (marked: string, template: string) => {
  const { tex, anchor, head } = chosen(marked);
  return result({ tex, caret: 0 }, wrapPiece(tex, { from: anchor, to: head }, template, renders));
};

describe("scegliere un pezzo", () => {
  it("prende pezzi interi: una scelta a metà di una frazione si allarga alla frazione", () => {
    expect(choose("a+\\frac{b[c}{d}+]e")).toBe("a+[\\frac{bc}{d}+]e");
    expect(choose("a+\\frac{[b}{d]}")).toBe("a+[\\frac{b}{d}]");
    // Dentro lo stesso tratto resta lì.
    expect(choose("\\frac{[bc]}{d}")).toBe("\\frac{[bc]}{d}");
    expect(choose("\\sqrt{x[+]1}")).toBe("\\sqrt{x[+]1}");
  });

  it("un esponente non si sceglie senza ciò che lo porta, né la base senza l'esponente", () => {
    expect(choose("x[^{2}+]y")).toBe("[x^{2}+]y");
    expect(choose("[x]^{2}+y")).toBe("[x^{2}]+y");
    expect(choose("[\\sum_{i}]^{n} x")).toBe("[\\sum_{i}^{n}] x");
  });

  it("da una cella all'altra prende la matrice intera; un \\middle, la coppia di parentesi", () => {
    expect(choose("\\begin{pmatrix} a [& b \\\\ c] & d \\end{pmatrix}")).toBe("[\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}]");
    expect(choose("\\begin{pmatrix} [ab] & c \\end{pmatrix}")).toBe("\\begin{pmatrix} [ab] & c \\end{pmatrix}");
    expect(choose("\\left( a [\\middle| b] \\right)")).toBe("[\\left( a \\middle| b \\right)]");
  });

  it("senza spazi ai capi, e vuota quando le due punte coincidono", () => {
    expect(choose("\\alpha [b] c")).toBe("\\alpha [b] c");
    expect(choose("a[ ]b")).toBe("nessuno");
    expect(choosePiece("ab", 1, 1)).toBeNull();
  });

  it("Maiusc → allarga un pezzo alla volta, con i suoi esponenti; in fondo al tratto prende il pezzo che lo contiene", () => {
    const tex = "a+\\frac{b}{c}+x^{2}";
    const seen: string[] = [];
    for (let head: number | null = 0; head !== null && seen.length < 8;) {
      head = stepPiece(tex, head, 1);
      seen.push(head === null ? "fine" : showPiece(tex, choosePiece(tex, 0, head)));
    }
    expect(seen).toEqual([
      "[a]+\\frac{b}{c}+x^{2}",
      "[a+]\\frac{b}{c}+x^{2}",
      "[a+\\frac{b}{c}]+x^{2}",
      "[a+\\frac{b}{c}+]x^{2}",
      "[a+\\frac{b}{c}+x^{2}]",
      "fine",
    ]);
    // Dal numeratore: prima il pezzo dopo, poi la frazione intera.
    const inside = "a+\\frac{bc}{d}";
    const anchor = inside.indexOf("bc") + 1;
    const first = stepPiece(inside, anchor, 1)!;
    expect(showPiece(inside, choosePiece(inside, anchor, first))).toBe("a+\\frac{b[c]}{d}");
    const second = stepPiece(inside, first, 1)!;
    expect(showPiece(inside, choosePiece(inside, anchor, second))).toBe("a+[\\frac{bc}{d}]");
    // E Maiusc ← all'indietro, saltando la base con l'esponente.
    expect(stepPiece("a+x^{2}", 7, -1)).toBe(2);
  });

  it("si copia il suo LaTeX, e si toglie lasciando la formula buona", () => {
    expect(pieceText("a+\\frac{b}{c}", { from: 2, to: 13 })).toBe("\\frac{b}{c}");
    expect(result(s("a+\\frac{b}{c}|"), removePiece("a+\\frac{b}{c}", { from: 2, to: 13 }))).toBe("a+|");
    // Un comando di lettere non si incolla alla lettera che resta.
    expect(result(s("|"), removePiece("\\alpha xb", { from: 7, to: 8 }))).toBe("\\alpha |b");
  });
});

describe("il pezzo scelto in un pezzo nuovo", () => {
  it("va sotto la radice, nel numeratore, nell'esponente; il cursore nello spazio vuoto dopo", () => {
    expect(wrap("a+[bc]", "\\sqrt{}")).toBe("a+\\sqrt{bc}|");
    expect(wrap("a+[bc]", "\\frac{}{}")).toBe("a+\\frac{bc}{|}");
    expect(wrap("x+[ab]", "^{}")).toBe("x+^{ab}|");
    expect(wrap("[ab]", "\\left(§\\right)")).toBe("\\left(ab\\right)|");
    expect(wrap("[ab]", "\\begin{pmatrix} § &  \\\\  &  \\end{pmatrix}")).toBe("\\begin{pmatrix} ab &  \\\\  &  \\end{pmatrix}|");
  });

  it("un secondo esponente sullo stesso pezzo entra su una base vuota", () => {
    expect(wrap("x^{2}[b]", "^{}")).toBe("x^{2}{}^{b}|");
  });

  it("dove il modello non ha posto per lui il modello va davanti; un simbolo lo sostituisce", () => {
    expect(wrap("a+[bc]", "\\sum_{}^{}")).toBe("a+\\sum_{|}^{}bc");
    expect(wrap("a+[b^{2}]", "\\text{}")).toBe("a+\\text{|}b^{2}");
    expect(wrap("a+[bc]", "\\alpha")).toBe("a+\\alpha|");
  });

  it("fra parentesi", () => {
    expect(result(s("|"), wrapPair("a+bc", { from: 2, to: 4 }, "("))).toBe("a+(bc)|");
    expect(result(s("|"), wrapPair("\\alpha b", { from: 0, to: 6 }, "["))).toBe("[\\alpha] |b");
  });
});

describe("le celle di una matrice", () => {
  const matrix = "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}";
  const at = (marked: string) => s(marked);

  it("Tab passa alla cella dopo, in fondo a ciò che c'è scritto; dall'ultima esce", () => {
    let state = at("\\begin{pmatrix} a| & b \\\\ c & d \\end{pmatrix}");
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      const outcome = tab(state, false);
      seen.push(result(state, outcome));
      if (outcome.kind !== "move") break;
      state = { tex: state.tex, caret: outcome.caret };
    }
    expect(seen).toEqual([
      "\\begin{pmatrix} a & b |\\\\ c & d \\end{pmatrix}",
      "\\begin{pmatrix} a & b \\\\ c |& d \\end{pmatrix}",
      "\\begin{pmatrix} a & b \\\\ c & d |\\end{pmatrix}",
      `${matrix}|`,
      "leave:after",
    ]);
    expect(result(at("\\begin{pmatrix} a & b \\\\ c |& d \\end{pmatrix}"), tab(at("\\begin{pmatrix} a & b \\\\ c |& d \\end{pmatrix}"), true)))
      .toBe("\\begin{pmatrix} a & b |\\\\ c & d \\end{pmatrix}");
  });

  it("dentro una cella Tab passa prima per i suoi spazi vuoti", () => {
    const state = at("\\begin{pmatrix} |\\frac{}{} & b \\end{pmatrix}");
    expect(result(state, tab(state, false))).toBe("\\begin{pmatrix} \\frac{|}{} & b \\end{pmatrix}");
    const last = at("\\begin{pmatrix} \\frac{}{|} & b \\end{pmatrix}");
    expect(result(last, tab(last, false))).toBe("\\begin{pmatrix} \\frac{}{} & b |\\end{pmatrix}");
  });

  it("una matrice vuota: Tab va da un quadretto all'altro", () => {
    const empty = "\\begin{pmatrix}  &  \\\\  &  \\end{pmatrix}";
    expect(emptyCells(mapFormula(empty)).map((point) => show({ tex: empty, caret: point }))).toEqual([
      "\\begin{pmatrix}  |&  \\\\  &  \\end{pmatrix}",
      "\\begin{pmatrix}  &  |\\\\  &  \\end{pmatrix}",
      "\\begin{pmatrix}  &  \\\\  |&  \\end{pmatrix}",
      "\\begin{pmatrix}  &  \\\\  &  |\\end{pmatrix}",
    ]);
    const first = { tex: empty, caret: emptyCells(mapFormula(empty))[0]! };
    expect(result(first, tab(first, false))).toBe("\\begin{pmatrix}  &  |\\\\  &  \\end{pmatrix}");
    // Senza celle: un quadretto solo, e Invio ne fa una riga.
    const none = "\\begin{pmatrix}\\end{pmatrix}";
    expect(emptyCells(mapFormula(none))).toEqual([15]);
    const entered = cellEnter({ tex: none, caret: 15 });
    expect(entered?.kind).toBe("edit");
    if (entered?.kind === "edit") expect(renders(entered.state.tex)).toBe(true);
  });

  it("Invio passa alla riga dopo nella stessa colonna; dall'ultima riga ne aggiunge una vuota", () => {
    const a = at("\\begin{pmatrix} a| & b \\\\ c & d \\end{pmatrix}");
    expect(result(a, cellEnter(a)!)).toBe("\\begin{pmatrix} a & b \\\\ c |& d \\end{pmatrix}");
    const b = at("\\begin{pmatrix} a & b| \\\\ c & d \\end{pmatrix}");
    expect(result(b, cellEnter(b)!)).toBe("\\begin{pmatrix} a & b \\\\ c & d |\\end{pmatrix}");
    const d = at("\\begin{pmatrix} a & b \\\\ c & d| \\end{pmatrix}");
    const grown = cellEnter(d)!;
    expect(result(d, grown)).toBe("\\begin{pmatrix} a & b \\\\ c & d \\\\ |& \\end{pmatrix}");
    if (grown.kind === "edit") expect(renders(grown.state.tex)).toBe(true);
    // Una riga più corta: l'ultima cella di quella riga.
    const short = at("\\begin{pmatrix} a & b| \\\\ c \\end{pmatrix}");
    expect(result(short, cellEnter(short)!)).toBe("\\begin{pmatrix} a & b \\\\ c |\\end{pmatrix}");
  });

  it("Invio in un allineamento, o fuori da una tabella, resta quello di sempre", () => {
    expect(cellEnter(at("\\begin{aligned} a &= b| \\end{aligned}"))).toBeNull();
    expect(cellEnter(at("a+b|"))).toBeNull();
    // In una matrice dentro una cella conta la matrice più interna.
    const nested = at("\\begin{pmatrix} \\begin{matrix} x| & y \\end{matrix} & b \\end{pmatrix}");
    expect(result(nested, tab(nested, false))).toBe("\\begin{pmatrix} \\begin{matrix} x & y |\\end{matrix} & b \\end{pmatrix}");
  });
});
