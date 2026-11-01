// Gli stili del documento: come si leggono, i nomi, e le operazioni che li
// fanno, li danno, li aggiornano, tornano allo stile, scollegano e li
// tolgono, che il motore accetta così come sono e che un annulla disfa al
// byte.

import { describe, expect, it } from "vitest";
import { styleNameProblem, type DocumentStyle } from "./styles";


describe("i nomi", () => {
  const list: DocumentStyle[] = [
    { id: "r1", name: "Titolo", kind: "text", node: null!, followers: 0 },
    { id: "r2", name: "Stile grafico 1", kind: "graphic", node: null!, followers: 0 },
  ];

  it("sono di un tipo: uno stile di testo e uno grafico possono chiamarsi uguali", () => {
    expect(styleNameProblem(list, "text", "titolo")).toBe("taken");
    expect(styleNameProblem(list, "graphic", "Titolo")).toBeNull();
    expect(styleNameProblem(list, "text", "Titolo", "r1")).toBeNull();
    expect(styleNameProblem(list, "text", "")).toBe("empty");
    expect(styleNameProblem(list, "text", "#ff0000")).toBe("color");
  });

});
