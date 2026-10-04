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

  it("un colore ha il codice e, accanto, il selettore del sistema, che si scrivono l'un l'altro", async () => {
    const answer = promptForm({ title: "Colore", fields: [{ id: "c", label: "Codice", value: "#0072b2", kind: "color" }] });
    const code = field("c") as HTMLInputElement;
    const picker = dialog().querySelector<HTMLInputElement>('input[type="color"]')!;
    expect(code.type).toBe("text");
    expect(code.closest("label")!.querySelector(".palette-label")!.textContent).toBe("Codice");
    expect(picker.value).toBe("#0072b2");
    expect(picker.getAttribute("aria-label")).toBe("Selettore dei colori");
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    // Il codice corto vale; uno che non è un codice no, e il selettore resta.
    code.value = "f0A";
    code.dispatchEvent(new Event("input", { bubbles: true }));
    expect(picker.value).toBe("#ff00aa");
    expect(code.checkValidity()).toBe(true);
    code.value = "#12345";
    code.dispatchEvent(new Event("input", { bubbles: true }));
    expect(code.checkValidity()).toBe(false);
    expect(code.validationMessage).toBe("Scrivi un codice di tre o sei cifre esadecimali, come #0072b2.");
    expect(picker.value).toBe("#ff00aa");
    expect(document.getElementById(code.getAttribute("aria-describedby")!)!.textContent).toBe("Un codice come #0072b2");
    picker.value = "#112233";
    picker.dispatchEvent(new Event("input", { bubbles: true }));
    expect(code.value).toBe("#112233");
    dialog().querySelector("form")!.requestSubmit();
    expect(await answer).toEqual({ c: "#112233" });
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

  it("un testo che non si lascia vuoto rifiuta anche i soli spazi, e ha una lunghezza massima", async () => {
    const answer = promptForm({ title: "Rinomina", fields: [{ id: "name", label: "Nome", value: "Sfondo", kind: "text", required: true, maxLength: 80 }] });
    const input = field("name") as HTMLInputElement;
    expect(input.required).toBe(true);
    expect(input.maxLength).toBe(80);
    input.value = "   ";
    dialog().querySelector("form")!.requestSubmit();
    expect(input.validationMessage).toBe("Scrivi qualcosa: i soli spazi non bastano.");
    // Scrivendo, l'errore se ne va: altrimenti fermerebbe l'invio.
    input.value = "Note";
    input.dispatchEvent(new Event("input"));
    expect(input.validationMessage).toBe("");
    dialog().querySelector("form")!.requestSubmit();
    expect(await answer).toEqual({ name: "Note" });
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

  it("«Mostra tutto» aggiunge in fondo i tasti tenuti da parte, con la loro frase, e li toglie", async () => {
    const closed = showKeys("Tasti del disegno", [{ title: "Strumenti", rows: [["v", "Seleziona"]] }], {
      groups: [
        { title: "Strumenti · dal livello Standard", rows: [["h", "Evidenziatore"]] },
        { title: "Griglia · dal livello Standard", rows: [["#", "Mostra la griglia"]] },
      ],
      note: "I tasti qui sotto valgono da un livello più alto.",
    });
    const toggle = dialog().querySelector<HTMLButtonElement>(".keys-show-all")!;
    const extra = dialog().querySelector<HTMLElement>(".keys-more")!;
    expect(toggle.textContent).toBe("Mostra tutto");
    expect(toggle.getAttribute("aria-controls")).toBe(extra.id);
    expect(extra.closest(".keys-list"), "scorre con gli altri").not.toBeNull();
    const buttons = [...dialog().querySelectorAll(".palette-actions button")].map((button) => button.textContent);
    expect(buttons, "prima di Chiudi").toEqual(["Mostra tutto", "Chiudi"]);
    expect(document.activeElement?.textContent, "il fuoco resta su Chiudi").toBe("Chiudi");
    expect(extra.hidden).toBe(true);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");

    toggle.click();
    expect(extra.hidden).toBe(false);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(extra.querySelector(".keys-note")!.textContent).toBe("I tasti qui sotto valgono da un livello più alto.");
    const captions = [...dialog().querySelectorAll("caption")].map((caption) => caption.textContent);
    expect(captions).toEqual(["Strumenti", "Strumenti · dal livello Standard", "Griglia · dal livello Standard"]);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");

    toggle.click();
    expect(extra.hidden).toBe(true);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    dialog().querySelector<HTMLButtonElement>(".primary")!.click();
    await closed;
  });

  it("senza niente da aggiungere, nessun interruttore", async () => {
    const closed = showKeys("Tasti del disegno", [{ title: "Strumenti", rows: [["v", "Seleziona"]] }], {
      groups: [],
      note: "Niente sopra.",
    });
    expect(dialog().querySelector(".keys-show-all")).toBeNull();
    expect(dialog().querySelector(".keys-more")).toBeNull();
    expect(dialog().textContent).not.toContain("Niente sopra.");
    dialog().querySelector<HTMLButtonElement>(".primary")!.click();
    await closed;
  });
});
