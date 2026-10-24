import { describe, expect, it } from "vitest";
import { IT } from "./catalog";
import { GERGO, gergoIn } from "./gergo";

describe("il gergo del codice", () => {
  it("non arriva nei testi italiani", () => {
    const found = Object.entries(IT).flatMap(([key, text]) =>
      gergoIn(text).map((voce) => `${key}: «${text}» → ${voce.invece}`),
    );
    expect(found).toEqual([]);
  });

  it("ogni voce del glossario si riconosce, e i segnaposto restano fuori", () => {
    expect(gergoIn("Ripristina uno snapshot")).toEqual([GERGO[1]]);
    expect(gergoIn("Rendering del diagramma")).toHaveLength(1);
    expect(gergoIn("Revisione r12 del file")).toHaveLength(1);
    expect(gergoIn("un id per riga (vuoto = tutto il vault)")).toHaveLength(1);
    expect(gergoIn("La vista «{view}» non si apre")).toEqual([]);
    expect(gergoIn("Una recensione, un'anteprima")).toEqual([]);
  });
});
