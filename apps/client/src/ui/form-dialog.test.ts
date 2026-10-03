// @vitest-environment happy-dom
// Le due finestre di `form-dialog.ts`: più campi in una domanda, e l'elenco
// dei tasti.

import { afterEach, describe, expect, it } from "vitest";
import { checkAccessibility, formatIssues } from "./a11y-check";
import { promptForm, showKeys } from "./form-dialog";

const dialog = (): HTMLElement => {
  const open = document.querySelectorAll<HTMLElement>(".modale");
  return open[open.length - 1]!;
};
const field = (name: string): HTMLInputElement | HTMLTextAreaElement => dialog().querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
const escape = (): void => {
  dialog().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
};

afterEach(() => {
  // Le finestre chiuse escono con un'animazione, che happy-dom non finisce.
  for (const modal of document.querySelectorAll(".modale")) modal.remove();
});

describe("promptForm", () => {
  const ask = (): Promise<Readonly<Record<string, string>> | null> =>
    promptForm({
      title: "Posizione e misure",
      fields: [
        { id: "x", label: "X", value: "10", kind: "number" },
        { id: "w", label: "Larghezza", value: "0", kind: "number", min: 0.01, disabled: true },
        { id: "h", label: "Altezza", value: "20", kind: "number", min: 0.01 },
        { id: "note", label: "Nota", value: "", kind: "multiline" },
      ],
    });

  it("mette ogni campo con la sua etichetta, e il fuoco sul primo", () => {
    void ask();
    expect(dialog().getAttribute("role")).toBe("dialog");
    expect(dialog().querySelector("h2")!.textContent).toBe("Posizione e misure");
    const x = field("x") as HTMLInputElement;
    expect(x.type).toBe("number");
    expect(x.inputMode).toBe("decimal");
    expect(x.closest("label")!.textContent).toBe("X");
    expect(field("w").disabled).toBe(true);
    expect((field("h") as HTMLInputElement).min).toBe("0.01");
    expect(field("note").tagName).toBe("TEXTAREA");
    expect(document.activeElement).toBe(x);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    escape();
  });

  it("conferma coi valori per id, e annulla con null", async () => {
    let answer = ask();
    field("x").value = "12.5";
    field("note").value = "due\nrighe";
    dialog().querySelector("form")!.requestSubmit();
    expect(await answer).toEqual({ x: "12.5", w: "0", h: "20", note: "due\nrighe" });
    answer = ask();
    escape();
    expect(await answer).toBeNull();
  });

  it("un numero sotto il minimo non conferma", async () => {
    const answer = ask();
    field("h").value = "0";
    dialog().querySelector("form")!.requestSubmit();
    // La finestra resta aperta: la risposta è quella del secondo invio.
    field("h").value = "3";
    dialog().querySelector("form")!.requestSubmit();
    expect((await answer)?.h).toBe("3");
  });
});

describe("showKeys", () => {
  it("una tabella per gruppo, coi tasti come si premono e le alternative", async () => {
    const closed = showKeys("Tasti del disegno", [
      { title: "Modifica", rows: [["Mod-z", "Annulla"], ["Mod-Shift-z Mod-y", "Ripeti"]] },
      { title: "Oggetti", rows: [["Escape", "Toglie la selezione"], ["←↑→↓", "Sposta"], ["Space", "Preme"]] },
    ]);
    const tables = [...dialog().querySelectorAll("table")];
    expect(tables.map((table) => table.querySelector("caption")!.textContent)).toEqual(["Modifica", "Oggetti"]);
    const rows = [...dialog().querySelectorAll("tr")].map((row) => [...row.querySelectorAll("kbd")].map((kbd) => kbd.textContent));
    expect(rows).toEqual([["Ctrl+Z"], ["Ctrl+Shift+Z", "Ctrl+Y"], ["Esc"], ["←↑→↓"], ["Space"]]);
    expect(dialog().querySelector("tr th")!.getAttribute("scope")).toBe("row");
    const list = dialog().querySelector<HTMLElement>(".keys-list")!;
    expect(list.tabIndex).toBe(0);
    expect(list.getAttribute("role")).toBe("region");
    expect(document.activeElement?.textContent).toBe("Chiudi");
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    (document.activeElement as HTMLButtonElement).click();
    await closed;
  });
});
