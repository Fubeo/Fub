// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { calls, outcome, delivered, saved } = vi.hoisted(() => ({
  calls: [] as Array<{ id: string; args: Record<string, unknown>; mode: string }>,
  outcome: { value: null as unknown },
  delivered: [] as string[],
  saved: [] as Array<{ title: string; target: unknown }>,
}));
vi.mock("../host/ipc", () => ({
  api: {
    invokeCommand: async (id: string, args: Record<string, unknown>, mode: string) => {
      calls.push({ id, args, mode });
      return outcome.value;
    },
  },
}));
vi.mock("../ui/palette", () => ({
  planLines: (plan: { docs: string[] }) => plan.docs.map((doc) => `${doc}: 1 modifica`),
  deliverOutcome: async (_outcome: unknown, _host: unknown, id: string) => void delivered.push(id),
}));
vi.mock("../state/palette-host", () => ({
  paletteHost: { onEffect: () => {}, notify: () => {}, flushPendingSave: async () => [] as string[] },
}));
vi.mock("../state/bookmarks", () => ({
  addBookmark: (title: string, target: unknown) => (saved.push({ title, target }), { id: "b1" }),
}));
vi.mock("../ui/dialogs", () => ({ promptText: async () => "Le mie note" }));
vi.mock("../ui/notify", () => ({ notify: () => {} }));

import { openLifetime, type Lifetime } from "../ui/lifetime";
import { mountSearchTools, type Replacement, type SearchTools } from "./search-tools";

const PLAN = {
  notify: null,
  undo: null,
  effect: { kind: "plan", summary: "2 sostituzioni in 1 nota", docs: ["a.md"], edits: [] },
};

let life: Lifetime;
let tools: SearchTools;
let reruns = 0;
let target: Replacement;

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((b) => b.textContent === text);
  if (!found) throw new Error(`manca il pulsante «${text}»`);
  return found;
}

beforeEach(() => {
  document.body.innerHTML = `<aside><input id="search-input" value="foo" /></aside>`;
  calls.length = 0;
  delivered.length = 0;
  saved.length = 0;
  reruns = 0;
  outcome.value = PLAN;
  target = { find: "foo", docs: ["a.md"], wholeWord: false };
  life = openLifetime();
  tools = mountSearchTools(life, {
    input: document.querySelector<HTMLInputElement>("#search-input")!,
    rerun: () => void reruns++,
    replacement: async () => target,
  });
});

afterEach(() => life.close());

describe("le opzioni", () => {
  it("un interruttore preme, rilancia la ricerca e lo dice a chi legge", () => {
    const aa = button("Aa");
    expect(aa.getAttribute("aria-pressed")).toBe("false");
    aa.click();
    expect(aa.getAttribute("aria-pressed")).toBe("true");
    expect(tools.options().caseSensitive).toBe(true);
    expect(reruns).toBe(1);
    aa.click();
    expect(tools.options().caseSensitive).toBe(false);
  });

  it("ogni interruttore ha un nome completo, non solo il glifo", () => {
    for (const glyph of ["Aa", "ab|", ".*", "~"]) {
      expect(button(glyph).getAttribute("aria-label")?.length).toBeGreaterThan(3);
    }
  });

  it("stanno dietro «Opzioni», che dice quante ne sono accese", () => {
    const toggle = button("Opzioni");
    const group = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(group.hidden).toBe(true);
    expect(group.contains(button("Aa"))).toBe(true);
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(group.hidden).toBe(false);
    button("Aa").click();
    button(".*").click();
    expect(toggle.textContent).toBe("Opzioni · 2");
    toggle.click();
    expect(group.hidden).toBe(true);
  });

  it("reset le spegne tutte", () => {
    button(".*").click();
    tools.reset();
    expect(tools.options().regex).toBe(false);
    expect(button(".*").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("sostituisci", () => {
  function open(): HTMLInputElement {
    button("Sostituisci").click();
    const field = document.querySelector<HTMLInputElement>("#search-replace-input")!;
    field.value = "bar";
    return field;
  }

  it("si apre con aria-expanded e il campo ha la sua etichetta", () => {
    const toggle = button("Sostituisci");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    open();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector("label[for='search-replace-input']")).not.toBeNull();
  });

  it("l'anteprima chiede il piano in dry_run, e non scrive niente", async () => {
    open();
    button("Anteprima…").click();
    await settle();
    expect(calls).toEqual([
      { id: "vault.replace", args: { find: "foo", replace: "bar", docs: ["a.md"] }, mode: "dry_run" },
    ]);
    expect(document.querySelector(".search-replace-plan")?.textContent).toContain("2 sostituzioni in 1 nota");
    expect(document.querySelector(".search-replace-docs")?.textContent).toContain("a.md");
  });

  it("«Applica» riusa gli argomenti del piano letto, anche se la casella è cambiata", async () => {
    const field = open();
    button("Anteprima…").click();
    await settle();
    // Il campo è cambiato dopo l'anteprima: il piano non vale più, «Applica» sparisce.
    field.value = "baz";
    field.dispatchEvent(new Event("input"));
    expect([...document.querySelectorAll("button")].some((b) => b.textContent === "Applica")).toBe(false);
    button("Anteprima…").click();
    await settle();
    button("Applica").click();
    await settle();
    const last = calls[calls.length - 1]!;
    expect(last.mode).toBe("apply");
    expect(last.args).toMatchObject({ find: "foo", replace: "baz" });
    expect(delivered).toEqual(["vault.replace"]);
    expect(reruns).toBe(1);
  });

  it("whole_word parte solo se la parola intera è accesa", async () => {
    target = { find: "foo", docs: ["a.md"], wholeWord: true };
    open();
    button("Anteprima…").click();
    await settle();
    expect(calls[0]!.args).toMatchObject({ whole_word: true });
  });

  it("una query che non è testo semplice lo dice e non chiede niente", async () => {
    target = { reason: "not_text" };
    open();
    button("Anteprima…").click();
    await settle();
    expect(calls).toEqual([]);
    expect(document.querySelector(".search-replace-note")?.textContent).toContain("testo semplice");
  });

  it("nessuna nota da modificare: niente «Applica»", async () => {
    outcome.value = { ...PLAN, effect: { kind: "plan", summary: "0", docs: [], edits: [] } };
    open();
    button("Anteprima…").click();
    await settle();
    expect([...document.querySelectorAll("button")].some((b) => b.textContent === "Applica")).toBe(false);
    expect(document.querySelector(".search-replace-note")?.textContent).toContain("Niente da sostituire");
  });

  it("«Annulla» scarta il piano", async () => {
    open();
    button("Anteprima…").click();
    await settle();
    button("Annulla").click();
    expect(document.querySelector(".search-replace-plan")?.children.length).toBe(0);
  });
});

describe("salva ricerca", () => {
  it("la salva come segnalibro di ricerca col nome scelto", async () => {
    button("Salva ricerca").click();
    await settle();
    expect(saved).toEqual([{ title: "Le mie note", target: { k: "search", query: "foo" } }]);
  });
});
