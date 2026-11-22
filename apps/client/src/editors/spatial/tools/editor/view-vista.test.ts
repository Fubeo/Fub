// @vitest-environment happy-dom
// Gli interruttori della vista del Disegno completo (K6 T11, giro H) come si vedono
// nel foglio: la carta a scacchi, i contorni degli oggetti scelti e il riquadro di
// delimitazione con le sue maniglie. Sono scelte della superficie: non entrano nella
// cronologia, e spenti non lasciano niente da vedere né da prendere. Le righe della
// mappa che provano sono `view.edges` (Nascondi bordi) e `view.boundingBox` (Nascondi
// riquadro di delimitazione); la griglia di trasparenza (`view.transparencyGrid`) è
// provata da `visualizza.test.ts`, che ne fissa la voce del menu.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import type { OverlayHandle } from "../../painter/overlay";
import { SceneEngine } from "../../scene/engine";
import { doc } from "../../scene/test-support";
import { DEFAULT_GRID } from "../grid";
import { LAYER } from "../test-support";
import { createDrawEditor, type DrawEditor } from "../editor";
import { checkedGrid } from "./helpers";

// Le maniglie che l'editor passa al suo strato (il canvas non si legge dal DOM):
// `ultime` è l'ultima lista, quella che si disegna.
const disegno = vi.hoisted(() => ({ ultime: [] as OverlayHandle[] }));

vi.mock("../../painter/overlay", async (real) => {
  const modulo = await real<typeof import("../../painter/overlay")>();
  return {
    ...modulo,
    createOverlay: (host: HTMLElement, owner: Lifetime) => {
      const strato = modulo.createOverlay(host, owner);
      return {
        ...strato,
        setHandles: (handles: readonly OverlayHandle[]) => {
          disegno.ultime = [...handles];
          strato.setHandles(handles);
        },
      };
    },
  };
});

const UNO = "o1a2b3c4d";
const DUE = "o5e6f7a8b";

const SOURCE = doc(
  `<title>Prova</title>${LAYER}<rect id="${UNO}" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/></g>`,
);
/// Con il foglio del documento (il suo rettangolo `fub:role="paper"`), come un disegno vero.
const SOURCE_CON_FOGLIO = doc(
  `<title>Prova</title><rect id="fub-paper" x="0" y="0" width="200" height="200" fill="#ffffff" fub:role="paper"/>${LAYER}<rect id="${UNO}" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/></g>`,
);
const DUE_OGGETTI = doc(
  `<title>Prova</title>${LAYER}<rect id="${UNO}" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/><rect id="${DUE}" x="120" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/></g>`,
);

let host: HTMLElement;
let owner: Lifetime;
let editor: DrawEditor;

/// Un editor con lo strumento Selezione, quello che mostra la cornice e le maniglie.
function mount(source = SOURCE, grid = DEFAULT_GRID): DrawEditor {
  editor = createDrawEditor(host, SceneEngine.open(source), owner, { grid });
  editor.setTool("select");
  return editor;
}

/// Le maniglie dell'ultima lista, per tipo.
const tipi = (): string[] => disegno.ultime.map((handle) => handle.kind);

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  owner = openLifetime();
  disegno.ultime = [];
});

afterEach(() => {
  owner.close();
  host.remove();
});

describe("Nascondi bordi (K6 T11): il contorno di ogni oggetto scelto", () => {
  it("con i bordi visibili, l'oggetto scelto ha il suo contorno e la sua cornice con le maniglie", () => {
    const e = mount();
    e.select([UNO]);
    expect(tipi()).toContain("box");
    expect(tipi()).toContain("grip");
  });

  it("spento il bordo, il contorno sparisce e le maniglie restano", () => {
    const e = mount();
    e.select([UNO]);
    e.setGrid({ ...DEFAULT_GRID, hideEdges: true });
    expect(tipi()).not.toContain("box");
    expect(tipi()).toContain("grip");
  });

  it("con due oggetti scelti, il contorno di ciascuno va via e la cornice comune resta", () => {
    const e = mount(DUE_OGGETTI);
    e.select([UNO, DUE]);
    expect(tipi().filter((kind) => kind === "box")).toHaveLength(3);
    e.setGrid({ ...DEFAULT_GRID, hideEdges: true });
    // Sono rimaste solo la cornice comune e le sue maniglie.
    expect(tipi().filter((kind) => kind === "box")).toHaveLength(1);
    expect(tipi()).toContain("grip");
  });

  it("la scelta non entra nella cronologia", () => {
    const e = mount();
    e.select([UNO]);
    e.setGrid({ ...DEFAULT_GRID, hideEdges: true });
    expect(e.canUndo).toBe(false);
  });
});

describe("Nascondi riquadro di delimitazione (K6 T11): cornice, maniglie e misure", () => {
  it("spento il riquadro, la selezione non ha più maniglie, né misure, né rotore", () => {
    const e = mount();
    e.select([UNO]);
    e.setGrid({ ...DEFAULT_GRID, hideBoundingBox: true });
    expect(tipi()).not.toContain("grip");
    expect(tipi()).not.toContain("rotor");
    expect(tipi()).not.toContain("label");
  });

  it("con più oggetti scelti va via anche la cornice comune, e i contorni restano", () => {
    const e = mount(DUE_OGGETTI);
    e.select([UNO, DUE]);
    e.setGrid({ ...DEFAULT_GRID, hideBoundingBox: true });
    expect(tipi().filter((kind) => kind === "box")).toHaveLength(2);
    expect(tipi()).not.toContain("grip");
  });

  it("riaccesa, le maniglie tornano", () => {
    const e = mount();
    e.select([UNO]);
    e.setGrid({ ...DEFAULT_GRID, hideBoundingBox: true });
    e.setGrid({ ...DEFAULT_GRID, hideBoundingBox: false });
    expect(tipi()).toContain("grip");
    expect(tipi()).toContain("rotor");
  });

  it("la scelta non entra nella cronologia", () => {
    const e = mount();
    e.select([UNO]);
    e.setGrid({ ...DEFAULT_GRID, hideBoundingBox: true });
    expect(e.canUndo).toBe(false);
  });
});

describe("Mostra griglia trasparenza (K6 T11): la carta a scacchi", () => {
  it("accesa, la superficie ha l'attributo che il CSS dipinge a scacchi sulle carte, e spenta lo toglie", () => {
    const e = mount(SOURCE, { ...DEFAULT_GRID, transparencyGrid: true });
    const superficie = host.querySelector(".draw-surface");
    expect(superficie?.hasAttribute("data-transparency")).toBe(true);
    e.setGrid({ ...DEFAULT_GRID });
    expect(superficie?.hasAttribute("data-transparency")).toBe(false);
  });

  it("spenta di serie, la superficie è quella di sempre", () => {
    mount();
    expect(host.querySelector(".draw-surface")?.hasAttribute("data-transparency")).toBe(false);
  });

  it("il foglio del documento porta il marchio che il CSS rende senza fondo, e le sue forme restano", () => {
    mount(SOURCE_CON_FOGLIO, { ...DEFAULT_GRID, transparencyGrid: true });
    expect(host.querySelector("[data-paper]")).not.toBeNull();
    expect(host.querySelector('[data-scene-id="' + UNO + '"]')).not.toBeNull();
  });

  it("la scelta non entra nella cronologia", () => {
    const e = mount();
    e.select([UNO]);
    e.setGrid({ ...DEFAULT_GRID, transparencyGrid: true });
    expect(e.canUndo).toBe(false);
  });
});

describe("gli interruttori si ricordano nella griglia, come la griglia", () => {
  it("una griglia con l'interruttore acceso lo tiene, e uno spento torna assente", () => {
    expect(checkedGrid({ ...DEFAULT_GRID, transparencyGrid: true, hideEdges: true, hideBoundingBox: true }, DEFAULT_GRID)).toMatchObject({
      transparencyGrid: true,
      hideEdges: true,
      hideBoundingBox: true,
    });
    const spenta = checkedGrid({ ...DEFAULT_GRID, transparencyGrid: false, hideEdges: false }, { ...DEFAULT_GRID, transparencyGrid: true, hideEdges: true });
    expect(spenta).not.toHaveProperty("transparencyGrid");
    expect(spenta).not.toHaveProperty("hideEdges");
  });

  it("un valore che non è vero o falso lascia quello di prima", () => {
    const prima = { ...DEFAULT_GRID, hideBoundingBox: true };
    const letta = checkedGrid({ ...DEFAULT_GRID, hideBoundingBox: "forse" as unknown as boolean }, prima);
    expect(letta.hideBoundingBox).toBe(true);
  });
});
