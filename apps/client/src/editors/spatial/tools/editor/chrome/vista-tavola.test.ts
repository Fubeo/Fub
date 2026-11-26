// @vitest-environment happy-dom
// «Vai alla tavola da disegno» (`view.goToArtboard`, VectorCraft: Go to Artboard): il dialogo parte
// dalla tavola di adesso, Vai rende quella scelta, Annulla ed Esc non rendono niente.
import { afterEach, describe, expect, it } from "vitest";
import { chiediTavola } from "./vista-tavola";

const finestra = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const elenco = () => finestra().querySelector<HTMLSelectElement>("select")!;

afterEach(() => {
  document.body.replaceChildren();
});

describe("view.goToArtboard: il dialogo", () => {
  it("elenca le tavole numerate e parte da quella di adesso", async () => {
    const attesa = chiediTavola(["Copertina", "Retro", "Interno"], 1);
    expect([...elenco().options].map((o) => o.textContent)).toEqual(["1. Copertina", "2. Retro", "3. Interno"]);
    expect(elenco().value).toBe("1");
    finestra().querySelector<HTMLButtonElement>('[data-action="apply"]')!.click();
    expect(await attesa).toBe(1);
  });

  it("Vai rende la tavola scelta", async () => {
    const attesa = chiediTavola(["A", "B", "C"], 0);
    elenco().value = "2";
    finestra().querySelector<HTMLButtonElement>('[data-action="apply"]')!.click();
    expect(await attesa).toBe(2);
  });

  it("Annulla ed Esc non rendono niente", async () => {
    const prima = chiediTavola(["A", "B"], 0);
    finestra().querySelector<HTMLButtonElement>('[data-action="cancel"]')!.click();
    expect(await prima).toBeNull();
    const dopo = chiediTavola(["A", "B"], 0);
    elenco().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(await dopo).toBeNull();
  });

  it("un posto fuori dall'elenco parte dalla tavola più vicina", async () => {
    const attesa = chiediTavola(["A", "B"], 7);
    expect(elenco().value).toBe("1");
    finestra().querySelector<HTMLButtonElement>('[data-action="cancel"]')!.click();
    await attesa;
  });
});
