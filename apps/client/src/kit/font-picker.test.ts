// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accessibleName } from "../ui/a11y-check";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { createFontPicker, familyStack, fold, fontButton, fontRows, type FontChoice, type FontPickerText } from "./font-picker";
import { listenerLedger, press } from "./testing";

const TEXT: FontPickerText = {
  search: "Cerca un carattere",
  empty: "Nessun carattere",
  groups: { recent: "Recenti", document: "Del documento", vault: "Del vault", system: "Di sistema" },
};

const FONTS: readonly FontChoice[] = [
  { family: "Hanken Grotesk", source: "vault" },
  { family: "Newsreader", source: "vault", generic: "serif" },
  { family: "Arial", source: "system" },
  { family: "Times New Roman", source: "system", generic: "serif" },
  { family: "Newsreader", source: "recent", generic: "serif" },
  { family: "Hanken Grotesk", source: "document" },
  { family: "Arial", source: "system" },
];

let life: Lifetime;
let chosen: string[];

beforeEach(() => {
  life = openLifetime();
  chosen = [];
});

afterEach(() => {
  life.close();
  document.body.replaceChildren();
});

const visible = (root: ParentNode): string[] =>
  [...root.querySelectorAll<HTMLElement>("[role=option]")].map((row) => row.textContent ?? "");

describe("la scelta del carattere del kit", () => {
  it("le righe vanno per gruppi, una famiglia una volta per gruppo, e la ricerca non bada agli accenti", () => {
    expect(fold("Cafè Ünïcode")).toBe("cafe unicode");
    expect(fontRows(FONTS, "").map((row) => (row.kind === "group" ? `[${row.source}]` : row.font.family))).toEqual([
      "[recent]", "Newsreader",
      "[document]", "Hanken Grotesk",
      "[vault]", "Hanken Grotesk", "Newsreader",
      "[system]", "Arial", "Times New Roman",
    ]);
    expect(fontRows(FONTS, "NÉWS").map((row) => (row.kind === "group" ? row.source : row.font.family))).toEqual([
      "recent", "Newsreader", "vault", "Newsreader",
    ]);
    expect(familyStack({ family: 'Strano "nome"', generic: "serif" })).toBe('"Strano \\"nome\\"", serif');
  });

  it("si cerca, si sceglie con le frecce e Invio, e ogni nome è nel suo carattere", () => {
    const picker = createFontPicker({ value: "Arial", fonts: FONTS, text: TEXT, onChange: (family) => chosen.push(family), lifetime: life });
    document.body.append(picker.element);
    expect(accessibleName(picker.input)).toBe("Cerca un carattere");
    expect(picker.input.getAttribute("role")).toBe("combobox");
    const arial = [...picker.element.querySelectorAll<HTMLElement>(".kit-font-name")].find((name) => name.textContent === "Arial")!;
    expect(arial.style.fontFamily).toContain("Arial");
    expect(picker.element.querySelector("[data-selected]")?.textContent).toBe("Arial");
    picker.input.value = "times";
    picker.input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(visible(picker.element)).toEqual(["Di sistema", "Times New Roman"]);
    press(picker.input, "Enter");
    expect(chosen).toEqual(["Times New Roman"]);
    picker.input.value = "zzz";
    picker.input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(picker.element.querySelector<HTMLElement>(".kit-font-empty")!.hidden).toBe(false);
  });

  it("il pulsante dice la famiglia, apre la scelta e la chiude scegliendo", () => {
    const ledger = listenerLedger(document, window);
    const opened: boolean[] = [];
    const button = fontButton({
      label: "Carattere",
      mixedText: "Misto",
      value: "Newsreader",
      fonts: FONTS,
      text: TEXT,
      onChange: (family) => chosen.push(family),
      onOpenChange: (open) => opened.push(open),
      lifetime: life,
    });
    document.body.append(button.element);
    expect(accessibleName(button.element)).toBe("Carattere: Newsreader");
    button.element.click();
    expect(button.element.getAttribute("aria-expanded")).toBe("true");
    const popover = document.querySelector<HTMLElement>(".kit-font-popover")!;
    const input = popover.querySelector<HTMLInputElement>("input")!;
    expect(document.activeElement).toBe(input);
    input.value = "arial";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    press(input, "Enter");
    expect(chosen).toEqual(["Arial"]);
    expect(button.element.getAttribute("aria-expanded")).toBe("false");
    expect(accessibleName(button.element)).toBe("Carattere: Arial");
    expect(opened).toEqual([true, false]);
    button.setValue(null);
    expect(accessibleName(button.element)).toBe("Carattere: Misto");
    life.close();
    expect(ledger()).toBe(0);
  });
});
