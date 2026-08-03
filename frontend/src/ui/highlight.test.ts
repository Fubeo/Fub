// @vitest-environment happy-dom
//
// L'evidenziazione di un estratto era una funzione privata di un pannello,
// cioè una cosa che si provava solo aprendo l'app. Adesso che due superfici la
// usano (§21.4) ha un banco, e i casi sono quelli su cui una seconda scrittura
// sarebbe divergente: gli accenti (byte ≠ code unit) e gli intervalli che un
// provider può mandare sbagliati.
import { describe, expect, it } from "vitest";
import { evidenziato } from "./highlight";

/// Cosa si vede: il testo intero, e quali porzioni sono dentro un `<mark>`.
function letto(frag: DocumentFragment): { testo: string; marcato: string[] } {
  const box = document.createElement("div");
  box.appendChild(frag);
  return {
    testo: box.textContent ?? "",
    marcato: [...box.querySelectorAll("mark")].map((m) => m.textContent ?? ""),
  };
}

describe("l'estratto evidenziato", () => {
  it("taglia sui byte, non sui code unit", () => {
    // «però» sta a byte 0..5 e non 0..4, perché la `ò` ne occupa due: con gli
    // indici JS il `<mark>` finirebbe un carattere prima, cioè su «per».
    const frag = evidenziato("però conta", [{ start: 0, end: 5 }]);
    expect(letto(frag)).toEqual({ testo: "però conta", marcato: ["però"] });
  });

  it("il testo del provider non diventa mai markup", () => {
    const frag = evidenziato("<b>ciao</b>", [{ start: 3, end: 7 }]);
    const box = document.createElement("div");
    box.appendChild(frag);
    // Il testo si legge tutto, e di elementi c'è solo il `mark` che mettiamo noi.
    expect(box.textContent).toBe("<b>ciao</b>");
    expect([...box.children].map((e) => e.tagName)).toEqual(["MARK"]);
  });

  it("scarta gli intervalli impossibili invece di rompersi", () => {
    const casi = [
      { start: 5, end: 2 }, // torna indietro
      { start: 0, end: 0 }, // vuoto
      { start: 2, end: 999 }, // esce dall'estratto
    ];
    for (const span of casi) {
      expect(letto(evidenziato("abcde", [span]))).toEqual({ testo: "abcde", marcato: [] });
    }
  });

  it("due porzioni in fila, col testo in mezzo", () => {
    const frag = evidenziato("uno due tre", [
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ]);
    expect(letto(frag)).toEqual({ testo: "uno due tre", marcato: ["uno", "tre"] });
  });

  it("un intervallo che comincia dentro il precedente si scarta", () => {
    // Due `<mark>` sovrapposti taglierebbero il testo due volte, e ciò che sta
    // in mezzo sparirebbe: meglio perdere un'evidenziazione che una parola.
    const frag = evidenziato("uno due", [
      { start: 0, end: 5 },
      { start: 3, end: 7 },
    ]);
    expect(letto(frag)).toEqual({ testo: "uno due", marcato: ["uno d"] });
  });
});
