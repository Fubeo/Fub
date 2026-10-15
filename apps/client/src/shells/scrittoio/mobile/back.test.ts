// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { mountBackClose } from "./back";

let lifetime: Lifetime;
let closes: number;
/// I passi che la prova vede nella cronologia: quelli messi meno quelli tolti.
let depth: number;

/// Il sistema che torna indietro: toglie un passo e lo dice alla pagina.
function systemBack(): void {
  depth -= 1;
  window.dispatchEvent(new PopStateEvent("popstate"));
}

beforeEach(() => {
  lifetime = openLifetime();
  closes = 0;
  depth = 0;
  vi.spyOn(window.history, "pushState").mockImplementation(() => {
    depth += 1;
  });
  // `history.back()` è asincrono nel browser: l'evento arriva dopo.
  vi.spyOn(window.history, "back").mockImplementation(() => {
    queueMicrotask(systemBack);
  });
});

afterEach(() => {
  lifetime.close();
  vi.restoreAllMocks();
});

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("indietro", () => {
  it("un pannello aperto mette un passo, e tornare indietro lo chiude", () => {
    const back = mountBackClose(lifetime, () => closes++);
    back.set(true);
    expect(depth).toBe(1);
    systemBack();
    expect(closes).toBe(1);
    expect(depth).toBe(0);
  });

  it("dire due volte lo stesso stato non mette due passi", () => {
    const back = mountBackClose(lifetime, () => closes++);
    back.set(true);
    back.set(true);
    expect(window.history.pushState).toHaveBeenCalledTimes(1);
    back.set(false);
    back.set(false);
    expect(window.history.back).toHaveBeenCalledTimes(1);
  });

  it("chiuso in un altro modo, il passo si ritira senza chiudere niente", async () => {
    const back = mountBackClose(lifetime, () => closes++);
    back.set(true);
    back.set(false);
    await settled();
    expect(depth).toBe(0);
    expect(closes).toBe(0);
  });

  it("senza un pannello aperto, tornare indietro non è affar suo", () => {
    mountBackClose(lifetime, () => closes++);
    systemBack();
    expect(closes).toBe(0);
  });

  it("chiuso dal sistema e poi riaperto: il passo torna, e torna a chiudere", async () => {
    const back = mountBackClose(lifetime, () => closes++);
    back.set(true);
    systemBack();
    // Chi chiude dice poi «chiuso»: il passo è già andato, non se ne ritira un altro.
    back.set(false);
    expect(window.history.back).not.toHaveBeenCalled();
    back.set(true);
    systemBack();
    expect(closes).toBe(2);
    await settled();
    expect(depth).toBe(0);
  });

  it("riaperto mentre il passo vecchio si ritira: il ritiro non chiude quello nuovo", async () => {
    const back = mountBackClose(lifetime, () => closes++);
    back.set(true);
    back.set(false);
    back.set(true);
    await settled();
    expect(closes).toBe(0);
    systemBack();
    expect(closes).toBe(1);
  });

  it("smontata la shell il passo non resta, e non ascolta più", async () => {
    const back = mountBackClose(lifetime, () => closes++);
    back.set(true);
    lifetime.close();
    await settled();
    expect(depth).toBe(0);
    systemBack();
    expect(closes).toBe(0);
  });
});
