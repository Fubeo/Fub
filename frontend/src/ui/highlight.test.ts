// @vitest-environment happy-dom
//
// L'evidenziazione di un estratto era una funzione privata di un pannello,
// cioè una cosa che si provava solo aprendo l'app. Adesso che due superfici la
// usano (§21.4) ha un banco, e i casi sono quelli su cui una seconda scrittura
// sarebbe divergente: gli accenti (byte ≠ code unit) e gli intervalli che un
// provider può mandare sbagliati.
import { describe, expect, it } from "vitest";
import { highlighted } from "./highlight";

/// Cosa si vede: il testo intero, e quali porzioni sono dentro un `<mark>`.
function read(frag: DocumentFragment): { text: string; marked: string[] } {
  const box = document.createElement("div");
  box.appendChild(frag);
  return {
    text: box.textContent ?? "",
    marked: [...box.querySelectorAll("mark")].map((m) => m.textContent ?? ""),
  };
}

describe("l'estratto evidenziato", () => {
  it("taglia sui byte, non sui code unit", () => {
    // «però» sta a byte 0..5 e non 0..4, perché la `ò` ne occupa due: con gli
    // indici JS il `<mark>` finirebbe un carattere prima, cioè su «per».
    const frag = highlighted("però conta", [{ start: 0, end: 5 }]);
    expect(read(frag)).toEqual({ text: "però conta", marked: ["però"] });
  });

  it("il testo del provider non diventa mai markup", () => {
    const frag = highlighted("<b>ciao</b>", [{ start: 3, end: 7 }]);
    const box = document.createElement("div");
    box.appendChild(frag);
    // Il testo si legge tutto, e di elementi c'è solo il `mark` che mettiamo noi.
    expect(box.textContent).toBe("<b>ciao</b>");
    expect([...box.children].map((e) => e.tagName)).toEqual(["MARK"]);
  });

  it("scarta gli intervalli impossibili invece di rompersi", () => {
    const cases = [
      { start: 5, end: 2 }, // torna indietro
      { start: 0, end: 0 }, // vuoto
      { start: 2, end: 999 }, // esce dall'estratto
    ];
    for (const span of cases) {
      expect(read(highlighted("abcde", [span]))).toEqual({ text: "abcde", marked: [] });
    }
  });

  it("due porzioni in fila, col testo in mezzo", () => {
    const frag = highlighted("uno due tre", [
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ]);
    expect(read(frag)).toEqual({ text: "uno due tre", marked: ["uno", "tre"] });
  });

  it("un intervallo che comincia dentro il precedente si scarta", () => {
    // Due `<mark>` sovrapposti taglierebbero il testo due volte, e ciò che sta
    // in mezzo sparirebbe: meglio perdere un'evidenziazione che una parola.
    const frag = highlighted("uno due", [
      { start: 0, end: 5 },
      { start: 3, end: 7 },
    ]);
    expect(read(frag)).toEqual({ text: "uno due", marked: ["uno d"] });
  });
});
