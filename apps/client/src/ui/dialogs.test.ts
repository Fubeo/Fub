// @vitest-environment happy-dom
// La scelta in un elenco: il filtro, le frecce, Invio, e il valore scelto
// finora da cui l'elenco parte.

import { afterEach, describe, expect, it } from "vitest";
import { pickFromList, type PickItem } from "./dialogs";

const ITEMS: readonly PickItem<string>[] = [
  { label: "Acqua", detail: "Note/Acqua.md", value: "Note/Acqua.md" },
  { label: "Fuoco", detail: "Note/Fuoco.md", value: "Note/Fuoco.md" },
  { label: "Terra", detail: "Terra.md", value: "Terra.md" },
];

const input = (): HTMLInputElement => document.querySelector<HTMLInputElement>('.shell-dialog input[role="combobox"]')!;
const chosen = (): string | null => {
  const id = input().getAttribute("aria-activedescendant");
  return id === null ? null : document.getElementById(id)!.textContent;
};
const press = (key: string): void => {
  input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
};

afterEach(() => {
  for (const modal of document.querySelectorAll(".modale")) modal.remove();
});

describe("la scelta in un elenco", () => {
  it("parte dalla prima voce, e Invio sceglie quella evidenziata", async () => {
    const answer = pickFromList({ title: "Scegli", placeholder: "Filtra", items: ITEMS });
    expect(document.activeElement).toBe(input());
    expect(chosen()).toBe("AcquaNote/Acqua.md");
    press("ArrowUp");
    expect(chosen()).toBe("TerraTerra.md");
    press("Enter");
    await expect(answer).resolves.toBe("Terra.md");
  });

  it("parte dal valore scelto finora, se è fra le voci", async () => {
    const answer = pickFromList({ title: "Scegli", placeholder: "Filtra", items: ITEMS, current: "Note/Fuoco.md" });
    expect(chosen()).toBe("FuocoNote/Fuoco.md");
    expect(document.querySelector('[aria-selected="true"]')!.textContent).toBe("FuocoNote/Fuoco.md");
    // Il filtro riparte dalla prima voce che resta.
    input().value = "a";
    input().dispatchEvent(new Event("input"));
    expect(chosen()).toBe("AcquaNote/Acqua.md");
    press("Escape");
    await expect(answer).resolves.toBeNull();
  });

  it("un valore che non è fra le voci lascia la prima", async () => {
    const answer = pickFromList({ title: "Scegli", placeholder: "Filtra", items: ITEMS, current: "Altro.md" });
    expect(chosen()).toBe("AcquaNote/Acqua.md");
    press("Enter");
    await expect(answer).resolves.toBe("Note/Acqua.md");
  });
});
