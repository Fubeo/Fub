// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { filtered, matchesPath, mountExplorerFilter, parsePathFilter, type FilterEntry } from "./explorer-filter";

describe("la regola del filtro per percorso", () => {
  it("separa le parole da tenere da quelle col meno, e una frase fra virgolette vale una", () => {
    expect(parsePathFilter('  Guida -Bozze "nota lunga" -"vecchie cose" - ')).toEqual({
      include: ["guida", "nota lunga"],
      exclude: ["bozze", "vecchie cose"],
    });
    expect(parsePathFilter("")).toEqual({ include: [], exclude: [] });
  });

  it("il percorso intero deve contenere ogni parola, senza badare alle maiuscole", () => {
    const filter = parsePathFilter("guida sint");
    expect(matchesPath(filter, "Guida/Sintassi di Fub.md")).toBe(true);
    expect(matchesPath(filter, "Guida/Nota lunga.md")).toBe(false);
    // La cartella conta come il nome: è il percorso, non il nome, che si cerca.
    expect(matchesPath(parsePathFilter("progetti/il"), "Progetti/Il banco.md")).toBe(true);
  });

  it("una parola col meno toglie la cartella che corrisponde con tutto il contenuto", () => {
    const filter = parsePathFilter("-bozze");
    expect(matchesPath(filter, "Bozze")).toBe(false);
    expect(matchesPath(filter, "Bozze/a/b.md")).toBe(false);
    expect(matchesPath(filter, "Altro/Bozze vecchie/c.md")).toBe(false);
    expect(matchesPath(filter, "Altro/c.md")).toBe(true);
  });

  it("le voci che passano tornano in ordine di percorso, coi numeri come numeri", () => {
    const entries: FilterEntry[] = [
      { path: "b/n10.md", kind: "document" },
      { path: "b/n2.md", kind: "document" },
      { path: "a", kind: "folder" },
      { path: "c.png", kind: "file" },
    ];
    expect(filtered(parsePathFilter("b/n"), entries).map((e) => e.path)).toEqual(["b/n2.md", "b/n10.md"]);
  });
});

describe("il campo sopra l'albero", () => {
  let lifetime: Lifetime;
  afterEach(() => {
    lifetime?.close();
    document.body.replaceChildren();
  });

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  function mount(entries: () => Promise<FilterEntry[]>) {
    lifetime = openLifetime();
    const tree = document.createElement("ul");
    document.body.append(tree);
    const covering = vi.fn((on: boolean) => void (tree.hidden = on));
    const open = vi.fn();
    const filter = mountExplorerFilter({ lifetime, before: tree, covering, entries, open });
    const input = document.querySelector<HTMLInputElement>(".explorer-filter input")!;
    const type = async (value: string) => {
      input.value = value;
      input.dispatchEvent(new Event("input"));
      await settle();
    };
    const rows = () => [...document.querySelectorAll<HTMLElement>(".search-results .search-result")];
    return { tree, covering, open, filter, input, type, rows };
  }

  const VAULT: FilterEntry[] = [
    { path: "Guida", kind: "folder" },
    { path: "Guida/Sintassi.md", kind: "document" },
    { path: "Bozze/Sintassi vecchia.md", kind: "document" },
    { path: "Guida/schema.png", kind: "file" },
  ];

  it("è nascosto finché non lo si apre, e aperto ha il fuoco", () => {
    const { filter, input } = mount(async () => VAULT);
    expect(input.closest<HTMLElement>(".explorer-filter")!.hidden).toBe(true);
    filter.show();
    expect(input.closest<HTMLElement>(".explorer-filter")!.hidden).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  it("col testo l'elenco prende il posto dell'albero; senza, glielo rende", async () => {
    const entries = vi.fn(async () => VAULT);
    const { tree, covering, filter, type, rows } = mount(entries);
    filter.show();
    await type("sintassi -bozze");
    expect(rows().map((r) => r.dataset.path)).toEqual(["Guida/Sintassi.md"]);
    expect(rows()[0].querySelector(".hit-title")!.textContent).toBe("Sintassi");
    expect(tree.hidden).toBe(true);
    expect(filter.active()).toBe(true);
    await type("guida");
    // L'anagrafe si chiede una volta per filtro.
    expect(entries).toHaveBeenCalledTimes(1);
    expect(rows().map((r) => r.querySelector(".hit-title")!.textContent)).toEqual(["Guida/", "schema.png", "Sintassi"]);
    await type("");
    expect(rows()).toEqual([]);
    expect(tree.hidden).toBe(false);
    expect(covering.mock.calls).toEqual([[true], [false]]);
  });

  it("Invio apre la prima voce, le frecce scendono nell'elenco, Esc chiude tutto", async () => {
    const { input, open, filter, type, rows, tree } = mount(async () => VAULT);
    filter.show();
    await type("guida");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(open).toHaveBeenCalledWith({ path: "Guida", kind: "folder" });
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(rows()[0]);
    rows()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(rows()[1]);
    rows()[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(input.value).toBe("");
    expect(input.closest<HTMLElement>(".explorer-filter")!.hidden).toBe(true);
    expect(tree.hidden).toBe(false);
  });

  it("i documenti cambiati si richiedono, e un rifiuto si dice nell'elenco", async () => {
    let answer: () => Promise<FilterEntry[]> = async () => VAULT;
    const { filter, type, rows } = mount(() => answer());
    filter.show();
    await type("guida");
    expect(rows()).toHaveLength(3);
    answer = async () => {
      throw new Error("indice fermo");
    };
    filter.stale();
    await settle();
    expect(rows()).toEqual([]);
    expect(document.querySelector(".search-results")!.textContent).toContain("indice fermo");
  });

  it("una risposta vecchia non copre quella nuova", async () => {
    let release: (value: FilterEntry[]) => void = () => {};
    const slow = new Promise<FilterEntry[]>((resolve) => (release = resolve));
    const { filter, type, rows } = mount(() => slow);
    filter.show();
    void type("guida");
    void type("bozze");
    release(VAULT);
    await settle();
    await settle();
    expect(rows().map((r) => r.dataset.path)).toEqual(["Bozze/Sintassi vecchia.md"]);
  });

  it("smontato, toglie campo ed elenco e rende l'albero", async () => {
    const { filter, type, tree } = mount(async () => VAULT);
    filter.show();
    await type("guida");
    lifetime.close();
    expect(document.querySelector(".explorer-filter")).toBeNull();
    expect(document.querySelector(".search-results")).toBeNull();
    expect(tree.hidden).toBe(false);
  });
});
