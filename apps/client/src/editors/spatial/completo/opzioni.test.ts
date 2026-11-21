// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { costruisciFila, descrivi, type Etichette } from "./opzioni";

const ETICHETTE: Etichette = {
  angolo: { it: "Angolo", en: "Corner" },
  spessore: { it: "Spessore", en: "Width" },
  attivo: { it: "Attivo", en: "On" },
  tinta: { it: "Tinta", en: "Ink" },
  punta: { it: "Punta", en: "Tip" },
};

describe("le opzioni dello strumento come controlli", () => {
  it("un sì o no, un numero, un colore e una scelta diventano controlli del loro tipo", () => {
    const { controlli, fuori } = descrivi(
      { attivo: true, spessore: 2.5, tinta: "#00ff7f", punta: { scelta: "tonda", scelte: ["tonda", "quadra"] } },
      ETICHETTE,
    );
    expect(fuori).toEqual([]);
    expect(controlli.map((c) => c.tipo)).toEqual(["casella", "numero", "colore", "scelta"]);
  });

  it("una forma che il disegno generico non sa fare non si mostra, e lo dice", () => {
    const { controlli, fuori } = descrivi({ angolo: { gradi: 3 }, punta: { scelta: "x", scelte: ["tonda"] } }, ETICHETTE);
    expect(controlli).toEqual([]);
    expect(fuori).toEqual([
      { chiave: "angolo", perche: "forma" },
      { chiave: "punta", perche: "forma" },
    ]);
  });

  it("una chiave senza etichetta non si mostra, mai con l'id grezzo", () => {
    const { controlli, fuori } = descrivi({ sconosciuta: true }, ETICHETTE);
    expect(controlli).toEqual([]);
    expect(fuori).toEqual([{ chiave: "sconosciuta", perche: "etichetta" }]);
  });

  it("senza opzioni, o con un valore che non è un oggetto, non c'è niente", () => {
    expect(descrivi(null, ETICHETTE)).toEqual({ controlli: [], fuori: [] });
    expect(descrivi([1, 2], ETICHETTE)).toEqual({ controlli: [], fuori: [] });
    expect(descrivi("x", ETICHETTE)).toEqual({ controlli: [], fuori: [] });
  });

  it("ogni controllo ha la sua etichetta, e il cambio manda la chiave e il valore nuovo", () => {
    const { controlli, fuori } = descrivi({ attivo: false, spessore: 2 }, ETICHETTE);
    expect(fuori).toEqual([]);
    const cambia = vi.fn();
    const fila = costruisciFila({ controlli, fuori }, (chiave) => ETICHETTE[chiave]!.it, cambia);
    const etichette = [...fila.querySelectorAll(".draw-option-label")].map((nodo) => nodo.textContent);
    expect(etichette).toEqual(["Attivo", "Spessore"]);
    const casella = fila.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    casella.checked = true;
    casella.dispatchEvent(new Event("change"));
    expect(cambia).toHaveBeenLastCalledWith("attivo", true);
    const numero = fila.querySelector<HTMLInputElement>("input[type=number]")!;
    numero.value = "4";
    numero.dispatchEvent(new Event("change"));
    expect(cambia).toHaveBeenLastCalledWith("spessore", 4);
  });
});
