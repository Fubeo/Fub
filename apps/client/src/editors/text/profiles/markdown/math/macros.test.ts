// Le macro del vault (T65): la nota si legge con KaTeX vero; una macro rotta o
// che si chiama da sola si salta e lo si dice, le altre restano, e nessuna
// formula si blocca.
import katex from "katex";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readOptions, setPreamble } from "../math";
import { compileMacros, declarations, MACRO_NOTE, MAX_MACRO_TEXT, MAX_MACROS, problemsText, stopVaultMacros, watchVaultMacros } from "./macros";

const host = vi.hoisted(() => ({ read: vi.fn(), notify: vi.fn() }));
vi.mock("../../../../../host/ipc", () => ({ api: { readDocument: host.read } }));
vi.mock("../../../../../ui/notify", () => ({ notify: host.notify }));

afterEach(() => {
  stopVaultMacros();
  setPreamble({});
  host.read.mockReset();
  host.notify.mockReset();
});

const render = (tex: string) => katex.renderToString(tex, readOptions(false, tex));

describe("le dichiarazioni della nota", () => {
  it("trova le forme di LaTeX, coi loro argomenti, e la riga", () => {
    const text = [
      "# Macro",
      "",
      "$$",
      "\\newcommand{\\R}{\\mathbb{R}}",
      "\\newcommand\\vect[1]{\\mathbf{#1}}",
      "\\renewcommand{\\phi}{\\varphi}",
      "\\DeclareMathOperator{\\sgn}{sgn}",
      "\\def\\sq#1{#1^2}",
      "\\let\\eps\\varepsilon",
      "$$",
      "Testo con \\\\newcommand che non conta.",
    ].join("\n");
    const found = declarations(text);
    expect(found.map((item) => item.name)).toEqual(["\\R", "\\vect", "\\phi", "\\sgn", "\\sq", "\\eps"]);
    expect(found[0]!.line).toBe(4);
    expect(found[3]!.source).toBe("\\newcommand{\\sgn}{\\operatorname{sgn}}");
  });

  it("una dichiarazione a metà si segna rotta, con la sua riga", () => {
    const found = declarations("ok\n\\newcommand{\\a}{\\frac{1}\n");
    expect(found).toEqual([{ source: "", name: "", line: 2 }]);
  });
});

describe("le macro lette da KaTeX", () => {
  it("valgono come premessa di ogni formula, anche un nome che KaTeX ha già", () => {
    const { macros, problems } = compileMacros(katex, "\\newcommand{\\R}{\\mathbf{R}}\n\\newcommand{\\vect}[1]{\\vec{#1}}\n\\DeclareMathOperator*{\\argmax}{arg\\,max}");
    expect(problems).toEqual([]);
    setPreamble(macros);
    expect(render("\\vect{v} \\in \\R^n")).toContain("mathbf");
    expect(() => render("\\argmax_x f")).not.toThrow();
  });

  it("una macro che si chiama da sola si salta, le altre restano, e la formula non si blocca", () => {
    const { macros, problems } = compileMacros(katex, "\\newcommand{\\a}{\\a}\n\\newcommand{\\pp}{\\qq}\n\\newcommand{\\qq}{\\pp}\n\\newcommand{\\ok}{1}");
    expect(problems).toEqual([{ kind: "loop", name: "\\a" }, { kind: "loop", name: "\\qq" }]);
    expect(Object.keys(macros).sort()).toEqual(["\\ok", "\\pp"]);
    setPreamble(macros);
    expect(() => render("\\ok")).not.toThrow();
    // `\pp` resta, ma senza `\qq` non si legge: la formula dice che cosa non va.
    expect(() => render("\\pp")).toThrow(/Undefined control sequence/);
  });

  it("la prima che si chiama da sola è quella segnalata", () => {
    const { problems } = compileMacros(katex, "\\newcommand{\\a}{\\a}");
    expect(problems).toEqual([{ kind: "loop", name: "\\a" }]);
  });

  it("una macro che non si legge si salta e non lascia mezza definizione", () => {
    const { macros, problems } = compileMacros(katex, "\\newcommand{\\opt}[2][a]{#1+#2}\n\\newcommand{\\ok}{2}\n\\newcommand{\\bad}{\\frac{a}");
    expect(problems).toEqual([{ kind: "broken", name: "\\opt", line: 1 }, { kind: "broken", name: "", line: 3 }]);
    expect(Object.keys(macros)).toEqual(["\\ok"]);
  });

  it("una nota troppo grande si ignora, troppe macro si tagliano", () => {
    expect(compileMacros(katex, "x".repeat(MAX_MACRO_TEXT + 1))).toEqual({ macros: {}, problems: [{ kind: "too_large", limit: MAX_MACRO_TEXT }] });
    const many = Array.from({ length: MAX_MACROS + 5 }, (_, index) => `\\newcommand{\\m${"abcdefghij"[index % 10]}${String.fromCharCode(97 + Math.floor(index / 10) % 26)}${String.fromCharCode(97 + Math.floor(index / 260))}}{${index}}`).join("\n");
    const { macros, problems } = compileMacros(katex, many);
    expect(problems).toEqual([{ kind: "too_many", limit: MAX_MACROS }]);
    expect(Object.keys(macros)).toHaveLength(MAX_MACROS);
  });

  it("una formula che dichiara da sé un nome della premessa resta sua", () => {
    setPreamble(compileMacros(katex, "\\newcommand{\\vv}{1}").macros);
    expect(() => render("\\newcommand{\\vv}{2}\\vv")).not.toThrow();
    expect(render("\\vv")).toContain(">1<");
  });

  it("un \\gdef in una formula non cambia la premessa per le altre", () => {
    setPreamble(compileMacros(katex, "\\newcommand{\\k}{1}").macros);
    render("\\gdef\\k{2}\\k");
    expect(render("\\k")).toContain(">1<");
  });

  it("le frasi: la prima, e quante altre", () => {
    expect(problemsText([])).toBeNull();
    const text = problemsText([{ kind: "loop", name: "\\a" }, { kind: "broken", name: "\\b", line: 3 }])!;
    expect(text).toContain("\\a");
    expect(text).toContain("Formule/Macro.md");
    expect(text).toMatch(/1/);
  });
});

describe("la nota delle macro nel vault", () => {
  it("si legge, e le sue macro valgono per ogni formula", async () => {
    host.read.mockResolvedValue({ text: "\\newcommand{\\RR}{\\mathbb{R}}" });
    await watchVaultMacros(katex);
    expect(host.read).toHaveBeenCalledWith(MACRO_NOTE);
    expect(() => render("x \\in \\RR")).not.toThrow();
    expect(host.notify).not.toHaveBeenCalled();
  });

  it("una nota che non c'è non dice niente", async () => {
    host.read.mockRejectedValue({ kind: "not_found", message: "non c'è" });
    await watchVaultMacros(katex);
    expect(host.notify).not.toHaveBeenCalled();
    expect(readOptions(false).macros).toBeUndefined();
  });

  it("una nota illeggibile si ignora e lo si dice, una volta", async () => {
    host.read.mockRejectedValue({ kind: "io", message: "disco guasto" });
    await watchVaultMacros(katex);
    expect(host.notify).toHaveBeenCalledTimes(1);
    expect(host.notify.mock.calls[0]![0]).toContain("disco guasto");
    expect(host.notify.mock.calls[0]![1]).toBe("guasto");
    await watchVaultMacros(katex);
    expect(host.notify).toHaveBeenCalledTimes(1);
    expect(() => render("x^2")).not.toThrow();
  });

  it("una macro che si chiama da sola lo dice, e la nota non si blocca", async () => {
    host.read.mockResolvedValue({ text: "\\newcommand{\\loopy}{\\loopy}\n\\newcommand{\\one}{1}" });
    await watchVaultMacros(katex);
    expect(host.notify).toHaveBeenCalledTimes(1);
    expect(host.notify.mock.calls[0]![0]).toContain("\\loopy");
    expect(render("\\one")).toContain(">1<");
    expect(() => render("\\loopy")).toThrow(/Undefined control sequence/);
  });
});
