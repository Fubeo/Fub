// @vitest-environment happy-dom
//
// «Più contesto» nella ricerca legge le note per mostrare le righe attorno a
// ogni occorrenza: è una lettura semplice, non un'apertura. Questo banco lo
// prova sul confine vero, l'host finto con le sue chiavi di apertura: cento
// documenti di videoscrittura letti per l'anteprima, più volte, non lasciano
// nell'host nessuna chiave aperta.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { FakeHost } from "../host/fake";
import type { IndexResult } from "../host/contract";

const box = vi.hoisted(() => ({ host: null as FakeHost | null }));

// Le porte del finto, con una differenza: il finto non calcola le occorrenze
// di una ricerca, e senza occorrenze «più contesto» non ha niente da leggere.
// Qui ogni risultato ne riceve una, come la darebbe l'host vero.
vi.mock("../host/ipc", () => {
  const api = () => {
    if (!box.host) throw new Error("l'host finto non è stato montato");
    return box.host.module.api as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  };
  return {
    api: new Proxy(
      {},
      {
        get: (_target, name: string) => async (...args: unknown[]) => {
          const result = await api()[name]!(...args);
          if (name !== "queryIndex") return result;
          const answer = result as IndexResult;
          if (answer.kind !== "documents") return answer;
          return {
            ...answer,
            value: {
              ...answer.value,
              items: answer.value.items.map((item) => ({
                ...item,
                occurrences: [{ span: { start: 0, end: 7 }, revision: "r0" }],
              })),
            },
          };
        },
      },
    ),
    onKernelEvent: () => () => {},
  };
});

const { createFakeHost } = await import("../host/fake");
const { openLifetime } = await import("../ui/lifetime");
const { t } = await import("../i18n/strings");
const rawHtml = (await import("../../index.html?raw")).default;

const FILES = Object.fromEntries(
  Array.from({ length: 100 }, (_, i) => [`Lettere/Lettera-${String(i).padStart(3, "0")}.docx`, `lettera numero ${i}`]),
);

let mountSearch: (typeof import("./search"))["mountSearch"];

beforeAll(async () => {
  // Il pannello, e i moduli che importa, prendono i loro elementi al primo
  // import: la pagina è quella vera.
  document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(rawHtml)![1]!.replace(/<script[\s\S]*?<\/script>/g, "");
  box.host = createFakeHost({ root: "/vault", file: FILES });
  ({ mountSearch } = await import("./search"));
});

const lifetimes: Array<{ close(): void }> = [];
afterEach(() => {
  for (const lifetime of lifetimes.splice(0)) lifetime.close();
  document.querySelectorAll(".context-menu").forEach((menu) => menu.remove());
});

/// Apre il menu «⋯» e sceglie «più contesto».
function toggleMoreContext(): void {
  const more = document.querySelector<HTMLButtonElement>(".search-more");
  if (!more) throw new Error("manca il pulsante «⋯» della ricerca");
  more.click();
  const item = [...document.querySelectorAll<HTMLElement>(".context-menu [role^='menuitem']")].find((el) =>
    el.textContent?.includes(t("search.more_context")),
  );
  if (!item) throw new Error("manca la voce «più contesto»");
  item.click();
}

describe("«più contesto» nella ricerca", () => {
  it("cento documenti letti per l'anteprima, più volte, non lasciano chiavi aperte", async () => {
    const host = box.host!;
    const lifetime = openLifetime();
    lifetimes.push(lifetime);
    mountSearch(lifetime);
    const input = document.querySelector<HTMLInputElement>("#search-input")!;
    input.value = "lettera";
    input.dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(document.querySelectorAll(".search-result").length).toBeGreaterThan(0), {
      timeout: 2000,
    });

    for (let round = 0; round < 6; round++) {
      toggleMoreContext();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    // Acceso alla fine: il contesto si è disegnato.
    toggleMoreContext();
    await vi.waitFor(() => expect(document.querySelector(".hit-context")?.textContent).toContain("lettera"));
    await vi.waitFor(() =>
      expect(new Set(host.atGate("readDocument").map((call) => call.args[0])).size).toBe(
        document.querySelectorAll(".hit-context").length,
      ),
    );

    // Le pagine dopo la prima, finché ci sono: l'anteprima copre i cento file.
    for (let page = 0; page < 5 && document.querySelectorAll(".hit-context").length < 100; page++) {
      const loadMore = [...document.querySelectorAll<HTMLButtonElement>("button.search-result")].find(
        (button) => !button.querySelector(".hit-title") && !button.classList.contains("hit-occurrence"),
      );
      if (!loadMore) break;
      loadMore.click();
      await vi.waitFor(() => expect(document.querySelectorAll(".hit-context").length).toBeGreaterThan(50 * (page + 1)));
    }
    await vi.waitFor(() => expect(new Set(host.atGate("readDocument").map((call) => call.args[0])).size).toBe(100));

    // E ancora avanti e indietro, con tutti e cento a schermo.
    for (let round = 0; round < 4; round++) {
      toggleMoreContext();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await vi.waitFor(() => expect(document.querySelectorAll(".hit-context").length).toBe(100));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(host.atGate("readDocument").length).toBeGreaterThan(100);
    expect(host.atGate("openDocument")).toEqual([]);
    expect(host.atGate("documentClosed")).toEqual([]);
    expect(host.openKeys("/vault")).toBe(0);
    expect(host.openKeys()).toBe(0);
  });
});
