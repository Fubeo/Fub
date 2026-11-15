import { describe, expect, it } from "vitest";
import { calloutTypeContext, codeLanguageContext, cursorIsLiteral, slashContext, slashPlacement, SLASH_GAP, SLASH_MIN_HEIGHT, SLASH_QUERY_MAX } from "./slash";

describe("dove si apre il «/» nel testo", () => {
  it("a inizio riga o dopo uno spazio, con ciò che si scrive dopo", () => {
    expect(slashContext("/")).toEqual({ from: 0, query: "" });
    expect(slashContext("/tit")).toEqual({ from: 0, query: "tit" });
    expect(slashContext("Una riga /h2")).toEqual({ from: 9, query: "h2" });
    expect(slashContext("/titolo 2")).toEqual({ from: 0, query: "titolo 2" });
  });

  it("dentro una parola, in un URL o in una data resta testo", () => {
    expect(slashContext("e/o")).toBeNull();
    expect(slashContext("24/09")).toBeNull();
    expect(slashContext("https://fub.app/")).toBeNull();
    expect(slashContext("km/h")).toBeNull();
  });

  it("si chiude con uno spazio subito dopo, con due spazi, con un altro «/» o oltre il tetto", () => {
    expect(slashContext("/ ")).toBeNull();
    expect(slashContext("/titolo  ")).toBeNull();
    expect(slashContext("/a/b")).toBeNull();
    expect(slashContext(`/${"a".repeat(SLASH_QUERY_MAX)}`)).not.toBeNull();
    expect(slashContext(`/${"a".repeat(SLASH_QUERY_MAX + 1)}`)).toBeNull();
  });

  it("nel codice, nei link e in un wikilink aperto è letterale", () => {
    expect(cursorIsLiteral({ nodes: ["InlineCode", "Paragraph"], lineBefore: "`a " })).toBe(true);
    expect(cursorIsLiteral({ nodes: ["Paragraph"], lineBefore: "vedi [[Nota " })).toBe(true);
    expect(cursorIsLiteral({ nodes: ["Paragraph"], lineBefore: "vedi [[Nota]] " })).toBe(false);
  });
});

describe("i completamenti che una voce riapre", () => {
  it("il tipo di un callout, fra `[!` e `]`", () => {
    expect(calloutTypeContext("> [!", "]")).toEqual({ from: 4, query: "" });
    expect(calloutTypeContext("> [!war", "]")).toEqual({ from: 4, query: "war" });
    expect(calloutTypeContext("Testo [!", "]")).toBeNull();
  });

  it("il linguaggio sulla riga d'apertura di un recinto, con niente dopo", () => {
    expect(codeLanguageContext("```", "")).toEqual({ from: 3, query: "" });
    expect(codeLanguageContext("> ~~~py", "")).toEqual({ from: 5, query: "py" });
    expect(codeLanguageContext("```js", " x")).toBeNull();
    expect(codeLanguageContext("``", "")).toBeNull();
  });
});

describe("dove sta il pannello del «/»", () => {
  // L'area del documento va da 154 a 766, come nella finestra del banco: sopra
  // ci sono la barra della finestra, le linguette e la barra degli strumenti.
  const area = { top: 154, bottom: 766 };
  const line = (top: number) => ({ top, bottom: top + 30 });

  it("sotto la riga, alto quanto vuole, se ci sta", () => {
    expect(slashPlacement(line(200), 400, area)).toEqual({ above: false, top: 230 + SLASH_GAP, height: 400 });
  });

  it("sotto la riga accorciato, anche se sopra ci sarebbe più posto", () => {
    // Sotto 766 − 438 = 328 px, sopra 392: resta sotto e scorre dentro.
    const place = slashPlacement(line(400), 400, area);
    expect(place).toEqual({ above: false, top: 430 + SLASH_GAP, height: 766 - 430 - SLASH_GAP });
    expect(place.height).toBeGreaterThanOrEqual(SLASH_MIN_HEIGHT);
  });

  it("sopra soltanto se sotto non c'è neanche l'altezza minima, e mai oltre l'area", () => {
    // La riga vicino al fondo: sotto restano 28 px, sopra c'è l'altezza intera.
    expect(slashPlacement(line(700), 400, area)).toEqual({ above: true, top: 700 - SLASH_GAP - 400, height: 400 });
    // Sotto 168 px, sopra 398: si apre sopra, accorciato, e si ferma al bordo
    // alto dell'area, mai sopra la testata o le barre.
    const place = slashPlacement(line(560), 400, area);
    expect(place).toEqual({ above: true, top: area.top, height: 560 - SLASH_GAP - area.top });
  });

  it("sopra con tutta l'altezza quando c'è, attaccato alla riga", () => {
    const tall = { top: 0, bottom: 1000 };
    expect(slashPlacement(line(900), 400, tall)).toEqual({ above: true, top: 900 - SLASH_GAP - 400, height: 400 });
  });

  it("senza il minimo da nessuna parte prende il lato più alto e ci sta dentro", () => {
    const small = { top: 154, bottom: 400 };
    const low = slashPlacement(line(330), 400, small);
    expect(low).toEqual({ above: true, top: small.top, height: 330 - SLASH_GAP - small.top });
    const high = slashPlacement(line(160), 400, small);
    expect(high).toEqual({ above: false, top: 190 + SLASH_GAP, height: 400 - 190 - SLASH_GAP });
  });

  it("un pannello più basso del minimo non si apre sopra per questo", () => {
    // Un passo corto (120 px) sta sotto anche se il minimo non c'è.
    expect(slashPlacement(line(600), 120, area)).toEqual({ above: false, top: 630 + SLASH_GAP, height: 120 });
  });
});
