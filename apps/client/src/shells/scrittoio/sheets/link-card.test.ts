// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkTarget, ResolvedRef } from "../../../host/contract";
import { HOVER_OPEN_DELAY_MS } from "../../../kit/hover-card";
import { pointer } from "../../../kit/testing";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";

const world = vi.hoisted(() => ({
  resolved: new Map<string, ResolvedRef | null>(),
  asked: [] as Array<{ target: LinkTarget; from: string | undefined }>,
  embeds: [] as Array<[string, string | null, string | null]>,
  opened: [] as Array<[string, string]>,
  created: [] as Array<[string | undefined, string | undefined]>,
}));

vi.mock("../../../host/query", () => ({
  resolvedReference: async (target: LinkTarget, from?: string) => {
    world.asked.push({ target, from });
    const key = target.kind === "wiki" ? target.value.page : target.kind === "path" ? target.value : "";
    return world.resolved.get(key) ?? null;
  },
  renderEmbed: async (doc: string, heading: string | null, block: string | null) => {
    world.embeds.push([doc, heading, block]);
    return { doc_id: doc, html: `<p>Dentro ${doc} <a href="x.md">un link</a></p><script>alert(1)</script>`, parts: [] };
  },
}));
vi.mock("../../../state/layout", () => ({ activeDoc: () => "Corrente.md" }));
vi.mock("../../../state/store", () => ({ state: { activeSpace: "Diario" } }));
vi.mock("../../../state/vault", () => ({
  createNote: async (name?: string, folder?: string) => {
    world.created.push([name, folder]);
    return `${folder}/${name}.md`;
  },
}));
vi.mock("../launcher/actions", () => ({
  openNote: async (doc: string, way: string) => void world.opened.push([doc, way]),
}));
vi.mock("../../../ui/notify", () => ({ notify: () => {} }));

import { linkAtCaret, linkOf, mountLinkCards } from "./link-card";

let life: Lifetime;

function wikilink(page: string, extra: Record<string, string> = {}, cls = "cm-fub-wikilink"): HTMLElement {
  const el = document.createElement("span");
  el.className = cls;
  el.dataset.wikilinkPage = page;
  for (const [key, value] of Object.entries(extra)) el.dataset[key] = value;
  document.getElementById("panes")!.append(el);
  return el;
}

async function hover(target: HTMLElement): Promise<HTMLElement | null> {
  target.dispatchEvent(pointer("pointerover"));
  await vi.advanceTimersByTimeAsync(HOVER_OPEN_DELAY_MS);
  await vi.advanceTimersByTimeAsync(0);
  return document.querySelector<HTMLElement>(".kit-hover-card");
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `<div id="panes"></div>`;
  world.resolved.clear();
  world.asked.length = 0;
  world.embeds.length = 0;
  world.opened.length = 0;
  world.created.length = 0;
  life = openLifetime();
  mountLinkCards(life);
});

afterEach(() => {
  life.close();
  vi.useRealTimers();
});

describe("che cosa nomina un collegamento", () => {
  it("un wikilink porta pagina, titolo e blocco", () => {
    const link = linkOf(wikilink("Nota", { wikilinkHeading: "Sezione", wikilinkBlock: "b1" }));
    expect(link).toEqual({
      target: { kind: "wiki", value: { page: "Nota", heading: "Sezione", block: "b1" } },
      heading: "Sezione",
      block: "b1",
    });
  });

  it("un collegamento interno porta il percorso", () => {
    const el = document.createElement("a");
    el.dataset.path = "Guida/Nota.md";
    expect(linkOf(el)?.target).toEqual({ kind: "path", value: "Guida/Nota.md" });
  });

  it("un wikilink vuoto non nomina niente", () => {
    expect(linkOf(wikilink("  "))).toBeNull();
  });
});

describe("la scheda", () => {
  it("risolve dal documento che ha il fuoco e rende il ritaglio, con i collegamenti spenti", async () => {
    world.resolved.set("Nota", { doc: "Guida/Nota.md" });
    const card = await hover(wikilink("Nota", { wikilinkHeading: "Sezione" }));
    expect(world.asked[0]).toMatchObject({ from: "Corrente.md" });
    expect(world.embeds).toEqual([["Guida/Nota.md", "Sezione", null]]);
    expect(card?.querySelector(".link-card-title")?.textContent).toBe("Nota");
    expect(card?.querySelector(".link-card-where")?.textContent).toBe("Guida");
    const body = card!.querySelector(".link-card-body")!;
    expect(body.textContent).toContain("Dentro Guida/Nota.md");
    expect(body.querySelector("script")).toBeNull();
    expect(body.querySelector("a")?.hasAttribute("href")).toBe(false);
  });

  it("i tre gesti aprono dove dicono", async () => {
    world.resolved.set("Nota", { doc: "Nota.md" });
    const card = (await hover(wikilink("Nota")))!;
    const buttons = [...card.querySelectorAll<HTMLButtonElement>(".link-card-action")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Apri", "Di fianco", "Nuova linguetta"]);
    for (const button of buttons) button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(world.opened).toEqual([["Nota.md", "here"], ["Nota.md", "split"], ["Nota.md", "tab"]]);
  });

  it("un collegamento irrisolto offre «Crea», e la nota nasce nello spazio attivo", async () => {
    const card = (await hover(wikilink("Nuova idea")))!;
    expect(card.querySelector(".link-card-note")?.textContent).toContain("non esiste");
    expect(world.embeds).toEqual([]);
    const buttons = card.querySelectorAll<HTMLButtonElement>(".link-card-action");
    expect(buttons).toHaveLength(1);
    buttons[0]!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(world.created).toEqual([["Nuova idea", "Diario"]]);
    expect(world.opened).toEqual([["Diario/Nuova idea.md", "here"]]);
  });

  it("passare su ciò che non è un collegamento non apre niente", async () => {
    const plain = document.createElement("span");
    document.getElementById("panes")!.append(plain);
    expect(await hover(plain)).toBeNull();
  });
});

describe("da tastiera, in Live", () => {
  /// Un wikilink dentro il contenuto di un editor, col cursore nel suo testo.
  function caretIn(page: string): { content: HTMLElement; link: HTMLElement } {
    const content = document.createElement("div");
    content.className = "cm-content";
    content.contentEditable = "true";
    document.getElementById("panes")!.append(content);
    const link = document.createElement("span");
    link.className = "cm-fub-wikilink";
    link.dataset.wikilinkPage = page;
    link.textContent = page;
    content.append("prima ", link, " dopo");
    content.focus();
    document.getSelection()!.collapse(link.firstChild!, 2);
    return { content, link };
  }
  const altEnter = (on: HTMLElement, extra: KeyboardEventInit = {}) =>
    on.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", altKey: true, shiftKey: true, bubbles: true, cancelable: true, ...extra,
    }));

  it("Maiusc+Alt+Invio col cursore nel collegamento apre la scheda col fuoco su «Apri»", async () => {
    world.resolved.set("Nota", { doc: "Cartella/Nota.md" } as ResolvedRef);
    const { content, link } = caretIn("Nota");
    expect(linkAtCaret(document.getElementById("panes")!)).toBe(link);
    expect(altEnter(content)).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    const card = document.querySelector<HTMLElement>(".kit-hover-card");
    expect(card).not.toBeNull();
    expect(document.activeElement?.textContent).toBe("Apri");
    (document.activeElement as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(world.opened).toEqual([["Cartella/Nota.md", "here"]]);
  });

  it("fuori da un collegamento, o con un altro modificatore, il tasto resta all'editor", async () => {
    const { content } = caretIn("Nota");
    document.getSelection()!.collapse(content.firstChild!, 1);
    expect(linkAtCaret(document.getElementById("panes")!)).toBeNull();
    expect(altEnter(content)).toBe(true);
    const again = caretIn("Altra");
    expect(altEnter(again.content, { ctrlKey: true })).toBe(true);
    // Alt+Invio da solo è di `open-link.ts`: apre il collegamento.
    expect(altEnter(again.content, { shiftKey: false })).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector(".kit-hover-card")).toBeNull();
  });
});
