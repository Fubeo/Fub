// @vitest-environment happy-dom
// La scelta in un elenco: il filtro, le frecce, Invio, il valore scelto
// finora da cui l'elenco parte, e le miniature.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickFromList, type PickItem } from "./dialogs";
import type { Lifetime } from "./lifetime";

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

describe("le miniature", () => {
  /// Un IntersectionObserver finto: le voci si vedono quando lo dice il caso.
  class Watcher {
    static last: Watcher | null = null;
    readonly observed = new Set<Element>();
    disconnected = false;
    constructor(
      readonly callback: IntersectionObserverCallback,
      readonly options?: IntersectionObserverInit,
    ) {
      Watcher.last = this;
    }
    observe(target: Element): void {
      this.observed.add(target);
    }
    unobserve(target: Element): void {
      this.observed.delete(target);
    }
    disconnect(): void {
      this.observed.clear();
      this.disconnected = true;
    }
    /// `targets` entrano nell'elenco che si vede.
    show(targets: readonly Element[]): void {
      const entries = targets.map((target) => ({ target, isIntersecting: true }) as unknown as IntersectionObserverEntry);
      this.callback(entries, this as unknown as IntersectionObserver);
    }
  }

  const thumbs = (): HTMLImageElement[] => [...document.querySelectorAll<HTMLImageElement>(".palette-thumb")];
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => vi.stubGlobal("IntersectionObserver", Watcher));
  afterEach(() => vi.unstubAllGlobals());

  it("si chiedono quando la voce si vede, una volta, e vivono quanto la finestra", async () => {
    const asked: string[] = [];
    const lives: Lifetime[] = [];
    const items = ITEMS.map((item) => ({
      ...item,
      thumbnail: async (life: Lifetime) => {
        asked.push(item.label);
        lives.push(life);
        return `blob:${item.label}`;
      },
    }));
    const answer = pickFromList({ title: "Scegli", placeholder: "Filtra", items });
    // Davanti al nome, che dice già che cosa è.
    expect(thumbs().map((image) => [image.alt, image.nextElementSibling!.textContent])).toEqual([
      ["", "Acqua"],
      ["", "Fuoco"],
      ["", "Terra"],
    ]);
    // Il ritaglio nel quadrato è del componente: il contratto dei temi non lo ammette.
    expect(thumbs().map((image) => image.style.objectFit)).toEqual(["cover", "cover", "cover"]);
    expect(asked).toEqual([]);
    const watcher = Watcher.last!;
    expect(watcher.options?.root).toBe(document.querySelector(".palette-list"));
    watcher.show(thumbs().slice(0, 2));
    await settle();
    expect(asked).toEqual(["Acqua", "Fuoco"]);
    expect(thumbs().map((image) => image.getAttribute("src"))).toEqual(["blob:Acqua", "blob:Fuoco", null]);
    // Un tasto ridisegna l'elenco con le stesse immagini, che non si richiedono.
    const [acqua, , terra] = thumbs();
    press("ArrowDown");
    input().value = "a";
    input().dispatchEvent(new Event("input"));
    expect(thumbs()).toEqual([acqua, terra]);
    // Resta da guardare soltanto quella che non si è ancora vista.
    expect([...watcher.observed]).toEqual([terra]);
    expect(asked).toEqual(["Acqua", "Fuoco"]);
    press("Enter");
    await expect(answer).resolves.toBe("Note/Acqua.md");
    expect(lives.every((life) => life.closed)).toBe(true);
    expect(watcher.disconnected).toBe(true);
  });

  it("un URL che arriva a finestra chiusa non si mette, e una miniatura che non si apre resta vuota", async () => {
    let late: (url: string) => void = () => {};
    const items: PickItem<string>[] = [
      { ...ITEMS[0]!, thumbnail: async () => null },
      { ...ITEMS[1]!, thumbnail: () => Promise.reject(new Error("rotta")) },
      { ...ITEMS[2]!, thumbnail: () => new Promise((resolve) => (late = resolve)) },
    ];
    const answer = pickFromList({ title: "Scegli", placeholder: "Filtra", items });
    Watcher.last!.show(thumbs());
    await settle();
    const [none, broken, slow] = thumbs();
    press("Escape");
    await expect(answer).resolves.toBeNull();
    late("blob:Terra");
    await settle();
    expect([none, broken, slow].map((image) => image!.getAttribute("src"))).toEqual([null, null, null]);
  });

  it("senza IntersectionObserver si chiedono tutte subito", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const items = ITEMS.map((item) => ({ ...item, thumbnail: async () => `blob:${item.label}` }));
    const answer = pickFromList({ title: "Scegli", placeholder: "Filtra", items });
    await settle();
    expect(thumbs().map((image) => image.getAttribute("src"))).toEqual(["blob:Acqua", "blob:Fuoco", "blob:Terra"]);
    press("Escape");
    await answer;
  });

  it("le voci che non ne hanno non ne mostrano", async () => {
    const answer = pickFromList({ title: "Scegli", placeholder: "Filtra", items: ITEMS });
    expect(thumbs()).toEqual([]);
    expect(Watcher.last === null || Watcher.last.observed.size === 0).toBe(true);
    press("Escape");
    await answer;
  });
});
