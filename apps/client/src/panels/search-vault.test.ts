// @vitest-environment happy-dom
// La ricerca scritta è del vault in cui la si è scritta (#237 R07): un vault
// che si apre non la eredita, uno in cui si torna la ritrova, e la si rifà sul
// vault che c'è adesso.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queried } = vi.hoisted(() => {
  document.body.innerHTML = `
    <nav id="views-ribbon"></nav>
    <div id="views-left"></div>
    <section id="files-panel"></section>
    <section id="search-panel">
      <input id="search-input">
      <div id="search-summary"></div>
      <ul id="search-results"></ul>
    </section>`;
  return { queried: [] as string[] };
});

vi.mock("../state/document-controller", () => ({ openDocument: async () => {}, reveal: () => {} }));
vi.mock("../ui/panel-host", () => ({ registerPanel: () => {}, unregisterPanel: () => {}, refreshOn: () => [] }));
vi.mock("./search-tools", () => ({
  mountSearchTools: () => ({ options: () => undefined, invalidate: () => {}, reset: () => {} }),
}));
vi.mock("../host/query", async (original) => ({
  ...(await original<typeof import("../host/query")>()),
  matchingDocuments: async (expression: unknown) => {
    queried.push(JSON.stringify(expression));
    return { items: [], offset: 0, total: 0 };
  },
  vaultStatus: async () => ({ indexing: false }),
  entryTimes: async () => ({}),
}));

import { emit } from "../state/store";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { mountSearch } from "./search";

const input = () => document.getElementById("search-input") as HTMLInputElement;

describe("la ricerca di ogni vault (#237 R07)", () => {
  let lifetime: Lifetime;

  beforeEach(() => {
    vi.useFakeTimers();
    queried.length = 0;
    lifetime = openLifetime();
    mountSearch(lifetime);
  });

  afterEach(() => {
    lifetime.close();
    vi.useRealTimers();
  });

  it("un vault non eredita la query di un altro, e ritrova la sua tornandoci o riaprendolo", async () => {
    emit("vault", "/a");
    input().value = "fattura";

    // Due cambi di fila: nessuno dei due vault eredita la query di prima.
    emit("vault", "/b");
    expect(input().value).toBe("");
    input().value = "verbale";
    emit("vault", "/c");
    expect(input().value).toBe("");

    emit("vault", "/a");
    expect(input().value).toBe("fattura");
    // La query ritrovata si rifà sul vault di adesso: i risultati di prima
    // erano dell'altro.
    await vi.runAllTimersAsync();
    expect(queried.some((expression) => expression.includes("fattura"))).toBe(true);

    // Riaprire lo stesso vault non la toglie.
    emit("vault", "/a");
    expect(input().value).toBe("fattura");
    emit("vault", "/b");
    expect(input().value).toBe("verbale");
  });

  it("la finestra senza vault ha la casella vuota", () => {
    emit("vault", "/d");
    input().value = "appunti";
    emit("vault", "");
    expect(input().value).toBe("");
    emit("vault", "/d");
    expect(input().value).toBe("appunti");
  });
});
