// @vitest-environment happy-dom
// La finestra «Guide»: le guide coi numeri, nell'unità del documento.

import { afterEach, describe, expect, it } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import type { RulerGuide } from "../scene/rulers";
import { guideDialog, unitSuffix } from "./guide-dialog";

const dialog = (): HTMLElement => {
  const open = document.querySelectorAll<HTMLElement>(".modale");
  return open[open.length - 1]!;
};
const rows = (): HTMLTableRowElement[] => [...dialog().querySelectorAll<HTMLTableRowElement>("tbody tr")];
const positions = (): HTMLInputElement[] => rows().map((row) => row.querySelector<HTMLInputElement>('input[type="number"]')!);
const button = (label: string): HTMLButtonElement =>
  [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((each) => each.textContent === label || each.getAttribute("aria-label") === label)!;
const submit = (): void => dialog().querySelector("form")!.requestSubmit();
const type = (input: HTMLInputElement, value: string): void => {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const GUIDES: readonly RulerGuide[] = [
  { axis: "x", at: 100, locked: false },
  { axis: "y", at: 37.795275590551185, locked: true },
];

afterEach(() => {
  // Le finestre chiuse escono con un'animazione, che happy-dom non finisce.
  for (const modal of document.querySelectorAll(".modale")) modal.remove();
});

describe("guideDialog", () => {
  it("mette una riga per guida, coi campi nominati dal numero e dalla direzione, e il fuoco sulla prima", () => {
    void guideDialog({ guides: GUIDES, unit: "mm", center: [0, 0] });
    expect(dialog().querySelector("h2")!.textContent).toBe("Guide");
    const heads = [...dialog().querySelectorAll("thead th")].map((cell) => cell.textContent);
    expect(heads).toEqual(["Direzione", "Posizione (mm)", "Bloccata", "Elimina la guida"]);
    expect(rows()).toHaveLength(2);
    const [first, second] = positions();
    expect(first!.value).toBe("26.458");
    expect(second!.value).toBe("10");
    expect(first!.getAttribute("aria-label")).toBe("Posizione della guida 1, verticale");
    expect(second!.getAttribute("aria-label")).toBe("Posizione della guida 2, orizzontale");
    expect(rows()[1]!.querySelector("select")!.value).toBe("y");
    expect(rows()[1]!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
    expect(button("Elimina la guida 2, orizzontale")).toBeDefined();
    expect(document.activeElement).toBe(first);
    expect(dialog().querySelector(".draw-guides-message")!.textContent).toMatch(/zero dei righelli/);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
  });

  it("le posizioni non toccate restano esatte; quelle scritte passano dall'unità alla scena", async () => {
    const answer = guideDialog({ guides: GUIDES, unit: "mm", center: [0, 0] });
    type(positions()[0]!, "30");
    const lock = rows()[0]!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    lock.checked = true;
    submit();
    expect(await answer).toEqual([
      { axis: "x", at: 113.39, locked: true },
      { axis: "y", at: 37.795275590551185, locked: true },
    ]);
  });

  it("cambia la direzione di una guida, e il nome dei suoi campi la segue", async () => {
    const answer = guideDialog({ guides: GUIDES, unit: "px", center: [0, 0] });
    expect(dialog().querySelector("thead th:nth-child(2)")!.textContent).toBe("Posizione");
    const axis = rows()[0]!.querySelector("select")!;
    axis.value = "y";
    axis.dispatchEvent(new Event("change", { bubbles: true }));
    expect(positions()[0]!.getAttribute("aria-label")).toBe("Posizione della guida 1, orizzontale");
    submit();
    expect((await answer)![0]).toEqual({ axis: "y", at: 100, locked: false });
  });

  it("aggiunge una guida al centro della vista, a un numero tondo dell'unità, col fuoco sul suo campo", async () => {
    const answer = guideDialog({ guides: [], unit: "cm", center: [123.4, 567.8] });
    expect(dialog().querySelector(".draw-guides-message")!.textContent).toBe("Il documento non ha guide. Aggiungine una qui, o tirala da un righello.");
    expect(dialog().querySelector<HTMLElement>(".draw-guides-scroll")!.hidden).toBe(true);
    expect(button("Elimina tutte le guide").disabled).toBe(true);
    expect(document.activeElement).toBe(button("Aggiungi una verticale"));
    button("Aggiungi una verticale").click();
    button("Aggiungi un’orizzontale").click();
    expect(rows()).toHaveLength(2);
    expect(positions().map((input) => input.value)).toEqual(["3.26", "15.02"]);
    expect(document.activeElement).toBe(positions()[1]);
    expect(dialog().querySelector<HTMLElement>(".draw-guides-scroll")!.hidden).toBe(false);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    submit();
    const written = (await answer)!;
    expect(written.map((guide) => guide.axis)).toEqual(["x", "y"]);
    expect(written[0]!.at).toBe(123.21);
    expect(written[1]!.at).toBe(567.69);
  });

  it("eliminata una riga, il fuoco va a quella che ne prende il posto, poi a quella prima, poi alle guide nuove", async () => {
    const answer = guideDialog({ guides: [...GUIDES, { axis: "x", at: 5, locked: false }], unit: "px", center: [0, 0] });
    button("Elimina la guida 2, orizzontale").click();
    expect(rows()).toHaveLength(2);
    // La terza è diventata la seconda, e il suo nome lo dice.
    expect(document.activeElement).toBe(button("Elimina la guida 2, verticale"));
    button("Elimina la guida 2, verticale").click();
    expect(document.activeElement).toBe(button("Elimina la guida 1, verticale"));
    button("Elimina la guida 1, verticale").click();
    expect(document.activeElement).toBe(button("Aggiungi una verticale"));
    submit();
    expect(await answer).toEqual([]);
  });

  it("«Elimina tutte le guide» svuota la tabella; annullare non cambia niente", async () => {
    const answer = guideDialog({ guides: GUIDES, unit: "px", center: [0, 0] });
    button("Elimina tutte le guide").click();
    expect(rows()).toHaveLength(0);
    button("Annulla").click();
    expect(await answer).toBeNull();
  });

  it("una posizione vuota non conferma, e lo dice col numero della guida", async () => {
    let settled = false;
    const answer = guideDialog({ guides: GUIDES, unit: "px", center: [0, 0] }).then((value) => {
      settled = true;
      return value;
    });
    type(positions()[1]!, "");
    submit();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(positions()[1]!.validationMessage).toBe("Scrivi la posizione della guida 2 come numero.");
    type(positions()[1]!, "-12.346");
    submit();
    expect((await answer)![1]).toEqual({ axis: "y", at: -12.35, locked: true });
  });

  it("le guide che non si leggono partono vuote, e la finestra lo dice", () => {
    void guideDialog({ guides: null, unit: "px", center: [0, 0] });
    expect(rows()).toHaveLength(0);
    expect(dialog().querySelector(".draw-guides-message")!.textContent).toMatch(/non si leggono/);
    expect(dialog().getAttribute("aria-describedby")).toBe(dialog().querySelector(".draw-guides-message")!.id);
  });

  it("parte dalla guida chiesta", () => {
    void guideDialog({ guides: GUIDES, unit: "in", center: [0, 0], focus: 1 });
    expect(document.activeElement).toBe(positions()[1]);
    expect(positions()[1]!.value).toBe("0.3937");
  });

  it("la sigla dell'unità accanto a un nome, tranne i pixel", () => {
    expect(unitSuffix("X", "px")).toBe("X");
    expect(unitSuffix("X", "pt")).toBe("X (pt)");
  });
});
