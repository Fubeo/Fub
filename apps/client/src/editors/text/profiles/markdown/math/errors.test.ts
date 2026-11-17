import katex from "katex";
import { describe, expect, it } from "vitest";
import { readOptions } from "../math";
import { diagnose, explain, problemSentence, type MathDiagnosis } from "./errors";

// Gli errori della formula detti in chiaro (T64, E27), senza DOM. Ogni caso è
// un TeX che KaTeX vero non legge, con le opzioni della nota: la frase che si
// vede, il pulsante della correzione (o nessuno) e il TeX dopo la correzione,
// che KaTeX legge.

/// L'errore che KaTeX dà davvero per `tex`.
function failure(tex: string, display = false): unknown {
  try {
    katex.renderToString(tex, readOptions(display));
  } catch (error) {
    return error;
  }
  throw new Error(`KaTeX legge ${tex}`);
}

const reads = (tex: string) => {
  try {
    katex.renderToString(tex, readOptions(false));
    return true;
  } catch {
    return false;
  }
};

function look(tex: string, language = "it"): { diagnosis: MathDiagnosis; sentence: string; fix: string | null } {
  const diagnosis = diagnose(failure(tex), tex);
  const text = explain(diagnosis, language);
  return { diagnosis, sentence: problemSentence(text), fix: text.fix };
}

/// [TeX, il messaggio di KaTeX che dà, la frase, il pulsante, il TeX dopo].
type Case = readonly [tex: string, katex: RegExp, sentence: string, fix: string | null, after: string | null];

const CASES: readonly Case[] = [
  // Le graffe, prima di tutto, come nel prototipo.
  ["x^{2", /^Expected '}', got 'EOF'/, "Manca una } di chiusura.", "Chiudi", "x^{2}"],
  ["\\frac{a}{b", /^Unexpected end of input in a macro argument, expected '}'/, "Manca una } di chiusura.", "Chiudi", "\\frac{a}{b}"],
  ["\\sqrt{\\frac{a}{b", /expected '}'/, "Mancano 2 } di chiusura.", "Chiudi", "\\sqrt{\\frac{a}{b}}"],
  ["x^{2}}", /^Expected 'EOF', got '}'/, "C'è una } in più.", "Toglila", "x^{2}"],
  ["a}+b}", /^Expected 'EOF', got '}'/, "Ci sono 2 } in più.", "Toglile", "a+b"],
  // I comandi che non ci sono.
  ["\\alfa + 1", /^Undefined control sequence: \\alfa/, "Non conosco \\alfa. Forse volevi \\alpha?", "Usa \\alpha", "\\alpha + 1"],
  ["\\alfa^2 + \\alfa", /^Undefined control sequence/, "Non conosco \\alfa. Forse volevi \\alpha?", "Usa \\alpha", "\\alpha^2 + \\alpha"],
  ["\\infinito", /^Undefined control sequence/, "Non conosco \\infinito. Forse volevi \\infty?", "Usa \\infty", "\\infty"],
  ["\\qzx", /^Undefined control sequence/, "Non conosco \\qzx. Scrivi \\ e le prime lettere per vedere i nomi.", null, null],
  // Esponenti e pedici.
  ["x^2^3", /^Double superscript/, "Due esponenti di fila: metti il primo fra graffe, come {x^2}^3.", null, null],
  ["x_1_2", /^Double subscript/, "Due pedici di fila: metti il primo fra graffe, come {x_1}_2.", null, null],
  ["x^", /^Expected group after '\^'/, "Dopo ^ manca l'esponente.", "Aggiungi lo spazio", "x^{}"],
  ["x_", /^Expected group after '_'/, "Dopo _ manca il pedice.", "Aggiungi lo spazio", "x_{}"],
  ["x^\\sqrt", /^Got function '\\sqrt' with no arguments as superscript/, "\\sqrt in esponente va fra graffe, coi suoi pezzi: ^{\\sqrt{}}.", null, null],
  // Gli argomenti che mancano.
  ["\\sqrt", /^Expected group as argument to '\\sqrt'/, "A \\sqrt manca un pezzo.", "Aggiungi lo spazio", "\\sqrt{}"],
  ["\\frac{a}", /^Unexpected end of input in a macro argument, expected '}'/, "A \\frac manca un pezzo.", "Aggiungi lo spazio", "\\frac{a}{}"],
  ["\\sqrt[3", /expected ']'/, "Manca una ] di chiusura.", "Chiudi", "\\sqrt[3]"],
  // Le parentesi di \left e \right.
  ["\\left( x", /^Expected '\\right', got 'EOF'/, "A \\left( manca il suo \\right).", "Chiudi", "\\left( x\\right)"],
  ["\\left\\{ x", /^Expected '\\right', got 'EOF'/, "A \\left\\{ manca il suo \\right\\}.", "Chiudi", "\\left\\{ x\\right\\}"],
  ["x \\right)", /^Expected 'EOF', got '\\right'/, "Questo \\right non ha il suo \\left.", null, null],
  ["\\left x \\right)", /^Invalid delimiter 'x' after '\\left'/, "Dopo \\left va una parentesi, come (.", null, null],
  ["\\left( x \\right", /^Expected group as argument to '\\right'/, "Dopo \\right va una parentesi, come (.", null, null],
  // Gli ambienti.
  ["\\begin{matrix} a & b", /^Expected & or \\\\ or \\cr or \\end/, "Manca \\end{matrix}, che chiude \\begin{matrix}.", "Chiudi", "\\begin{matrix} a & b \\end{matrix}"],
  ["\\begin{matrix} a \\end{pmatrix}", /^Mismatch/, "\\begin{matrix} si chiude con \\end{pmatrix}.", "Usa \\end{matrix}", "\\begin{matrix} a \\end{matrix}"],
  ["\\begin{foo} a \\end{foo}", /^No such environment: foo/, "Non conosco l'ambiente foo: prova con matrix.", null, null],
  ["a \\end{matrix}", /^Expected 'EOF', got '\\end'/, "Questo \\end non ha il suo \\begin.", null, null],
  ["a & b", /^Expected 'EOF', got '&'/, "Un & sta fuori da una matrice o da un allineamento.", null, null],
  ["\\begin{array}{c} a & b \\end{array}", /Too few columns specified/, "Ci sono più colonne di quelle dichiarate in {array}.", null, null],
  ["\\begin{array}{q} a \\end{array}", /^Unknown column alignment: q/, "Le colonne si allineano con l, c o r.", null, null],
  // I segni che in una formula vogliono la barra rovesciata.
  ["a $ b", /^Can't use function '\$' in math mode/, "In una formula $ si scrive \\$.", "Usa \\$", "a \\$ b"],
  ["# a", /^Expected 'EOF', got '#'/, "In una formula # si scrive \\#.", "Usa \\#", "\\# a"],
  ["50 % di x", /\[commentAtEnd\]/, "In una formula % si scrive \\%.", "Usa \\%", "50 \\% di x"],
  ["\\(x\\)", /^Can't use function '\\\(' in math mode/, "\\( apre o chiude una formula: qui dentro non serve.", "Toglilo", "x"],
  ["\\[ a \\\\[2pt] b \\]", /^Undefined control sequence: \\\[/, "\\[ apre o chiude una formula: qui dentro non serve.", "Toglilo", " a \\\\[2pt] b "],
  // Il testo nella formula.
  ["città", /Accented Unicode text character "à" used in math mode/, "La lettera à in una formula va in un testo: \\text{à}.", "Mettila nel testo", "citt\\text{à}"],
  // Il resto.
  ["\\def\\a{\\a}\\a", /^Too many expansions/, "La formula si ripete senza fine: una macro richiama se stessa.", null, null],
  ["x \\limits", /^Limit controls must follow a math operator/, "\\limits va subito dopo un operatore, come \\sum o \\int.", null, null],
  ["\\hspace{x}", /^Invalid size/, "Qui va una misura, come 1em.", null, null],
  ["a \\over b \\over c", /^only one infix operator per group/, "Due \\over nella stessa parte: usa \\frac{}{}.", null, null],
];

describe("i messaggi noti di KaTeX", () => {
  for (const [tex, message, sentence, fix, after] of CASES) {
    it(`${tex}: «${sentence}»`, () => {
      const error = failure(tex) as { rawMessage?: string };
      // Il messaggio è davvero quello di KaTeX: se una versione nuova lo
      // cambia, il caso lo dice.
      expect(error.rawMessage).toMatch(message);
      const seen = look(tex);
      expect(seen.sentence).toBe(sentence);
      expect(seen.fix).toBe(fix);
      expect(seen.diagnosis.fix?.tex ?? null).toBe(after);
      if (seen.diagnosis.fix) {
        expect(seen.diagnosis.fix.caret).toBeGreaterThanOrEqual(0);
        expect(seen.diagnosis.fix.caret).toBeLessThanOrEqual(seen.diagnosis.fix.tex.length);
      }
    });
  }

  it("ogni correzione, tranne la ] che apre la strada a un pezzo, dà una formula che si legge", () => {
    for (const [tex, , , , after] of CASES) {
      if (after === null || tex === "\\sqrt[3") continue;
      expect(reads(after), `${tex} → ${after}`).toBe(true);
    }
  });

  it("il messaggio grezzo non si vede mai", () => {
    for (const [tex] of CASES) {
      for (const language of ["it", "en"]) {
        const { sentence } = look(tex, language);
        expect(sentence).not.toMatch(/Expected|Undefined|KaTeX|parse error|position|EOF|strict mode/i);
        expect(sentence).toMatch(/[.?]$/);
      }
    }
  });
});

describe("più correzioni, nessuna, un errore che non si spiega", () => {
  it("un comando con più simboli vicini: la frase li elenca, senza pulsante", () => {
    const { diagnosis, sentence, fix } = look("\\s + 1");
    expect(diagnosis.problem.kind).toBe("unknown");
    expect(diagnosis.fix).toBeNull();
    expect(fix).toBeNull();
    expect(sentence).toMatch(/^Non conosco \\s\. Forse volevi \\\w+(, \\\w+)* o \\\w+\?$/);
  });

  it("il comando uguale a parte le maiuscole è l'unica correzione", () => {
    const { sentence, fix, diagnosis } = look("\\Infty");
    expect(sentence).toBe("Non conosco \\Infty. Forse volevi \\infty?");
    expect(fix).toBe("Usa \\infty");
    expect(diagnosis.fix?.tex).toBe("\\infty");
  });

  it("la correzione di un nome non tocca i nomi più lunghi che cominciano così", () => {
    const { diagnosis } = look("\\alfa + \\alfabeto");
    expect(diagnosis.fix?.tex).toBe("\\alpha + \\alfabeto");
  });

  it("un errore che KaTeX non spiega: una frase generica, col punto", () => {
    expect(problemSentence(explain(diagnose(new Error("qualcosa di strano"), "x")))).toBe("C'è qualcosa che non torna nella formula.");
    expect(problemSentence(explain(diagnose("non un errore", "x")))).toBe("C'è qualcosa che non torna nella formula.");
    expect(problemSentence(explain(diagnose(null, "x")))).toBe("C'è qualcosa che non torna nella formula.");
    expect(explain(diagnose(new Error("?"), "x")).fix).toBeNull();
  });

  it("un errore sconosciuto con la posizione mostra il pezzo dove capita", () => {
    const error = { rawMessage: "Qualcosa di nuovo", position: 8, length: 1 };
    const text = explain(diagnose(error, "a + b + \\x + c + d"));
    expect(problemSentence(text)).toBe("Qui c'è qualcosa che non torna: + b + \\x + c +.");
    expect(text.parts.some((part) => "code" in part && part.code === "+ b + \\x + c +")).toBe(true);
  });

  it("i pezzi di TeX sono codice, il resto testo", () => {
    const text = explain(diagnose(failure("\\alfa"), "\\alfa"), "it");
    expect(text.parts).toEqual([
      { text: "Non conosco " },
      { code: "\\alfa" },
      { text: ". Forse volevi " },
      { code: "\\alpha" },
      { text: "?" },
    ]);
  });

  it("i segni che separano il codice non escono dal TeX", () => {
    const tex = "\\a\uE000b";
    const text = explain({ problem: { kind: "unknown", name: tex, guesses: [] }, fix: null }, "it");
    expect(problemSentence(text)).toBe("Non conosco \\ab. Scrivi \\ e le prime lettere per vedere i nomi.");
  });
});

describe("in inglese", () => {
  it("la frase e il pulsante nella lingua di chi guarda", () => {
    expect(look("x^{2", "en")).toMatchObject({ sentence: "A closing } is missing.", fix: "Close" });
    expect(look("\\alfa", "en")).toMatchObject({ sentence: "I don't know \\alfa. Did you mean \\alpha?", fix: "Use \\alpha" });
    expect(look("x^2^3", "en")).toMatchObject({ sentence: "Two exponents in a row: put the first one in braces, like {x^2}^3.", fix: null });
    expect(problemSentence(explain(diagnose(new Error("?"), "x"), "en"))).toBe("Something doesn't add up in the formula.");
  });

  it("più correzioni con la «or» inglese", () => {
    expect(look("\\s", "en").sentence).toMatch(/^I don't know \\s\. Did you mean \\\w+(, \\\w+)*,? or \\\w+\?$/);
  });
});
