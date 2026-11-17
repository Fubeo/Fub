// @vitest-environment happy-dom
//
// Il pannello del «/» senza editor: le tessere e le righe che arrivano, la
// scelta coi tasti, l'attivo per il lettore di schermo, il disegno in fondo,
// i passi e «Trasforma».
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SlashChoice, SlashPanelEvents, SlashPlace, SlashTransform } from "../../editors/core/editor-menu";
import { slashCatalog, slashMenuEntries } from "./entries";
import { ALL, SPECS } from "./fixture.test-data";
import { createSlashPanel, type SlashPanelDeps } from "./panel";

const EMPTY: SlashPlace = { line: "empty", above: null, inList: false };
const today = new Date(2026, 9, 29);
const use = { recent: [], favorites: [], chord: () => null, today };

function panel(transform?: SlashTransform, notes: SlashPanelDeps["notes"] = async () => []) {
  const hidden = new Set<string>();
  const chosen: SlashChoice[] = [];
  const active: (string | null)[] = [];
  const events: SlashPanelEvents & { dismissed: number; palettes: string[] } = {
    dismissed: 0,
    palettes: [],
    choose: (choice) => void chosen.push(choice),
    dismiss() {
      this.dismissed++;
    },
    active: (id) => void active.push(id),
    outline: () => [{ level: 1, text: "Statistica" }],
    palette(query) {
      this.palettes.push(query);
    },
    ...(transform ? { transform } : {}),
  };
  const favorites = new Set<string>();
  const deps: SlashPanelDeps = {
    entries: (query, place) => slashMenuEntries(SPECS, query, ALL, place, { ...use, hidden: [...hidden] }),
    favorite: (id) => favorites.has(id),
    toggleFavorite: (id) => (favorites.delete(id) ? false : (favorites.add(id), true)),
    hide: (entry) => void hidden.add(entry.id),
    today: () => today,
    colors: () => {
      const { colors } = slashCatalog(SPECS, ALL, use);
      return { text: colors.filter((each) => each.id.startsWith("markdown.color.")), fill: colors.filter((each) => each.id.startsWith("markdown.background.")) };
    },
    notes,
    headings: async () => [{ level: 2, text: "Le formule" }],
  };
  const made = createSlashPanel(events, deps);
  document.body.append(made.dom);
  const key = (name: string, init: KeyboardEventInit = {}) => made.key(new KeyboardEvent("keydown", { key: name, ...init }));
  const lit = () => made.dom.querySelector<HTMLElement>("[role=option][aria-selected=true]");
  const selected = () => lit()?.textContent ?? null;
  return { made, events, chosen, active, key, lit, selected, favorites, hidden };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("il pannello del «/» in inglese", () => {
  it("tessere, gruppi, il niente trovato e la sintassi nella lingua dell'interfaccia", () => {
    vi.stubGlobal("navigator", { ...navigator, language: "en-US", platform: "Linux" });
    const { made, key } = panel();
    made.update("", EMPTY);
    expect([...made.dom.querySelectorAll(".slash-tile")].map((tile) => tile.textContent)).toEqual(["Tasks", "Heading", "Callout", "Table", "Bullets", "Code"]);
    expect(made.dom.querySelector(".slash-group-label")?.textContent).toBe("Text");
    key("ArrowRight");
    expect(made.dom.querySelector(".slash-syntax")?.textContent).toBe("Typing ## · also /h2");
    made.update("qwerty", EMPTY);
    expect(made.dom.querySelector(".slash-none")?.textContent).toBe("No block for “qwerty”.");
    expect(made.dom.querySelector(".slash-all")?.textContent).toContain("Search all commands for «qwerty»");
  });
});

describe("il pannello del «/»", () => {
  it("a menu aperto: una colonna, le sei tessere, le righe nei loro gruppi, e la prima tessera accesa", () => {
    const { made, active, lit } = panel();
    made.update("", EMPTY);
    expect(made.dom.querySelector(".slash-head")?.hasAttribute("hidden")).toBe(true);
    const choices = made.dom.querySelector(".slash-choices")!;
    expect(choices.getAttribute("role")).toBe("listbox");
    expect(choices.id).toBe(made.listId);
    const tiles = [...made.dom.querySelectorAll<HTMLElement>(".slash-top .slash-tile")];
    expect(tiles.map((tile) => tile.textContent)).toEqual(["Attività", "Titolo", "Riquadro", "Tabella", "Punti", "Codice"]);
    expect(tiles[0]!.getAttribute("aria-label")).toBe("Elenco di attività");
    expect(tiles.every((tile) => tile.getAttribute("role") === "option" && tile.tabIndex === -1)).toBe(true);
    expect([...made.dom.querySelectorAll(".slash-group-label")].map((label) => label.textContent)).toContain("Testo");
    expect(made.dom.querySelectorAll(".slash-group[role=group]").length).toBeGreaterThan(3);
    expect(lit()).toBe(tiles[0]);
    expect(active[active.length - 1]).toBe(tiles[0]!.id);
    // La riga dice a destra come la si scrive senza menu.
    const heading = [...made.dom.querySelectorAll(".slash-row")].find((row) => row.textContent?.startsWith("Titolo 2"))!;
    expect(heading.querySelector(".slash-syntax-note")?.textContent).toBe("##");
    // Il conto si legge anche senza testata.
    expect(made.dom.querySelector("[role=status]")?.textContent).toMatch(/blocchi e comandi/);
  });

  it("i tasti non stanno nel pannello: li dice la banda di stato (contesto «slash» di `markdownHints`)", () => {
    const { made } = panel();
    made.update("tit", EMPTY);
    // L'unico tasto scritto è sulla riga che apre tutti i comandi.
    const keys = [...made.dom.querySelectorAll(".kit-row-keys")];
    expect(keys).toHaveLength(1);
    expect(keys[0]!.closest(".slash-all")).not.toBeNull();
  });

  it("nessuna classe della versione a due colonne", () => {
    const { made, key } = panel();
    made.update("", EMPTY);
    key("ArrowDown");
    for (const old of [".slash-tabs", ".slash-preview", ".slash-stage", ".slash-foot", ".slash-pill", ".slash-sample", ".slash-section", ".slash-text"]) {
      expect(made.dom.querySelector(old), old).toBeNull();
    }
  });

  it("a menu appena aperto Invio mette la prima tessera; le frecce di lato scorrono le tessere", () => {
    const { made, key, chosen, selected } = panel();
    made.update("", EMPTY);
    key("Enter");
    expect(chosen[0]).toMatchObject({ entry: { id: "markdown.list.task" }, below: false });
    expect(key("ArrowRight")).toBe(true);
    expect(selected()).toBe("Titolo");
    expect(key("ArrowLeft")).toBe(true);
    expect(key("ArrowLeft")).toBe(true);
    expect(selected()).toBe("Codice");
  });

  it("↓ dalle tessere scende nelle righe, ↑ dalla prima riga risale; fra le righe le frecce di lato muovono il cursore", () => {
    const { made, key, lit } = panel();
    made.update("", EMPTY);
    key("ArrowDown");
    expect(lit()?.classList.contains("slash-row")).toBe(true);
    expect(lit()?.textContent).toContain("Testo normale");
    expect(key("ArrowRight")).toBe(false);
    key("ArrowUp");
    expect(lit()?.classList.contains("slash-tile")).toBe(true);
    // Dalle tessere ↑ va all'ultima riga.
    key("ArrowUp");
    const rows = made.dom.querySelectorAll(".slash-list .slash-row");
    expect(lit()).toBe(rows[rows.length - 1]);
  });

  it("Tab salta al gruppo dopo, Maiusc Tab torna; le tessere sono una tappa", () => {
    const { made, key, lit } = panel();
    made.update("", EMPTY);
    const group = () => lit()?.closest(".slash-group")?.querySelector(".slash-group-label")?.textContent ?? "tessere";
    expect(group()).toBe("tessere");
    key("Tab");
    expect(group()).toBe("Testo");
    key("Tab");
    expect(group()).toBe("Elenchi");
    key("Tab", { shiftKey: true });
    key("Tab", { shiftKey: true });
    expect(group()).toBe("tessere");
  });

  it("scrivendo: un elenco solo, la parte trovata in evidenza, e in fondo «Cerca fra tutti i comandi»", () => {
    const { made, key, chosen, selected, events } = panel();
    made.update("tit", EMPTY);
    expect(made.dom.querySelector(".slash-top")?.hasAttribute("hidden")).toBe(true);
    expect(made.dom.querySelector(".slash-group")).toBeNull();
    expect(made.dom.querySelector(".slash-found")?.textContent).toBe("Tit");
    expect(selected()).toContain("Titolo 1");
    key("ArrowDown");
    expect(selected()).toContain("Titolo 2");
    key("Enter");
    expect(chosen).toEqual([expect.objectContaining({ entry: expect.objectContaining({ id: "markdown.heading.2" }), below: false })]);
    key("Enter", { shiftKey: true });
    expect(chosen[1]!.below).toBe(true);
    const rows = [...made.dom.querySelectorAll(".slash-row")];
    expect(rows[rows.length - 1]?.textContent).toContain("Cerca «tit» fra tutti i comandi");
    key("ArrowUp");
    key("ArrowUp");
    expect(selected()).toContain("Cerca «tit» fra tutti i comandi");
    expect(made.dom.querySelector(".slash-detail")?.hasAttribute("hidden")).toBe(true);
    key("Enter");
    expect(events.palettes).toEqual(["tit"]);
  });

  it("niente trovato: lo dice, e la sola scelta, accesa, cerca fra tutti i comandi", () => {
    const { made, key, events, selected } = panel();
    made.update("qwerty", EMPTY);
    expect(made.dom.querySelector(".slash-none")?.textContent).toBe("Nessun blocco per «qwerty».");
    expect(selected()).toContain("Cerca «qwerty» fra tutti i comandi");
    key("Enter");
    expect(events.dismissed).toBe(1);
    expect(events.palettes).toEqual(["qwerty"]);
  });

  it("Ctrl+/ apre la palette con ciò che si è scritto, Esc chiude", () => {
    const { made, key, events } = panel();
    made.update("li", EMPTY);
    expect(key("/", { ctrlKey: true })).toBe(true);
    expect(events.palettes).toEqual(["li"]);
    key("Escape");
    expect(events.dismissed).toBe(2);
  });

  it("in fondo il disegno della scelta: la miniatura, che cosa fa, come si scrive e gli argomenti rapidi", () => {
    const { made, key } = panel();
    made.update("", EMPTY);
    key("ArrowRight");
    const detail = made.dom.querySelector<HTMLElement>(".slash-detail")!;
    expect(detail.hidden).toBe(false);
    expect(detail.querySelector(".slash-thumb svg")?.getAttribute("viewBox")).toBe("0 0 96 60");
    expect([...detail.querySelectorAll(".slash-syntax kbd")].map((kbd) => kbd.textContent)).toEqual(["##", "/h2"]);
    expect(detail.querySelector(".slash-syntax")?.textContent).toBe("Scrivendo ## · anche /h2");
    const tile = made.dom.querySelector("[role=option][aria-selected=true]")!;
    expect(tile.getAttribute("aria-describedby")).toBe(detail.querySelector(".slash-description")!.id);
    expect(detail.querySelector(".slash-description")?.textContent).toBe("Fa delle righe selezionate un titolo di secondo livello.");
    // La sintassi della descrizione si legge in monospazio, senza apici.
    key("ArrowRight");
    expect(detail.querySelector(".slash-description")?.textContent).toBe("Racchiude le righe selezionate in un riquadro > [!note].");
    expect(detail.querySelector(".slash-description code")?.textContent).toBe("> [!note]");
  });

  it("la stella mette la voce fra i preferiti", () => {
    const { made, favorites } = panel();
    made.update("tit", EMPTY);
    const star = made.dom.querySelector<HTMLButtonElement>(".slash-tools button")!;
    star.click();
    expect(favorites.has("markdown.heading.1")).toBe(true);
  });

  it("«Nascondi dal menu» toglie la voce e la scelta resta lì", () => {
    const { made, hidden, selected } = panel();
    made.update("tit", EMPTY);
    const hide = made.dom.querySelectorAll<HTMLButtonElement>(".slash-tools button")[1]!;
    expect(hide.getAttribute("aria-label")).toBe("Nascondi dal menu");
    hide.click();
    expect(hidden.has("markdown.heading.1")).toBe(true);
    expect(made.dom.textContent).not.toContain("Titolo 1");
    expect(selected()).toContain("Titolo 2");
  });

  it("una voce con un passo lo apre, con la testata; Backspace torna all'elenco", () => {
    const { made, key, chosen } = panel();
    made.update("tabella", EMPTY);
    key("Enter");
    expect(made.dom.classList.contains("is-step")).toBe(true);
    expect(made.dom.querySelector(".slash-head")?.hasAttribute("hidden")).toBe(false);
    expect(made.dom.querySelector(".slash-count")?.textContent).toContain("3 × 3");
    key("ArrowRight");
    key("ArrowDown");
    key("Enter");
    expect(chosen).toEqual([expect.objectContaining({ entry: expect.objectContaining({ id: "markdown.table" }), params: { rows: 4, cols: 4 } })]);
    key("Backspace");
    expect(made.dom.classList.contains("is-step")).toBe(false);
    expect(made.dom.querySelector(".slash-head")?.hasAttribute("hidden")).toBe(true);
    expect(made.dom.querySelector(".slash-row")).not.toBeNull();
  });

  it("«Trasforma»: soltanto ciò che cambia le righe, niente tessere, il dopo in fondo, e si filtra scrivendo", () => {
    const transform: SlashTransform = { lines: 2, before: "Uno\nDue", after: (id) => (id === "markdown.list.bullet" ? "- Uno\n- Due" : null) };
    const { made, key } = panel(transform);
    made.update("", EMPTY);
    expect(made.dom.classList.contains("is-transform")).toBe(true);
    expect(made.dom.querySelector(".slash-context")?.textContent).toBe("2 righe scelte");
    expect(made.dom.querySelector(".slash-top")?.hasAttribute("hidden")).toBe(true);
    const rows = [...made.dom.querySelectorAll(".slash-row")].map((row) => row.textContent);
    expect(rows.some((text) => text?.includes("Elenco puntato"))).toBe(true);
    expect(rows.some((text) => text?.includes("Titolo 2"))).toBe(false);
    key("e");
    key("l");
    expect(made.dom.querySelector(".slash-crumb")?.textContent).toBe("Trasforma · el");
    expect(made.dom.querySelector(".slash-syntax")?.textContent).toBe("Dopo: - Uno ⏎ - Due");
  });

  it("il passo non scorre da sé: le frecce lo fanno scorrere e il giorno scelto resta in vista", () => {
    const { made, key } = panel();
    made.update("data", EMPTY);
    key("Enter");
    const step = made.dom.querySelector<HTMLElement>(".slash-step.is-date")!;
    expect(step).not.toBeNull();
    // Un passo accorciato: si vede da 0 a 150; le settimane del calendario
    // partono da 80, una ogni 34 px, e scorrono col passo.
    const rect = (top: number, height: number) => new DOMRect(0, top, 300, height);
    const days = () => [...step.querySelectorAll<HTMLElement>("[role=option]")];
    const box = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this === step) return rect(0, 150);
      const index = days().indexOf(this);
      return index < 0 ? rect(0, 0) : rect(80 + Math.floor(index / 7) * 34 - step.scrollTop, 30);
    });
    try {
      const inView = () => {
        const day = step.querySelector<HTMLElement>(".is-selected")!.getBoundingClientRect();
        return day.top >= 0 && day.bottom <= 150;
      };
      // Domani, venerdì 30 ottobre, è nell'ultima settimana del mese.
      key("ArrowLeft");
      key("ArrowRight");
      expect(step.querySelector(".is-selected")?.textContent).toBe("30");
      expect(inView()).toBe(true);
      key("ArrowRight");
      expect(step.querySelector(".is-selected")?.textContent).toBe("31");
      expect(inView()).toBe(true);
      expect(step.scrollTop).toBeGreaterThan(0);
      // Tornando alla prima settimana il passo risale.
      for (let i = 0; i < 4; i++) key("ArrowUp");
      expect(step.querySelector(".is-selected")?.textContent).toBe("3");
      expect(inView()).toBe(true);
    } finally {
      box.mockRestore();
    }
  });

  it("chiuso, non risponde più", () => {
    const { made, key } = panel();
    made.update("", EMPTY);
    made.close();
    expect(key("ArrowDown")).toBe(false);
  });
});
