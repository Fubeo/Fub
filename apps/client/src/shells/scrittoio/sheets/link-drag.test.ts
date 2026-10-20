// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkTarget, ResolvedRef } from "../../../host/contract";
import { pointer } from "../../../kit/testing";
import { ENTRIES_DRAG_TYPE, NOTE_DRAG_TYPE } from "../../../ui/drag-types";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";

const world = vi.hoisted(() => ({
  resolved: new Map<string, ResolvedRef | null>(),
  pending: [] as Array<() => void>,
}));

vi.mock("../../../host/query", () => ({
  resolvedReference: (target: LinkTarget) => {
    const key = target.kind === "wiki" ? target.value.page : "";
    return new Promise<ResolvedRef | null>((done) => world.pending.push(() => done(world.resolved.get(key) ?? null)));
  },
}));
vi.mock("../../../state/layout", () => ({ activeDoc: () => "Corrente.md" }));
// Ciò che la scheda sui collegamenti porta con sé e qui non serve.
vi.mock("../../../state/store", () => ({ state: {} }));
vi.mock("../../../state/vault", () => ({ createNote: async () => "" }));
vi.mock("../launcher/actions", () => ({ openNote: async () => {} }));
vi.mock("../../../ui/notify", () => ({ notify: () => {} }));

import { mountLinkDrag } from "./link-drag";

let life: Lifetime;

function readingLink(page: string): HTMLElement {
  const preview = document.createElement("div");
  preview.className = "markdown-preview";
  const a = document.createElement("a");
  a.className = "wikilink";
  a.href = "#";
  a.dataset.wikilinkPage = page;
  a.textContent = page;
  preview.append(a);
  document.getElementById("panes")!.append(preview);
  return a;
}

function drag(target: HTMLElement): Map<string, string> {
  const data = new Map<string, string>();
  const transfer = { effectAllowed: "all", setData: (type: string, value: string) => void data.set(type, value) };
  const event = new Event("dragstart", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  target.dispatchEvent(event);
  return data;
}

async function settle(): Promise<void> {
  for (const done of world.pending.splice(0)) done();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  document.body.innerHTML = `<div id="panes"></div>`;
  world.resolved.clear();
  world.pending.length = 0;
  life = openLifetime();
  mountLinkDrag(life);
});

afterEach(() => life.close());

describe("trascinare un collegamento della Lettura", () => {
  it("porta la nota che il collegamento nomina, come dall'albero", async () => {
    world.resolved.set("Nota", { doc: "Guida/Nota.md" });
    const link = readingLink("Nota");
    link.dispatchEvent(pointer("pointerdown"));
    await settle();
    const data = drag(link);
    expect(data.get(NOTE_DRAG_TYPE)).toBe("Guida/Nota.md");
    expect(JSON.parse(data.get(ENTRIES_DRAG_TYPE)!)).toEqual([{ id: "Guida/Nota.md", note: true }]);
  });

  it("un collegamento che non trova la nota resta il trascinamento del browser", async () => {
    const link = readingLink("Assente");
    link.dispatchEvent(pointer("pointerdown"));
    await settle();
    expect(drag(link).size).toBe(0);
  });

  it("una risposta arrivata per un collegamento premuto prima non vale", async () => {
    world.resolved.set("Prima", { doc: "Prima.md" });
    world.resolved.set("Dopo", { doc: "Dopo.md" });
    const first = readingLink("Prima");
    const second = readingLink("Dopo");
    first.dispatchEvent(pointer("pointerdown"));
    second.dispatchEvent(pointer("pointerdown"));
    await settle();
    expect(drag(first).size).toBe(0);
    expect(drag(second).get(NOTE_DRAG_TYPE)).toBe("Dopo.md");
  });

  it("in Live il collegamento è testo dell'editor e non si tocca", async () => {
    world.resolved.set("Nota", { doc: "Nota.md" });
    const span = document.createElement("span");
    span.className = "cm-fub-wikilink";
    span.dataset.wikilinkPage = "Nota";
    document.getElementById("panes")!.append(span);
    span.dispatchEvent(pointer("pointerdown"));
    await settle();
    expect(world.pending).toHaveLength(0);
    expect(drag(span).size).toBe(0);
  });
});
