// @vitest-environment happy-dom
//
// Il pannello del «/» senza editor: le voci che arrivano, la scelta coi
// tasti, l'attivo per il lettore di schermo, i passi e «Trasforma».
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
  const selected = () => made.dom.querySelector(".slash-row.is-selected")?.textContent ?? null;
  return { made, events, chosen, active, key, selected, favorites, hidden };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("il pannello del «/»", () => {
  it("a menu aperto: la testata, le linguette, le righe nei loro gruppi, e la prima riga attiva", () => {
    const { made, active } = panel();
    made.update("", EMPTY);
    expect(made.dom.querySelector(".slash-query")?.textContent).toBe("/");
    expect(made.dom.querySelector(".slash-context")?.textContent).toBe("riga vuota: diventa il blocco scelto");
    expect(made.dom.querySelector(".slash-count")?.getAttribute("role")).toBe("status");
    expect([...made.dom.querySelectorAll(".slash-tabs button")].map((tab) => tab.textContent)).toContain("Testo");
    expect(made.dom.querySelector(".slash-list")?.getAttribute("role")).toBe("listbox");
    expect(made.dom.querySelectorAll(".slash-group[role=group]").length).toBeGreaterThan(3);
    const first = made.dom.querySelector(".slash-row")!;
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(active[active.length - 1]).toBe(first.id);
  });

  it("le frecce muovono la scelta, Tab salta di sezione, Invio sceglie", () => {
    const { made, key, chosen, selected } = panel();
    made.update("tit", EMPTY);
    expect(selected()).toContain("Titolo 1");
    expect(key("ArrowDown")).toBe(true);
    expect(selected()).toContain("Titolo 2");
    key("Enter");
    expect(chosen).toEqual([expect.objectContaining({ entry: expect.objectContaining({ id: "markdown.heading.2" }), below: false })]);
    key("Enter", { shiftKey: true });
    expect(chosen[1]!.below).toBe(true);
    made.update("", EMPTY);
    const section = () => made.dom.querySelector(".slash-row.is-selected")?.closest(".slash-group")?.querySelector(".slash-section")?.textContent;
    const before = section();
    key("Tab");
    expect(section()).not.toBe(before);
    key("Tab", { shiftKey: true });
    expect(section()).toBe(before);
  });

  it("filtrando: un gruppo Risultati, la parte trovata in evidenza, il conto", () => {
    const { made } = panel();
    made.update("tab", EMPTY);
    expect(made.dom.querySelector(".slash-section")?.textContent).toBe("Risultati");
    expect(made.dom.querySelector(".slash-row mark")?.textContent).toBe("Tab");
    expect(made.dom.querySelector(".slash-tabs")?.hasAttribute("hidden")).toBe(true);
  });

  it("niente trovato: il pannello resta aperto e Invio cerca fra tutti i comandi", () => {
    const { made, key, events } = panel();
    made.update("qwerty", EMPTY);
    expect(made.dom.querySelector(".slash-empty")?.textContent).toContain("Niente per «qwerty»");
    expect(made.dom.classList.contains("is-empty")).toBe(true);
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

  it("l'anteprima arriva dopo 40 ms e dice come scriverlo senza menu", () => {
    vi.useFakeTimers();
    try {
      const { made, key } = panel();
      made.update("tit", EMPTY);
      key("ArrowDown");
      vi.advanceTimersByTime(45);
      expect(made.dom.querySelector(".slash-preview-title")?.textContent).toBe("Anteprima · Titolo 2");
      expect(made.dom.querySelector(".slash-sample")?.getAttribute("data-kind")).toBe("heading");
      expect(made.dom.querySelector(".slash-tip code")?.textContent).toBe("##␣");
    } finally {
      vi.useRealTimers();
    }
  });

  it("la stella mette la voce fra i preferiti", () => {
    const { made, favorites } = panel();
    made.update("tit", EMPTY);
    const star = made.dom.querySelector<HTMLButtonElement>(".slash-preview-head button")!;
    star.click();
    expect(favorites.has("markdown.heading.1")).toBe(true);
  });

  it("«Nascondi dal menu» toglie la voce e la scelta resta lì", () => {
    const { made, hidden, selected } = panel();
    made.update("tit", EMPTY);
    const hide = made.dom.querySelectorAll<HTMLButtonElement>(".slash-preview-tools button")[1]!;
    expect(hide.getAttribute("aria-label")).toBe("Nascondi dal menu");
    hide.click();
    expect(hidden.has("markdown.heading.1")).toBe(true);
    expect(made.dom.textContent).not.toContain("Titolo 1");
    expect(selected()).toContain("Titolo 2");
  });

  it("una voce con «›» apre il suo passo; Backspace torna all'elenco", () => {
    const { made, key, chosen } = panel();
    made.update("tabella", EMPTY);
    key("Enter");
    expect(made.dom.classList.contains("is-step")).toBe(true);
    expect(made.dom.querySelector(".slash-count")?.textContent).toContain("3 × 3");
    key("ArrowRight");
    key("ArrowDown");
    key("Enter");
    expect(chosen).toEqual([expect.objectContaining({ entry: expect.objectContaining({ id: "markdown.table" }), params: { rows: 4, cols: 4 } })]);
    key("Backspace");
    expect(made.dom.classList.contains("is-step")).toBe(false);
    expect(made.dom.querySelector(".slash-row")).not.toBeNull();
  });

  it("«Trasforma»: soltanto ciò che cambia le righe, il prima e il dopo, e si filtra scrivendo", () => {
    vi.useFakeTimers();
    try {
      const transform: SlashTransform = { lines: 2, before: "Uno\nDue", after: (id) => (id === "markdown.list.bullet" ? "- Uno\n- Due" : null) };
      const { made, key } = panel(transform);
      made.update("", EMPTY);
      expect(made.dom.classList.contains("is-transform")).toBe(true);
      expect(made.dom.querySelector(".slash-context")?.textContent).toBe("2 righe scelte");
      const ids = [...made.dom.querySelectorAll(".slash-row")].map((row) => row.textContent);
      expect(ids.some((text) => text?.includes("Elenco puntato"))).toBe(true);
      expect(ids.some((text) => text?.includes("Titolo 2"))).toBe(false);
      key("e");
      key("l");
      vi.advanceTimersByTime(45);
      expect(made.dom.querySelector(".slash-crumb")?.textContent).toBe("Trasforma · el");
      expect(made.dom.querySelectorAll(".slash-sample-text")[1]?.textContent).toBe("- Uno\n- Due");
    } finally {
      vi.useRealTimers();
    }
  });

  it("chiuso, non risponde più", () => {
    const { made, key } = panel();
    made.update("", EMPTY);
    made.close();
    expect(key("ArrowDown")).toBe(false);
  });
});
