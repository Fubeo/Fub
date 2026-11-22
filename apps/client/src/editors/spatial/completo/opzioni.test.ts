// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { costruisciFila, descrivi, type Etichette } from "./opzioni";

const ETICHETTE: Etichette = {
  angolo: { it: "Angolo", en: "Corner" },
  spessore: { it: "Spessore", en: "Width" },
  attivo: { it: "Attivo", en: "On" },
  tinta: { it: "Tinta", en: "Ink" },
  punta: { it: "Punta", en: "Tip" },
};

const vite: Lifetime[] = [];
afterEach(() => {
  for (const life of vite.splice(0)) life.close();
});
function vita(): Lifetime {
  const life = openLifetime();
  vite.push(life);
  return life;
}

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
});

describe("la fila dello strumento, con i controlli del kit", () => {
  it("senza controlli da mostrare non c'è fila: niente fila vuota", () => {
    expect(costruisciFila(ETICHETTE, null, vi.fn(), vita())).toBeNull();
    expect(costruisciFila(ETICHETTE, { angolo: { gradi: 3 } }, vi.fn(), vita())).toBeNull();
  });

  it("ogni controllo è del kit, con la sua etichetta, e il cambio manda la chiave e il valore nuovo", () => {
    const cambia = vi.fn();
    const fila = costruisciFila(ETICHETTE, { attivo: false, spessore: 2 }, cambia, vita())!;
    expect(fila.element.className).toBe("draw-options-row");
    expect(fila.element.querySelectorAll(".draw-option")).toHaveLength(2);
    // Il controllo è del kit (la casella e il campo numerico), non quello nativo della regola vecchia.
    expect(fila.element.querySelector(".kit-form-checkbox")).not.toBeNull();
    expect(fila.element.querySelector(".kit-number-input")).not.toBeNull();
    expect(fila.element.querySelector(".draw-option-label")).toBeNull();
    expect(fila.element.textContent).toContain("Attivo");
    expect(fila.element.textContent).toContain("Spessore");
    const casella = fila.element.querySelector<HTMLInputElement>(".kit-form-checkbox")!;
    casella.checked = true;
    casella.dispatchEvent(new Event("change"));
    expect(cambia).toHaveBeenLastCalledWith("attivo", true);
    const numero = fila.element.querySelector<HTMLInputElement>(".kit-number-input")!;
    numero.value = "4";
    // Il campo del kit prende il valore con Invio (o alla perdita del fuoco).
    numero.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(cambia).toHaveBeenLastCalledWith("spessore", 4);
  });

  it("uno stato nuovo rifà solo il controllo cambiato: gli altri restano lo stesso nodo", () => {
    const fila = costruisciFila(ETICHETTE, { attivo: false, spessore: 2 }, vi.fn(), vita())!;
    const [casella, numero] = [...fila.element.querySelectorAll(".draw-option")];
    expect(fila.aggiorna({ attivo: true, spessore: 2 })).toBe(true);
    // Il numero non è cambiato: lo stesso nodo, con il suo fuoco e il suo cursore.
    expect(fila.element.querySelectorAll(".draw-option")[1]).toBe(numero);
    // La casella è cambiata: il suo controllo è nuovo, col valore nuovo.
    expect(fila.element.querySelectorAll(".draw-option")[0]).not.toBe(casella);
    expect(fila.element.querySelector<HTMLInputElement>(".kit-form-checkbox")!.checked).toBe(true);
  });

  it("un valore che il controllo ha già (cambiato da chi lo usa) non si rifà", () => {
    const fila = costruisciFila(ETICHETTE, { spessore: 2 }, vi.fn(), vita())!;
    const numero = fila.element.querySelector<HTMLInputElement>(".kit-number-input")!;
    numero.value = "5";
    numero.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    const nodoPrima = fila.element.querySelector(".draw-option");
    // Lo stato torna con lo stesso 5: nessun controllo nuovo.
    fila.aggiorna({ spessore: 5 });
    expect(fila.element.querySelector(".draw-option")).toBe(nodoPrima);
  });

  it("uno stato con altre chiavi rifà la fila, e uno senza controlli dice di toglierla", () => {
    const fila = costruisciFila(ETICHETTE, { attivo: true }, vi.fn(), vita())!;
    expect(fila.aggiorna({ spessore: 1 })).toBe(true);
    expect(fila.element.textContent).toContain("Spessore");
    expect(fila.element.textContent).not.toContain("Attivo");
    expect(fila.aggiorna({ angolo: { gradi: 3 } })).toBe(false);
  });

  it("chiusa la vita, la fila non ascolta più: nessun cambio dopo lo smontaggio", () => {
    const life = vita();
    const cambia = vi.fn();
    const fila = costruisciFila(ETICHETTE, { attivo: false }, cambia, life)!;
    const casella = fila.element.querySelector<HTMLInputElement>(".kit-form-checkbox")!;
    life.close();
    casella.checked = true;
    casella.dispatchEvent(new Event("change"));
    expect(cambia).not.toHaveBeenCalled();
  });
});
