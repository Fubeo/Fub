// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  resolved: new Map<string, string>(),
  scheduled: [] as Array<{ doc: string; immediate: boolean }>,
  hidden: 0,
  modifier: false,
  listeners: [] as Array<(event: { key: string }) => void>,
}));

vi.mock("../host/query", () => ({
  resolvedReference: async (target: { value: { page: string } }) => {
    const doc = calls.resolved.get(target.value.page);
    return doc ? { doc } : null;
  },
  settings: async () => [{ spec: { key: "editor.preview-modifier" }, value: calls.modifier }],
}));
vi.mock("../state/kernel", () => ({
  onEvent: (_kind: string, listener: (event: { key: string }) => void) => {
    calls.listeners.push(listener);
    return () => calls.listeners.splice(calls.listeners.indexOf(listener), 1);
  },
}));
vi.mock("../state/preview", () => ({
  schedulePreview: (doc: string, _box: HTMLElement, immediate: boolean) => calls.scheduled.push({ doc, immediate }),
  cancelScheduledPreview: () => {},
  hidePreview: () => {
    calls.hidden += 1;
  },
}));
vi.mock("../state/store", () => ({ state: { currentDoc: "Qui.md", handledExtensions: ["md"] } }));

import { linkTarget, mountLinkPreview } from "./link-preview";
import { openLifetime } from "./lifetime";

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = "";
  calls.resolved.clear();
  calls.scheduled.length = 0;
  calls.hidden = 0;
  calls.modifier = false;
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("il bersaglio di un wikilink", () => {
  it("legge pagina, heading e blocco dalla Lettura e dalla Live", () => {
    document.body.innerHTML =
      '<a class="wikilink" data-wikilink-page="Nota" data-wikilink-heading="Sez"><span>x</span></a>'
      + '<div contenteditable="true"><span data-wikilink-page="Altra" data-wikilink-block="b1">y</span>'
      + '<span data-wikilink-page="Terza" data-wikilink-heading="Titolo">z</span>'
      + '<div contenteditable="false"><a class="wikilink" data-wikilink-page="Resa">w</a></div></div><p>no</p>';
    const [reading, liveBlock, liveHeading, widget, plain] = [
      document.querySelector("a span"),
      document.querySelectorAll("[contenteditable] span")[0],
      document.querySelectorAll("[contenteditable] span")[1],
      document.querySelector('[contenteditable="false"] a'),
      document.querySelector("p"),
    ];
    expect(linkTarget(reading!)?.target).toEqual({ page: "Nota", heading: "Sez", block: null, live: false });
    expect(linkTarget(liveBlock!)?.target).toEqual({ page: "Altra", heading: null, block: "b1", live: true });
    expect(linkTarget(liveHeading!)?.target).toEqual({ page: "Terza", heading: "Titolo", block: null, live: true });
    expect(linkTarget(widget!)?.target).toEqual({ page: "Resa", heading: null, block: null, live: false });
    expect(linkTarget(plain!)).toBeNull();
  });
});

describe("l'anteprima al passaggio", () => {
  it("in Lettura apre la nota risolta, in Live solo col modificatore, e si chiude col montaggio", async () => {
    calls.resolved.set("Nota", "Cartella/Nota.md");
    document.body.innerHTML =
      '<a class="wikilink" data-wikilink-page="Nota">x</a><a class="wikilink" data-wikilink-page="Manca">m</a>'
      + '<div contenteditable="true"><span data-wikilink-page="Nota">y</span></div>';
    const life = openLifetime();
    mountLinkPreview(life);
    const [reading, missing] = Array.from(document.querySelectorAll("a"));
    const live = document.querySelector("[contenteditable] span")!;

    live.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    await settle();
    expect(calls.scheduled).toEqual([]);

    calls.resolved.set("Logo", "img/logo.png");
    const image = Object.assign(document.createElement("a"), { className: "wikilink" });
    image.dataset.wikilinkPage = "Logo";
    document.body.append(image);
    image.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    await settle();
    expect(calls.scheduled).toEqual([]);
    image.remove();

    missing!.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    await settle();
    expect(calls.scheduled).toEqual([]);
    expect(document.querySelector(".link-preview")).toBeNull();

    reading!.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    await settle();
    expect(calls.scheduled).toEqual([{ doc: "Cartella/Nota.md", immediate: false }]);
    expect(document.querySelector(".link-preview")).not.toBeNull();

    live.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, ctrlKey: true }));
    await settle();
    expect(calls.scheduled[calls.scheduled.length - 1]).toEqual({ doc: "Cartella/Nota.md", immediate: true });

    // Un clic fuori dalla scheda la chiude anche se il link non c'è più.
    reading!.remove();
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(document.querySelector(".link-preview")).toBeNull();

    life.close();
    expect(document.querySelector(".link-preview")).toBeNull();
    expect(calls.hidden).toBeGreaterThan(0);
  });

  it("con l'impostazione chiede Ctrl/Cmd anche in Lettura, e la segue quando cambia", async () => {
    calls.resolved.set("Nota", "Nota.md");
    calls.modifier = true;
    document.body.innerHTML = '<a class="wikilink" data-wikilink-page="Nota">x</a>';
    const life = openLifetime();
    mountLinkPreview(life);
    await settle();
    const reading = document.querySelector("a")!;

    reading.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    await settle();
    expect(calls.scheduled).toEqual([]);
    reading.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, metaKey: true }));
    await settle();
    expect(calls.scheduled).toEqual([{ doc: "Nota.md", immediate: true }]);

    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    calls.modifier = false;
    for (const listener of calls.listeners) listener({ key: "editor.preview-modifier" });
    await settle();
    reading.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    await settle();
    expect(calls.scheduled[calls.scheduled.length - 1]).toEqual({ doc: "Nota.md", immediate: false });

    life.close();
    expect(calls.listeners).toEqual([]);
  });
});
