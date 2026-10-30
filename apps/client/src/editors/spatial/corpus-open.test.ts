// @vitest-environment happy-dom
// Il cancello di N1 (ADR 0231): ogni disegno del corpus si apre nel Disegno,
// in Lettura e come sorgente, e chi lo apre senza cambiarlo non scrive
// niente: il buffer resta coi byte del file, che salvato torna uguale.
//
// Il corpus: le fixture della scena scritte da FubDraw (tavole, connettori,
// simboli, ripetizioni, risorse, testo), i modelli di «Nuovo disegno», gli
// SVG di altri programmi di `crates/fub-scene/tests/corpus/` e l'icona del
// clipper. Si leggono da dove stanno, col `?raw` di Vite: `vite.config.ts`
// apre a Vitest le cartelle fuori dal client.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeHost, type FakeHost } from "../../host/fake";
import type { EditorSurface } from "../core/registry";
import type { EditorChange } from "../core/text-operation";
import { mountSvgSurface } from "../text/profiles/svg";
import { mountVectorSurface } from "./surface";

const box = vi.hoisted(() => ({ host: null as FakeHost | null }));

vi.mock("../../host/ipc", () => {
  const now = () => {
    if (!box.host) throw new Error("l'host finto non è stato montato");
    return box.host.module;
  };
  return {
    api: new Proxy(
      {},
      {
        get: (_t, name: string) => (...args: unknown[]) =>
          (now().api as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args),
      },
    ),
    onKernelEvent: (handler: (n: unknown) => void) => now().onKernelEvent(handler as never),
  };
});

const SOURCES = {
  ...import.meta.glob("../../__fixtures__/scene/*.svg", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("../../../../../crates/fub-features/templates/*.svg", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("../../../../../crates/fub-scene/tests/corpus/*.svg", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("../../../../clipper/icons/icon.svg", { query: "?raw", import: "default", eager: true }),
} as Record<string, string>;
/// Le chiavi senza i `../` davanti, per i nomi dei casi.
const CORPUS = Object.entries(SOURCES).map(([path, text]) => [path.replace(/^(\.\.\/)+/, ""), text] as const);

/// I caratteri dell'app, già letti e vuoti: happy-dom non ha il server
/// dell'app da cui leggerli.
const NO_FONTS = { now: () => "", load: async () => "" };

let parent: HTMLElement;
let surface: EditorSurface | null;

beforeEach(() => {
  box.host = createFakeHost();
  parent = document.createElement("div");
  document.body.append(parent);
  surface = null;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:corpus");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  surface?.destroy();
  parent.remove();
  vi.restoreAllMocks();
});

describe("il corpus dei disegni", () => {
  it("ha i file di FubDraw, i modelli e quelli di altri programmi", () => {
    const paths = CORPUS.map(([path]) => path);
    expect(paths.filter((path) => path.includes("__fixtures__/scene/")).length).toBeGreaterThanOrEqual(13);
    expect(paths.filter((path) => path.includes("fub-features/templates/")).length).toBeGreaterThanOrEqual(14);
    expect(paths.filter((path) => path.includes("fub-scene/tests/corpus/")).length).toBeGreaterThanOrEqual(5);
    expect(paths.some((path) => path.endsWith("clipper/icons/icon.svg"))).toBe(true);
  });

  it.each(CORPUS)("%s si apre nel Disegno e in Lettura senza cambiare un byte", (path, text) => {
    const changes: EditorChange[] = [];
    surface = mountVectorSurface(
      { paneId: "p1", documentId: `disegni/${path.split("/").pop()}`, parent },
      { onChange: (change) => changes.push(change), onSelectionChange: () => {}, fonts: NO_FONTS },
    );
    surface.buffer!.setDoc(text);
    surface.setMode!("read");
    surface.setMode!("draw");
    // Una scena si disegna nell'editor; un file in sola lettura (un DOCTYPE)
    // è l'immagine intera: o l'una o l'altra, mai il vuoto.
    expect(parent.querySelector(".draw-editor svg, .vector-read img")).not.toBeNull();
    expect(changes).toEqual([]);
    expect(surface.buffer!.getDoc()).toBe(text);
  });

  it.each(CORPUS)("%s si apre come sorgente senza cambiare un byte", (path, text) => {
    const changes: EditorChange[] = [];
    surface = mountSvgSurface(
      { paneId: "p1", documentId: `disegni/${path.split("/").pop()}`, parent },
      { onChange: (change) => changes.push(change), onSelectionChange: () => {} },
    );
    surface.buffer!.setDoc(text);
    expect(changes).toEqual([]);
    expect(surface.buffer!.getDoc()).toBe(text);
  });
});
