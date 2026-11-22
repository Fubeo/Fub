// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../../../ui/lifetime";
import { apriCassetto, type StrumentoCassetto } from "./drawer";

const STRUMENTI: StrumentoCassetto[] = [
  { id: "select", label: "draw.tool.select", icon: "draw-select", keys: "V", famiglia: "pick" },
  { id: "pen", label: "draw.tool.pen", icon: "draw-pen", keys: "P", famiglia: "ink" },
  { id: "rect", label: "draw.tool.rect", icon: "draw-rect", keys: "R", famiglia: "shape" },
];

function apri(corrente: string | null = "pen") {
  const anchor = document.createElement("button");
  document.body.append(anchor);
  const life = openLifetime();
  const scegli = vi.fn();
  const modifica = vi.fn();
  const popover = apriCassetto({ anchor, strumenti: STRUMENTI, corrente, scegli, modifica, lifetime: life });
  return { popover, scegli, modifica, life, anchor };
}

describe("il cassetto Tutti gli strumenti", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("mostra un gruppo per famiglia, ogni strumento col suo tasto, e segna quello in uso", () => {
    const { popover, life } = apri("pen");
    const groups = [...popover.element.querySelectorAll(".draw-drawer-group")];
    expect(groups).toHaveLength(3);
    const pen = popover.element.querySelector<HTMLButtonElement>('[data-tool="pen"]')!;
    expect(pen.getAttribute("aria-pressed")).toBe("true");
    expect(popover.element.querySelector('[data-tool="select"] .draw-drawer-keys')!.textContent).toBe("V");
    popover.close("manual");
    life.close();
  });

  it("scegliere uno strumento lo passa a chi l'ha aperto e chiude il cassetto", () => {
    const { popover, scegli, life } = apri();
    popover.element.querySelector<HTMLButtonElement>('[data-tool="rect"]')!.click();
    expect(scegli).toHaveBeenCalledWith("rect");
    expect(popover.closed).toBe(true);
    life.close();
  });

  it("da tastiera: la freccia giù dalla ricerca entra nella lista, le frecce passano fra gli strumenti visibili, Fine va all'ultimo", () => {
    const { popover, life } = apri();
    const input = popover.element.querySelector<HTMLInputElement>("input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(popover.element.querySelector('[data-tool="select"]'));
    const sul = (key: string) => (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    sul("ArrowDown");
    expect(document.activeElement).toBe(popover.element.querySelector('[data-tool="pen"]'));
    sul("End");
    expect(document.activeElement).toBe(popover.element.querySelector('[data-tool="rect"]'));
    sul("Home");
    expect(document.activeElement).toBe(popover.element.querySelector('[data-tool="select"]'));
    popover.close("manual");
    life.close();
  });

  it("Esc chiude il cassetto e riporta il fuoco alla casella che lo ha aperto", () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    anchor.focus();
    const life = openLifetime();
    const popover = apriCassetto({ anchor, strumenti: STRUMENTI, corrente: "pen", scegli: vi.fn(), modifica: vi.fn(), lifetime: life });
    popover.element.querySelector<HTMLButtonElement>('[data-tool="rect"]')!.focus();
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(popover.closed).toBe(true);
    expect(document.activeElement).toBe(anchor);
    life.close();
  });

  it("la ricerca trova il nome senza maiuscole e nasconde gli altri gruppi", () => {
    const { popover, life } = apri();
    const input = popover.element.querySelector<HTMLInputElement>("input")!;
    input.value = "INCHIOSTRO";
    input.dispatchEvent(new Event("input"));
    expect(popover.element.querySelector<HTMLElement>('[data-tool="pen"]')!.hidden).toBe(false);
    expect(popover.element.querySelector<HTMLElement>('[data-tool="select"]')!.hidden).toBe(true);
    expect(popover.element.querySelector<HTMLElement>(".draw-drawer-empty")!.hidden).toBe(true);
    input.value = "zzz";
    input.dispatchEvent(new Event("input"));
    expect(popover.element.querySelector<HTMLElement>(".draw-drawer-empty")!.hidden).toBe(false);
    popover.close("manual");
    life.close();
  });

  it("«Modifica la colonna» chiude il cassetto e chiede la colonna", () => {
    const { popover, modifica, life } = apri();
    popover.element.querySelector<HTMLButtonElement>(".draw-drawer-edit")!.click();
    expect(modifica).toHaveBeenCalledTimes(1);
    expect(popover.closed).toBe(true);
    life.close();
  });
});
