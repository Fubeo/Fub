// @vitest-environment happy-dom
// Un errore della ricerca si scrive in parole: «Ricerca non disponibile» e,
// sotto, la frase della specie dell'errore con Riprova. Mai la prosa in inglese
// del kernel, e mai un oggetto (IMP-113).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const failure = vi.hoisted(() => ({ error: null as unknown }));

vi.hoisted(() => {
  document.body.innerHTML = `
    <nav id="views-ribbon"></nav>
    <div id="views-left"></div>
    <section id="files-panel"></section>
    <section id="search-panel">
      <input id="search-input">
      <div id="search-summary"></div>
      <ul id="search-results"></ul>
    </section>`;
});

vi.mock("../state/document-controller", () => ({ openDocument: async () => {}, reveal: () => {} }));
vi.mock("../ui/panel-host", () => ({ registerPanel: () => {}, unregisterPanel: () => {}, refreshOn: () => [] }));
vi.mock("./search-tools", () => ({
  mountSearchTools: () => ({ options: () => undefined, invalidate: () => {}, reset: () => {} }),
}));
vi.mock("../host/query", async (original) => ({
  ...(await original<typeof import("../host/query")>()),
  matchingDocuments: async () => {
    throw failure.error;
  },
  vaultStatus: async () => ({ indexing: false }),
  entryTimes: async () => ({}),
}));

import { emit } from "../state/store";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { mountSearch } from "./search";

const input = () => document.getElementById("search-input") as HTMLInputElement;
const summary = () => document.getElementById("search-summary")!.textContent;
const results = () => document.getElementById("search-results")!.textContent;

describe("la ricerca che non riesce (IMP-113)", () => {
  let lifetime: Lifetime;

  beforeEach(() => {
    vi.useFakeTimers();
    lifetime = openLifetime();
    mountSearch(lifetime);
    emit("vault", "/prova");
  });

  afterEach(() => {
    lifetime.close();
    vi.useRealTimers();
  });

  async function searchFor(text: string): Promise<void> {
    input().value = text;
    input().dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(400);
  }

  it("dice la specie dell'errore, non il messaggio del kernel in inglese", async () => {
    failure.error = { kind: "internal", message: "parse failed: rich codec: not a valid zip package" };
    await searchFor("è 🗺");
    expect(summary()).toBe("Ricerca non disponibile");
    expect(results()).toContain("si è verificato un problema imprevisto");
    expect(results()).toContain("Riprova");
    expect(results()).not.toContain("parse failed");
    expect(results()).not.toContain("[object Object]");
  });

  it("mai «[object Object]» davanti a un errore tipizzato, con qualunque messaggio", async () => {
    failure.error = { kind: "bad_args", message: { key: "search.syntax", args: [] } };
    await searchFor("parola");
    expect(results()).not.toContain("[object Object]");
    expect(results()).toContain("la richiesta non era valida");
  });
});
