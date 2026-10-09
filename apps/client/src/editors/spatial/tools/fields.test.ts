// I campi del pannello delle proprietà: dalla selezione e dal documento ai
// campi, coi nomi, le unità, i limiti e ciò che il livello offre; e dal
// valore scritto al cambio dell'aspetto o del contorno.

import { describe, expect, it } from "vitest";
import { BLEND_MODES } from "../scene/values";
import type { LengthUnit } from "../scene/rulers";
import {
  BLEND_GROUPS,
  BLEND_LABELS,
  lookAction,
  lookChange,
  outlineChange,
  propertiesView,
  shapeChange,
  sheetChange,
  tipChange,
  typedOpacity,
  type BoardFacts,
  type FieldsInput,
  type SelectionFacts,
  type StyleFacts,
} from "./fields";
import type { Frame } from "./frame";
import { DEFAULT_GRID } from "./grid";
import type { Look } from "./look";
import { NAME_MAX } from "./naming";
import type { ChoiceState, MenuChoiceState, NumberState, SegmentState, SwitchState, TogglesState } from "./properties";
import { featuresFor, type Level } from "./registry";
import type { ShapeFacts } from "./reshape";
import type { DocumentStyle, StyleField, StyleRow } from "./styles";
import { fieldMin, fromUnit } from "./rulers";
import type { EndLook, TipsLook } from "./tips";

const NONE = { count: 0, value: null };

/// Un aspetto in cui nessuno ha niente, tranne `parts`.
const look = (parts: Partial<Look> = {}): Look => ({
  fill: NONE,
  stroke: NONE,
  width: NONE,
  opacity: NONE,
  blend: NONE,
  isolate: NONE,
  family: NONE,
  size: NONE,
  weight: NONE,
  italic: NONE,
  underline: NONE,
  strike: NONE,
  leading: NONE,
  spacing: NONE,
  anchor: NONE,
  form: NONE,
  wrap: NONE,
  samples: new Map(),
  ...parts,
});

/// Un rettangolo di 20 × 10, ruotato di 90° in senso orario attorno
/// all'origine e spostato in (50, 10).
const TURNED: Frame = { matrix: [0, 1, -1, 0, 50, 10], box: { min: [0, 0], max: [20, 10] }, geometry: { min: [1, 1], max: [19, 9] } };

/// Una linea dritta: la sua geometria non ha altezza.
const LINE: Frame = { matrix: [1, 0, 0, 1, 0, 0], box: { min: [0, -1], max: [40, 1] }, geometry: { min: [0, 0], max: [40, 0] } };

const selection = (parts: Partial<SelectionFacts> = {}): SelectionFacts => ({
  keys: "oa1a1a1a1",
  subject: "Rettangolo",
  count: 1,
  frame: TURNED,
  ratio: false,
  look: look(),
  outline: null,
  alignable: true,
  drawn: 1,
  orders: new Set(),
  shape: null,
  ...parts,
});

const input = (parts: Partial<FieldsInput> & { readonly level?: Level } = {}): FieldsInput => {
  const { level = "standard", ...rest } = parts;
  return {
    features: featuresFor(level),
    unit: "px",
    editable: true,
    selection: null,
    document: { page: { width: 400, height: 300 }, boards: false, desc: "" },
    grid: DEFAULT_GRID,
    bar: true,
    attributes: false,
    tool: null,
    board: null,
    swatches: [],
    recent: [],
    paper: "#ffffff",
    colors: null,
    gradient: null,
    hatch: null,
    ...rest,
  };
};

const number = (state: unknown): NumberState => state as NumberState;
const options = (state: unknown): ChoiceState["options"] | SegmentState["options"] => (state as ChoiceState | SegmentState).options;

describe("senza selezione, il disegno", () => {
  it("ha la pagina nell'unità del documento, l'unità, la descrizione e la vista", () => {
    const view = propertiesView(input({ unit: "mm", document: { page: { width: fromUnit(210, "mm"), height: fromUnit(297, "mm") }, boards: false, desc: "Una prova" } }));
    expect(view.subject).toBe("Il disegno");
    expect(view.key).toBe("document\nmm");
    expect(view.attributes).toBe(false);
    const width = number(view.fields.pageWidth);
    expect([width.label, width.value, width.unit, width.places, width.relative, width.min]).toEqual(["Larghezza della pagina", expect.closeTo(210, 9), "mm", 3, true, fieldMin(1, "mm")]);
    expect(number(view.fields.pageHeight).value).toBeCloseTo(297, 9);
    expect(view.fields.pagePreset).toMatchObject({ kind: "choice", label: "Formato della pagina", value: "a4" });
    expect(view.fields.pageOrientation).toMatchObject({ kind: "segment", label: "Orientamento della pagina", value: "portrait" });
    expect(view.fields.unit).toMatchObject({ kind: "choice", value: "mm" });
    expect(options(view.fields.unit).map((option) => option.value)).toEqual(["px", "mm", "cm", "in", "pt"]);
    expect(view.fields.desc).toMatchObject({ kind: "text", value: "Una prova" });
    expect(Object.keys(view.fields).filter((id) => view.fields[id as keyof typeof view.fields]?.kind === "switch")).toEqual([
      "grid",
      "snap",
      "guides",
      "rulers",
      "rulerGuides",
      "bar",
    ]);
    expect(view.actions).toEqual({});
  });

  it("senza pagina non ha i suoi lati, e la vista ha solo ciò che il livello offre", () => {
    const view = propertiesView(input({ level: "essential", bar: false, document: { page: null, boards: false, desc: "" } }));
    expect(view.fields.pageWidth).toBeUndefined();
    expect(view.fields.pagePreset).toBeUndefined();
    expect(view.fields.unit).toBeDefined();
    expect(["grid", "snap", "guides", "rulers", "rulerGuides", "bar"].filter((id) => id in view.fields)).toEqual([]);
  });

  it("con le tavole la pagina è la tela: ha i lati, non la misura pronta né il verso", () => {
    const view = propertiesView(input({ document: { page: { width: 2560, height: 1024 }, boards: true, desc: "" } }));
    expect(number(view.fields.pageWidth).value).toBe(2560);
    expect(view.fields.pagePreset).toBeUndefined();
    expect(view.fields.pageOrientation).toBeUndefined();
  });

  it("gli interruttori dicono la vista di adesso", () => {
    const view = propertiesView(input({ grid: { ...DEFAULT_GRID, shown: true, bar: false } }));
    expect(view.fields.grid).toMatchObject({ on: true });
    expect(view.fields.snap).toMatchObject({ on: false });
    expect(view.fields.bar).toMatchObject({ on: false });
  });
});

describe("la tavola dello strumento Tavola", () => {
  /// Una tavola A4 coricata, la seconda di tre.
  const board = (parts: Partial<BoardFacts> = {}): BoardFacts => ({ id: "b1a2b3c4d", name: "Copertina", rect: [10, 20, 1122.52, 793.7], index: 2, count: 3, ...parts });

  it("ha il nome, la misura pronta, il verso, il posto e le misure, prima del documento", () => {
    const view = propertiesView(input({ board: board(), document: { page: { width: 2560, height: 1024 }, boards: true, desc: "" } }));
    expect(view.subject).toBe("Tavola 2 di 3");
    expect(view.key).toBe("board\npx\nb1a2b3c4d");
    expect(view.fields.boardName).toEqual({ kind: "line", label: "Nome", value: "Copertina", max: NAME_MAX });
    expect(view.fields.boardPreset).toMatchObject({ kind: "choice", label: "Formato", value: "a4" });
    expect(view.fields.boardOrientation).toMatchObject({ kind: "segment", label: "Orientamento", value: "landscape" });
    expect((view.fields.boardOrientation as SegmentState).disabled).toBeUndefined();
    expect(options(view.fields.boardOrientation).map((option) => [option.value, option.label])).toEqual([
      ["portrait", "Verticale"],
      ["landscape", "Orizzontale"],
    ]);
    expect([number(view.fields.boardX).label, number(view.fields.boardX).value, number(view.fields.boardY).value]).toEqual(["X", 10, 20]);
    const width = number(view.fields.boardWidth);
    expect([width.label, width.value, width.relative, width.min]).toEqual(["Larghezza", 1122.52, true, fieldMin(1, "px")]);
    expect(number(view.fields.boardHeight).value).toBe(793.7);
    // Il documento e la vista restano, sotto.
    expect(view.fields.unit).toBeDefined();
    expect(view.fields.grid).toBeDefined();
  });

  it("dice ogni misura pronta coi numeri che darebbe, nel verso di adesso e nella sua unità", () => {
    const labels = options(propertiesView(input({ board: board() })).fields.boardPreset).map((option) => option.label);
    expect(labels).toEqual([
      "A3 (420 × 297 mm)",
      "A4 (297 × 210 mm)",
      "A5 (210 × 148 mm)",
      "Lettera (11 × 8,5 in)",
      "Legale (14 × 8,5 in)",
      "Tabloid (17 × 11 in)",
      "HD 16:9 (1280 × 720 px)",
      "Full HD 16:9 (1920 × 1080 px)",
      "Schermo 4:3 (1024 × 768 px)",
      "Telefono (844 × 390 px)",
      "Quadrato (1080 × 1080 px)",
      "Disegno nuovo (1600 × 1000 px)",
    ]);
    // In piedi, ogni misura si dice in piedi.
    const standing = options(propertiesView(input({ board: board({ rect: [0, 0, 100, 300] }) })).fields.boardPreset);
    expect(standing[1]!.label).toBe("A4 (210 × 297 mm)");
    expect(standing[9]!.label).toBe("Telefono (390 × 844 px)");
  });

  it("una tavola di nessuna misura pronta è su misura, e una quadrata non ha verso", () => {
    const view = propertiesView(input({ board: board({ rect: [0, 0, 500, 500] }) }));
    expect(view.fields.boardPreset).toMatchObject({ value: "custom" });
    expect(options(view.fields.boardPreset).slice(-1)).toEqual([{ value: "custom", label: "Su misura" }]);
    expect(view.fields.boardOrientation).toMatchObject({ value: null, disabled: true });
    expect(options(propertiesView(input({ board: board() })).fields.boardPreset).some((option) => option.value === "custom")).toBe(false);
  });

  it("le lunghezze sono nell'unità del documento", () => {
    const view = propertiesView(input({ unit: "mm", board: board() }));
    expect(number(view.fields.boardWidth).value).toBeCloseTo(297, 2);
    expect(number(view.fields.boardX).unit).toBe("mm");
    expect(number(view.fields.boardHeight).min).toBe(fieldMin(1, "mm"));
  });

  it("con una selezione non c'è", () => {
    const view = propertiesView(input({ board: board(), selection: selection() }));
    expect(["boardName", "boardPreset", "boardOrientation", "boardX", "boardY", "boardWidth", "boardHeight"].filter((id) => id in view.fields)).toEqual([]);
    expect(view.subject).toBe("Rettangolo");
  });

  it("dal valore al rettangolo: l'angolo in alto a sinistra resta", () => {
    const rect = [10, 20, 1122.52, 793.7] as const;
    expect(sheetChange("boardPreset", "hd", rect, "px")).toEqual([10, 20, 1280, 720]);
    expect(sheetChange("pagePreset", "phone", rect, "px")).toEqual([10, 20, 844, 390]);
    expect(sheetChange("boardPreset", "custom", rect, "px")).toBeNull();
    expect(sheetChange("boardOrientation", "portrait", rect, "px")).toEqual([10, 20, 793.7, 1122.52]);
    expect(sheetChange("pageOrientation", "landscape", rect, "px")).toEqual(rect);
    expect(sheetChange("boardOrientation", "square", rect, "px")).toBeNull();
    expect(sheetChange("boardX", 1, rect, "in")).toEqual([96, 20, 1122.52, 793.7]);
    expect(sheetChange("boardY", -5, rect, "px")).toEqual([10, -5, 1122.52, 793.7]);
    expect(sheetChange("boardWidth", 100, rect, "mm")).toEqual([10, 20, 377.95, 793.7]);
    expect(sheetChange("boardHeight", 0, rect, "px")).toEqual([10, 20, 1122.52, 1]);
    expect(sheetChange("boardWidth", Number.NaN, rect, "px")).toBeNull();
    expect(sheetChange("boardWidth", "100", rect, "px")).toBeNull();
    expect(sheetChange("width", 100, rect, "px")).toBeNull();
  });
});

describe("posizione e misure", () => {
  it("seguono la cornice: l'angolo in alto a sinistra, i lati contorno compreso, la rotazione", () => {
    const view = propertiesView(input({ selection: selection() }));
    expect(view.subject).toBe("Rettangolo");
    const [x, y, width, height, rotation] = (["x", "y", "width", "height", "rotation"] as const).map((id) => number(view.fields[id]));
    expect([x!.value, y!.value, x!.relative]).toEqual([50, 10, false]);
    expect([width!.value, height!.value, width!.relative]).toEqual([20, 10, true]);
    expect([width!.min, width!.disabled]).toEqual([fieldMin(1, "px"), undefined]);
    expect([rotation!.value, rotation!.unit, rotation!.places]).toEqual([90, "°", 2]);
    expect(view.fields.ratio).toMatchObject({ kind: "press", on: false });
    expect(view.fields.ratio!.disabled).toBeUndefined();
  });

  it("nell'unità del documento, coi decimali dei righelli", () => {
    const view = propertiesView(input({ unit: "in", selection: selection() }));
    const x = number(view.fields.x);
    expect([x.value, x.unit, x.places]).toEqual([50 / 96, "in", 4]);
    expect(view.key).toBe("selection\nin\noa1a1a1a1");
  });

  it("un lato che non scala si vede e non si scrive, e il lucchetto non serve", () => {
    const view = propertiesView(input({ selection: selection({ frame: LINE, ratio: true }) }));
    expect(number(view.fields.width).disabled).toBeUndefined();
    expect(number(view.fields.height)).toMatchObject({ value: 2, disabled: true });
    expect(view.fields.ratio).toMatchObject({ on: true, disabled: true });
  });

  it("un lato più corto della misura più piccola non la deve raggiungere", () => {
    const tiny: Frame = { matrix: [1, 0, 0, 1, 0, 0], box: { min: [0, 0], max: [0.25, 10] }, geometry: { min: [0, 0], max: [0.25, 10] } };
    const view = propertiesView(input({ selection: selection({ frame: tiny }) }));
    expect(number(view.fields.width).min).toBe(0.25);
    expect(number(view.fields.height).min).toBe(1);
  });

  it("senza cornice non ci sono", () => {
    const view = propertiesView(input({ selection: selection({ frame: null }) }));
    expect(["x", "y", "width", "height", "ratio", "rotation"].filter((id) => id in view.fields)).toEqual([]);
  });
});

describe("«Forma»", () => {
  const facts = (parts: Partial<ShapeFacts> = {}): ShapeFacts => ({
    shape: { count: 1, value: "star" },
    count: { count: 1, value: 5 },
    ratio: { count: 1, value: 0.382 },
    corner: { count: 1, value: 4 },
    ...parts,
  });

  it("ha il tipo, le punte, il raggio interno e quello degli angoli nell'unità del documento", () => {
    const view = propertiesView(input({ unit: "mm", selection: selection({ shape: facts() }) }));
    expect(view.fields.shape).toMatchObject({ kind: "segment", label: "Tipo", value: "star" });
    expect((options(view.fields.shape) as SegmentState["options"]).map((option) => [option.label, option.icon])).toEqual([
      ["Poligono", "draw-polygon"],
      ["Stella", "draw-star"],
    ]);
    expect(number(view.fields.count)).toMatchObject({ label: "Punte", value: 5, places: 0, min: 3, max: 1000, relative: false });
    expect(number(view.fields.inner)).toMatchObject({ label: "Raggio interno", unit: "%", places: 1, min: 1, max: 100 });
    expect(number(view.fields.inner).value).toBeCloseTo(38.2, 9);
    const corner = number(view.fields.corner);
    expect([corner.label, corner.unit, corner.relative, corner.min]).toEqual(["Raggio degli angoli", "mm", true, 0]);
    expect(corner.value).toBeCloseTo(4 * (25.4 / 96), 9);
    expect(corner.note).toBeUndefined();
  });

  it("dice i lati di un poligono, e «Lati o punte» quando sono misti", () => {
    const polygons = propertiesView(input({ selection: selection({ shape: facts({ shape: { count: 2, value: "polygon" }, ratio: { count: 0, value: null } }) }) }));
    expect(number(polygons.fields.count).label).toBe("Lati");
    expect(polygons.fields.inner).toBeUndefined();
    const mixed = propertiesView(input({ selection: selection({ shape: facts({ shape: { count: 2, value: null }, count: { count: 2, value: null } }) }) }));
    expect(mixed.fields.shape).toMatchObject({ value: null });
    expect(number(mixed.fields.count)).toMatchObject({ label: "Lati o punte", value: null });
  });

  it("per i soli rettangoli ha soltanto il raggio degli angoli", () => {
    const rects = facts({ shape: { count: 0, value: null }, count: { count: 0, value: null }, ratio: { count: 0, value: null }, corner: { count: 2, value: null } });
    const view = propertiesView(input({ selection: selection({ shape: rects }) }));
    expect(["shape", "count", "inner"].filter((id) => id in view.fields)).toEqual([]);
    expect(number(view.fields.corner).value).toBeNull();
  });

  it("viene con lo strumento Poligono: nel Personalizzato senza di lui non c'è", () => {
    const without = propertiesView(input({ features: featuresFor("custom", ["properties"]), selection: selection({ shape: facts() }) }));
    expect(["shape", "count", "inner", "corner"].filter((id) => id in without.fields)).toEqual([]);
    const withIt = propertiesView(input({ features: featuresFor("custom", ["properties", "polygon"]), selection: selection({ shape: facts() }) }));
    expect(["shape", "count", "inner", "corner"].filter((id) => id in withIt.fields)).toEqual(["shape", "count", "inner", "corner"]);
  });

  it("senza selezione mostra lo strumento Poligono, con la nota", () => {
    const tool = facts({ shape: { count: 1, value: "polygon" }, count: { count: 1, value: 6 }, ratio: { count: 0, value: null }, corner: { count: 1, value: 0 } });
    const view = propertiesView(input({ tool }));
    expect(view.fields.shape).toMatchObject({ value: "polygon", note: "Per i poligoni e le stelle che disegnerai." });
    expect(number(view.fields.count).value).toBe(6);
    expect(number(view.fields.corner).note).toBeUndefined();
    expect(view.key).toBe("document\npx\npolygon");
    // Il pannello si ricostruisce quando lo strumento diventa la stella.
    expect(propertiesView(input({ tool: facts() })).key).toBe("document\npx\nstar");
    expect(propertiesView(input()).fields.shape).toBeUndefined();
  });

  it("dal valore al cambio: le percentuali in frazione, il raggio nella scena", () => {
    expect(shapeChange("shape", "star", "px")).toEqual({ shape: "star" });
    expect(shapeChange("shape", "circle", "px")).toBeNull();
    expect(shapeChange("count", 8, "px")).toEqual({ count: 8 });
    expect(shapeChange("inner", 50, "px")).toEqual({ ratio: 0.5 });
    expect(shapeChange("corner", 1, "in")).toEqual({ corner: 96 });
    expect(shapeChange("corner", "1", "px")).toBeNull();
    expect(shapeChange("x", 3, "px")).toBeNull();
  });
});

describe("l'aspetto", () => {
  const painted = look({
    fill: { count: 2, value: "#0072b2" },
    stroke: { count: 2, value: null },
    width: { count: 2, value: 4 },
    opacity: { count: 2, value: 0.5 },
  });

  it("i colori ci sono coi colori a piacere; lo spessore e l'opacità sempre", () => {
    const standard = propertiesView(input({ selection: selection({ look: painted }) }));
    expect(standard.fields.fill).toMatchObject({ kind: "paint", value: "#0072b2" });
    expect(standard.fields.stroke).toMatchObject({ kind: "paint", value: null });
    const essential = propertiesView(input({ level: "essential", selection: selection({ look: painted }) }));
    expect(essential.fields.fill).toBeUndefined();
    expect(essential.fields.stroke).toBeUndefined();
    expect(essential.fields.strokeWidth).toBeDefined();
    expect(essential.fields.opacity).toMatchObject({ value: 50, unit: "%", places: 0, min: 0, max: 100 });
  });

  it("lo spessore è in pixel in un documento in pixel, e in punti negli altri", () => {
    const px = number(propertiesView(input({ selection: selection({ look: painted }) })).fields.strokeWidth);
    expect([px.value, px.unit, px.min, px.relative]).toEqual([4, "px", 0, true]);
    const mm = number(propertiesView(input({ unit: "mm", selection: selection({ look: painted }) })).fields.strokeWidth);
    expect([mm.value, mm.unit, mm.places]).toEqual([3, "pt", 2]);
  });

  it("ciò che nessuno ha non c'è", () => {
    const view = propertiesView(input({ selection: selection({ look: look({ fill: { count: 1, value: "#000000" } }) }) }));
    expect(["strokeWidth", "opacity", "stroke", "preset", "family", "size", "weight", "emphasis", "leading", "spacing", "anchor"].filter((id) => id in view.fields)).toEqual([]);
  });

  it("un colore misura il contrasto con la carta, con la sua opacità; un testo chiede di più", () => {
    const shape = propertiesView(input({ paper: "#fafafa", selection: selection({ look: painted }) }));
    expect(shape.fields.fill).toMatchObject({ contrast: { paper: "#fafafa", alpha: 0.5, text: false } });
    expect(shape.fields.stroke).toMatchObject({ contrast: { paper: "#fafafa", alpha: 0.5, text: false } });
    const text = propertiesView(input({ selection: selection({ look: look({ fill: { count: 1, value: "#0072b2" }, size: { count: 1, value: 16 } }) }) }));
    expect(text.fields.fill).toMatchObject({ contrast: { paper: "#ffffff", alpha: 1, text: true } });
    // Senza la carta non si misura.
    const unknown = propertiesView(input({ paper: null, selection: selection({ look: painted }) }));
    expect("contrast" in unknown.fields.fill!).toBe(false);
  });
});

describe("la fusione", () => {
  const blended = (parts: Partial<Look> = {}): Look =>
    look({ fill: { count: 2, value: "#0072b2" }, opacity: { count: 2, value: 1 }, blend: { count: 2, value: "multiply" }, ...parts });

  it("c'è dall'Esperto, per chi ha una fusione da dire; lo Standard non la offre", () => {
    const expert = propertiesView(input({ level: "expert", selection: selection({ look: blended() }) }));
    expect(expert.fields.blend).toMatchObject({ kind: "choice", label: "Fusione", value: "multiply" });
    for (const level of ["essential", "standard"] as const) {
      const view = propertiesView(input({ level, selection: selection({ look: blended() }) }));
      expect(view.fields.blend).toBeUndefined();
      expect(view.fields.isolate).toBeUndefined();
      // L'opacità, invece, c'è sempre.
      expect(view.fields.opacity).toBeDefined();
    }
    const nobody = propertiesView(input({ level: "expert", selection: selection({ look: blended({ blend: NONE }) }) }));
    expect(nobody.fields.blend).toBeUndefined();
    expect(nobody.fields.isolate).toBeUndefined();
  });

  it("ha tutti e sedici i modi, ciascuno una volta sola, a gruppi separati, col nome della tabella", () => {
    const view = propertiesView(input({ level: "expert", selection: selection({ look: blended() }) }));
    const choice = view.fields.blend as ChoiceState;
    expect(choice.options.map((option) => option.value)).toEqual(BLEND_GROUPS.flat());
    expect([...choice.options.map((option) => option.value)].sort()).toEqual([...BLEND_MODES].sort());
    expect(choice.options).toHaveLength(16);
    // Un filetto prima di ogni gruppo tranne il primo.
    expect(choice.options.filter((option) => option.separator === true).map((option) => option.value)).toEqual(["darken", "lighten", "overlay", "difference", "hue"]);
    expect(choice.options[0]).toEqual({ value: "normal", label: "Normale" });
    expect(choice.options.find((option) => option.value === "multiply")!.label).toBe("Moltiplica");
    expect(choice.options.find((option) => option.value === "color-dodge")!.label).toBe("Scherma colore");
    expect(Object.keys(BLEND_LABELS).sort()).toEqual([...BLEND_MODES].sort());
    expect(new Set(choice.options.map((option) => option.label)).size).toBe(16);
  });

  it("una fusione mista non ne dice nessuna, e normale è quella di chi non la scrive", () => {
    const mixed = propertiesView(input({ level: "expert", selection: selection({ look: blended({ blend: { count: 2, value: null } }) }) }));
    expect(mixed.fields.blend).toMatchObject({ kind: "choice", value: null });
    const normal = propertiesView(input({ level: "expert", selection: selection({ look: blended({ blend: { count: 2, value: "normal" } }) }) }));
    expect(normal.fields.blend).toMatchObject({ value: "normal" });
  });

  it("«Isola la fusione» c'è soltanto se tutti gli scelti sono gruppi o collegamenti, e dice se è accesa", () => {
    const groups = (isolate: Look["isolate"]): Look => blended({ blend: { count: 2, value: "multiply" }, isolate });
    const on = propertiesView(input({ level: "expert", selection: selection({ look: groups({ count: 2, value: true }) }) }));
    expect(on.fields.isolate).toEqual({ kind: "switch", label: "Isola la fusione", on: true });
    const off = propertiesView(input({ level: "expert", selection: selection({ look: groups({ count: 2, value: false }) }) }));
    expect((off.fields.isolate as SwitchState).on).toBe(false);
    // Misti: spento, e un clic li accende tutti.
    const mixed = propertiesView(input({ level: "expert", selection: selection({ look: groups({ count: 2, value: null }) }) }));
    expect((mixed.fields.isolate as SwitchState).on).toBe(false);
    // Un oggetto che non è un gruppo fra i due: niente isolamento.
    const some = propertiesView(input({ level: "expert", selection: selection({ look: groups({ count: 1, value: true }) }) }));
    expect(some.fields.isolate).toBeUndefined();
    const none = propertiesView(input({ level: "expert", selection: selection({ look: groups(NONE) }) }));
    expect(none.fields.isolate).toBeUndefined();
  });

  it("in un disegno che non si modifica l'isolamento si vede e non si cambia", () => {
    const view = propertiesView(input({ level: "expert", editable: false, selection: selection({ look: blended({ isolate: { count: 2, value: true } }) }) }));
    expect(view.fields.isolate).toMatchObject({ on: true, disabled: true });
  });
});

describe("i colori del documento", () => {
  const DOCUMENT = {
    swatches: [{ id: "ra", name: "Blu marca", color: "#0072b2", stop: [0], uses: 3 }],
    used: [{ color: "#000000", uses: 2 }],
    hidden: 1,
  };
  const colors = (drawing = "#000000", swatch: string | null = null): FieldsInput["colors"] => ({ document: DOCUMENT, drawing, swatch });

  it("ci sono se il livello li offre, coi recenti; senza selezione un colore è quello con cui si disegna", () => {
    expect(propertiesView(input()).colors).toBeUndefined();
    const view = propertiesView(input({ recent: ["#d55e00"], colors: colors("#0072b2", "ra") }));
    expect(view.colors).toEqual({
      swatches: [{ id: "ra", name: "Blu marca", color: "#0072b2", uses: 3 }],
      used: [{ color: "#000000", uses: 2 }],
      hidden: 1,
      recent: ["#d55e00"],
      targets: null,
      current: {},
      drawing: "#0072b2",
      drawingSwatch: "ra",
    });
  });

  it("con una selezione, il colore va al riempimento e al contorno che ha, e il pannello dice i loro", () => {
    const both = propertiesView(input({ colors: colors(), selection: selection({ look: look({ fill: { count: 2, value: "url(#ra) #0072b2" }, stroke: { count: 1, value: null } }) }) }));
    expect([both.colors!.targets, both.colors!.current]).toEqual([["fill", "stroke"], { fill: "url(#ra) #0072b2", stroke: null }]);
    const line = propertiesView(input({ colors: colors(), selection: selection({ look: look({ stroke: { count: 1, value: "#000000" } }) }) }));
    expect(line.colors!.targets).toEqual(["stroke"]);
    // Un'immagine non ha un colore da cambiare.
    const image = propertiesView(input({ colors: colors(), selection: selection() }));
    expect(image.colors!.targets).toEqual([]);
  });
});

describe("il contorno", () => {
  it("ha il tratteggio dallo Standard; gli estremi e gli angoli dall'Esperto", () => {
    const outline = { dashable: true, dash: "dashed" as const, custom: null, cap: "round" as const, join: null };
    const standard = propertiesView(input({ selection: selection({ outline }) }));
    expect(standard.fields.dash).toMatchObject({ kind: "choice", value: "dashed" });
    expect(standard.fields.cap).toBeUndefined();
    const expert = propertiesView(input({ level: "expert", selection: selection({ outline }) }));
    expect(expert.fields.cap).toMatchObject({ value: "round" });
    expect(expert.fields.join).toMatchObject({ value: null });
  });

  it("non offre il tratteggio alle sole linee a spessore variabile", () => {
    const outline = { dashable: false, dash: null, custom: null, cap: "round" as const, join: "bevel" as const };
    const expert = propertiesView(input({ level: "expert", selection: selection({ outline }) }));
    expect(expert.fields.dash).toBeUndefined();
    expect(expert.fields.cap).toMatchObject({ value: "round" });
    expect(expert.fields.join).toMatchObject({ value: "bevel" });
  });

  it("un tratteggio che non è del menu c'è, col suo valore", () => {
    const view = propertiesView(input({ selection: selection({ outline: { dashable: true, dash: "custom", custom: "5 1 2", cap: null, join: null } }) }));
    const dashes = options(view.fields.dash);
    expect(dashes[dashes.length - 1]).toEqual({ value: "custom", label: "Su misura: 5 1 2" });
  });
});

describe("le punte delle linee", () => {
  /// Le punte di `count` linee: senza punte, tranne `parts`.
  const tipsLook = (parts: Partial<TipsLook> = {}): TipsLook => ({ count: 1, start: { shape: "none", size: null }, end: { shape: "none", size: null }, ...parts });
  const end = (shape: EndLook["shape"], size: EndLook["size"] = null): EndLook => ({ shape, size });
  const menu = (state: unknown): MenuChoiceState => state as MenuChoiceState;
  /// Il campo `id` di una selezione con le punte `tips`.
  const field = (id: "tipStart" | "tipEnd", tips: TipsLook): MenuChoiceState => menu(propertiesView(input({ selection: selection({ tips }) })).fields[id]);
  /// Com'è il menu: per ogni voce il valore, e se è segnata.
  const marked = (state: MenuChoiceState): Array<[string, boolean]> => state.options.map((option) => [option.value, option.checked === true]);

  it("ci sono dallo Standard, di una selezione che ne ha, con la forma e la misura di adesso", () => {
    const view = propertiesView(input({ selection: selection({ tips: tipsLook({ end: end("triangle", "medium") }) }) }));
    expect(view.fields.tipStart).toMatchObject({ kind: "menu", label: "Punta d’inizio", value: "none", summary: "Nessuna" });
    expect(view.fields.tipEnd).toMatchObject({ kind: "menu", label: "Punta di fine", value: "triangle", summary: "Triangolo, media" });
    // Dopo l'aspetto, prima del testo: nell'ordine dei campi.
    expect(Object.keys(view.fields).slice(-2)).toEqual(["tipStart", "tipEnd"]);
  });

  it("non ci sono senza la parte, senza linee che ne abbiano, o senza niente da dire", () => {
    const tips = tipsLook({ end: end("vee", "small") });
    for (const level of ["essential", "standard", "expert"] as const) {
      const view = propertiesView(input({ level, selection: selection({ tips }) }));
      expect(["tipStart", "tipEnd"].map((id) => id in view.fields), level).toEqual(level === "essential" ? [false, false] : [true, true]);
    }
    const custom = propertiesView(input({ features: featuresFor("custom", ["pen", "colors"]), selection: selection({ tips }) }));
    expect(["tipStart", "tipEnd"].some((id) => id in custom.fields)).toBe(false);
    const without = (facts: SelectionFacts): string[] => Object.keys(propertiesView(input({ selection: facts })).fields).filter((id) => id.startsWith("tip"));
    expect(without(selection({ tips: tipsLook({ count: 0 }) }))).toEqual([]);
    expect(without(selection({ tips: null }))).toEqual([]);
    expect(without(selection())).toEqual([]);
    expect(without(selection({ tips }))).toEqual(["tipStart", "tipEnd"]);
    // Senza selezione non c'è niente da dire.
    expect(Object.keys(propertiesView(input()).fields).some((id) => id.startsWith("tip"))).toBe(false);
  });

  it("il menu ha nessuna punta, le sei forme, le tre misure e lo scambio, con quella di adesso segnata", () => {
    const state = field("tipEnd", tipsLook({ end: end("diamond", "large") }));
    expect(state.options.map((option) => option.label)).toEqual([
      "Nessuna",
      "Triangolo",
      "Punta aperta",
      "Cerchio",
      "Quadrato",
      "Rombo",
      "Barra",
      "Piccola",
      "Media",
      "Grande",
      "Scambia inizio e fine",
    ]);
    expect(marked(state)).toEqual([
      ["none", false],
      ["triangle", false],
      ["vee", false],
      ["circle", false],
      ["square", false],
      ["diamond", true],
      ["bar", false],
      ["size:small", false],
      ["size:medium", false],
      ["size:large", true],
      ["swap", false],
    ]);
    // Le misure sono un gruppo e lo scambio un altro; lo scambio è un comando.
    expect(state.options.filter((option) => option.separator === true).map((option) => option.value)).toEqual(["size:small", "swap"]);
    expect(state.options.filter((option) => option.action === true).map((option) => option.value)).toEqual(["swap"]);
    expect(state.summary).toBe("Rombo, grande");
  });

  it("ogni voce ha la sua figura, col capo che dice il campo; le misure no", () => {
    const icons = (id: "tipStart" | "tipEnd"): Array<string | undefined> => field(id, tipsLook()).options.map((option) => option.icon);
    expect(icons("tipEnd")).toEqual([
      "draw-tip-none",
      "draw-tip-triangle-end",
      "draw-tip-vee-end",
      "draw-tip-circle-end",
      "draw-tip-square-end",
      "draw-tip-diamond-end",
      "draw-tip-bar-end",
      undefined,
      undefined,
      undefined,
      "draw-tips-swap",
    ]);
    expect(icons("tipStart").slice(0, 7)).toEqual([
      "draw-tip-none",
      "draw-tip-triangle-start",
      "draw-tip-vee-start",
      "draw-tip-circle-start",
      "draw-tip-square-start",
      "draw-tip-diamond-start",
      "draw-tip-bar-start",
    ]);
  });

  it("senza punta le misure ci sono e non si scelgono; con una della raccolta, sì", () => {
    const sizes = (state: MenuChoiceState): Array<boolean | undefined> => state.options.filter((option) => option.value.startsWith("size:")).map((option) => option.disabled);
    expect(sizes(field("tipStart", tipsLook()))).toEqual([true, true, true]);
    expect(sizes(field("tipStart", tipsLook({ start: end("circle", "small") })))).toEqual([undefined, undefined, undefined]);
    // Il capo misto può averne una, in qualche linea.
    expect(sizes(field("tipStart", tipsLook({ start: end(null) })))).toEqual([undefined, undefined, undefined]);
  });

  it("una punta che non è della raccolta c'è, segnata, spenta e per prima; non ha misura", () => {
    const state = field("tipEnd", tipsLook({ end: end("custom") }));
    expect(state).toMatchObject({ value: "custom", summary: "Un’altra punta" });
    expect(state.options[0]).toEqual({ value: "custom", label: "Un’altra punta", icon: "draw-tip-other-end", checked: true, disabled: true });
    expect(marked(state).filter(([, on]) => on)).toEqual([["custom", true]]);
    expect(state.options.filter((option) => option.value.startsWith("size:")).every((option) => option.disabled === true)).toBe(true);
    // E la sua figura è del capo.
    expect(field("tipStart", tipsLook({ start: end("custom") })).options[0]!.icon).toBe("draw-tip-other-start");
  });

  it("un capo misto non ha forma né voce segnata, e lo dice", () => {
    const state = field("tipEnd", tipsLook({ count: 3, end: end(null) }));
    expect(state).toMatchObject({ value: null, summary: "Misto" });
    expect(marked(state).filter(([, on]) => on)).toEqual([]);
    // Con le misure d'accordo, la misura si segna lo stesso.
    expect(marked(field("tipEnd", tipsLook({ count: 3, end: end(null, "large") }))).filter(([, on]) => on)).toEqual([["size:large", true]]);
  });

  it("di misure diverse, la forma si dice senza misura e nessuna misura è segnata", () => {
    const state = field("tipEnd", tipsLook({ count: 2, end: end("circle") }));
    expect(state).toMatchObject({ value: "circle", summary: "Cerchio" });
    expect(marked(state).filter(([, on]) => on)).toEqual([["circle", true]]);
  });

  it("scambiare due punte uguali non cambia niente: la voce c'è e non si sceglie", () => {
    const swap = (tips: TipsLook): boolean | undefined => field("tipStart", tips).options.find((option) => option.value === "swap")!.disabled;
    expect(swap(tipsLook())).toBe(true);
    expect(swap(tipsLook({ start: end("vee", "small"), end: end("vee", "small") }))).toBe(true);
    expect(swap(tipsLook({ start: end("vee", "small"), end: end("vee", "large") }))).toBeUndefined();
    expect(swap(tipsLook({ start: end("none"), end: end("triangle", "medium") }))).toBeUndefined();
    // Due marcatori che non sono della raccolta possono essere diversi; due capi misti, anche.
    expect(swap(tipsLook({ start: end("custom"), end: end("custom") }))).toBeUndefined();
    expect(swap(tipsLook({ count: 2, start: end(null), end: end(null) }))).toBeUndefined();
  });

  it("i nomi sono quelli delle tabelle, per ogni forma", () => {
    for (const shape of ["none", "triangle", "vee", "circle", "square", "diamond", "bar", "custom"] as const) {
      expect(field("tipEnd", tipsLook({ end: end(shape, shape === "none" || shape === "custom" ? null : "small") })).summary).toBeTruthy();
    }
    expect(field("tipEnd", tipsLook({ end: end("bar", "small") })).summary).toBe("Barra, piccola");
    expect(field("tipEnd", tipsLook({ end: end("vee", "medium") })).summary).toBe("Punta aperta, media");
  });
});

describe("il testo", () => {
  it("ha i caratteri per nome, quello di serie se nessuno lo scrive, e uno estraneo col suo", () => {
    const families = (value: string | null): ChoiceState["options"] => options(propertiesView(input({ selection: selection({ look: look({ family: { count: 1, value } }) }) })).fields.family);
    expect(families("Literata, serif").map((option) => option.label)).toEqual(["Inter", "Literata", "JetBrains Mono"]);
    expect(families("")[0]).toEqual({ value: "", label: "Predefinito" });
    expect(families("Comic Sans MS, cursive").slice(-1)).toEqual([{ value: "Comic Sans MS, cursive", label: "Comic Sans MS" }]);
    expect(families(null)).toHaveLength(3);
  });

  it("il corpo è in punti come lo spessore, e l'allineamento ha le sue icone", () => {
    const view = propertiesView(input({ unit: "cm", selection: selection({ look: look({ size: { count: 1, value: 32 }, anchor: { count: 1, value: "middle" } }) }) }));
    expect(number(view.fields.size)).toMatchObject({ value: 24, unit: "pt" });
    expect(view.fields.anchor).toMatchObject({ kind: "segment", value: "middle" });
    expect((options(view.fields.anchor) as SegmentState["options"]).map((option) => option.icon)).toEqual([
      "draw-anchor-start",
      "draw-anchor-middle",
      "draw-anchor-end",
    ]);
  });

  it("lo stile è quello che ha il corpo e il peso del testo, su misura altrimenti, e niente se sono misti", () => {
    // Senza gli stili del documento: con loro, gli stili di serie stanno
    // nel menu dello stile di testo.
    const preset = (size: number | null, weight: number | null): ChoiceState =>
      propertiesView(input({ level: "essential", selection: selection({ look: look({ size: { count: 1, value: size }, weight: { count: 1, value: weight } }) }) })).fields.preset as ChoiceState;
    expect(preset(64, 700)).toMatchObject({ label: "Stile", value: "title" });
    expect(preset(64, 700).options.map((option) => option.label)).toEqual(["Titolo", "Sottotitolo", "Titoletto", "Testo", "Didascalia"]);
    expect(preset(32, 400).value).toBe("body");
    expect(preset(32, 700).value).toBe("custom");
    expect(preset(32, 700).options.slice(-1)).toEqual([{ value: "custom", label: "Su misura" }]);
    expect(preset(null, 400).value).toBeNull();
    expect(preset(null, 400).options).toHaveLength(5);
  });

  it("il peso ha i suoi nomi, e uno che non è del menu al suo posto col numero", () => {
    const weight = (value: number | null): ChoiceState => propertiesView(input({ selection: selection({ look: look({ weight: { count: 1, value } }) }) })).fields.weight as ChoiceState;
    expect(weight(700)).toMatchObject({ label: "Peso", value: "700" });
    expect(weight(700).options.map((option) => option.label)).toEqual(["Leggero", "Normale", "Medio", "Semigrassetto", "Grassetto", "Extragrassetto", "Nero"]);
    expect(weight(450).options.map((option) => option.value)).toEqual(["300", "400", "450", "500", "600", "700", "800", "900"]);
    expect(weight(null).value).toBeNull();
  });

  it("l'enfasi accende ciò che il testo ha, e il misto è misto; il grassetto è da semigrassetto in su", () => {
    const emphasis = (parts: Partial<Look>): TogglesState => propertiesView(input({ selection: selection({ look: look(parts) }) })).fields.emphasis as TogglesState;
    const lit = emphasis({ weight: { count: 2, value: 600 }, italic: { count: 2, value: null }, underline: { count: 2, value: true }, strike: { count: 2, value: false } });
    expect(lit).toMatchObject({ kind: "toggles", label: "Enfasi" });
    expect(lit.options.map(({ value, icon, on }) => [value, icon, on])).toEqual([
      ["bold", "draw-text-bold", true],
      ["italic", "draw-text-italic", null],
      ["underline", "draw-text-underline", true],
      ["strike", "draw-text-strike", false],
    ]);
    expect(lit.options.map((option) => option.label)).toEqual(["Grassetto", "Corsivo", "Sottolineato", "Barrato"]);
    expect(emphasis({ weight: { count: 1, value: 500 } }).options[0]!.on).toBe(false);
    expect(emphasis({ weight: { count: 2, value: null } }).options[0]!.on).toBeNull();
  });

  it("l'interlinea c'è per i testi di più righe, e lei e la spaziatura sono in percentuale del corpo", () => {
    const view = propertiesView(input({ selection: selection({ look: look({ size: { count: 1, value: 32 }, leading: { count: 1, value: 1.25 }, spacing: { count: 1, value: 0.025 } }) }) }));
    expect(number(view.fields.leading)).toMatchObject({ label: "Interlinea", value: 125, unit: "%", places: 0, min: 50 });
    expect(number(view.fields.spacing)).toMatchObject({ label: "Spaziatura", value: 2.5, unit: "%", places: 1, min: -50 });
    // Una sola riga: niente interlinea; una misura già sotto il limite lo
    // abbassa.
    const one = propertiesView(input({ selection: selection({ look: look({ size: { count: 1, value: 32 }, spacing: { count: 1, value: -0.8 } }) }) }));
    expect("leading" in one.fields).toBe(false);
    expect(number(one.fields.spacing).min).toBe(-80);
  });

  it("il tipo di testo e la larghezza del riquadro, dal livello Esperto, nell'unità del documento", () => {
    const parts = { form: { count: 2, value: null }, wrap: { count: 1, value: fromUnit(80, "mm") } };
    const view = propertiesView(input({ level: "expert", unit: "mm", selection: selection({ look: look(parts) }) }));
    expect(view.fields.textForm).toMatchObject({ kind: "segment", label: "Tipo di testo", value: null });
    expect((options(view.fields.textForm) as SegmentState["options"]).map(({ value, label, icon }) => [value, label, icon])).toEqual([
      ["point", "Da punto", "draw-text-point"],
      ["area", "In area", "draw-text-area"],
    ]);
    expect(number(view.fields.wrap)).toMatchObject({ label: "Larghezza del riquadro", value: 80, unit: "mm", relative: true });
    // Due riquadri diversi: misto.
    const mixed = propertiesView(input({ level: "expert", selection: selection({ look: look({ ...parts, wrap: { count: 2, value: null } }) }) }));
    expect(number(mixed.fields.wrap).value).toBeNull();
    // Senza testi in area, niente riquadro; sotto Esperto, nessuno dei due.
    expect("wrap" in propertiesView(input({ level: "expert", selection: selection({ look: look({ form: { count: 1, value: "point" } }) }) })).fields).toBe(false);
    const standard = propertiesView(input({ selection: selection({ look: look(parts) }) }));
    expect(["textForm", "wrap"].filter((id) => id in standard.fields)).toEqual([]);
  });
});

describe("«Disponi»", () => {
  it("c'è col suo livello: un oggetto solo si allinea alla pagina, e si distribuisce da tre", () => {
    expect(propertiesView(input({ level: "essential", selection: selection() })).actions).toEqual({});
    const one = propertiesView(input({ selection: selection({ orders: new Set(["back", "backward"]) }) }));
    expect(one.actions["align-left"]).toEqual({ label: "Allinea a sinistra, rispetto alla pagina" });
    expect(one.actions["distribute-x"]).toEqual({ label: expect.any(String), disabled: true, note: "Servono almeno tre oggetti." });
    expect(one.actions["order-back"]!.disabled).toBeUndefined();
    expect(one.actions["order-front"]!.disabled).toBe(true);
    const three = propertiesView(input({ selection: selection({ count: 3, drawn: 3, alignable: true }) }));
    expect(three.actions["align-left"]).toEqual({ label: "Allinea a sinistra" });
    expect(three.actions["distribute-x"]!.disabled).toBeUndefined();
    const lone = propertiesView(input({ selection: selection({ alignable: false }) }));
    expect(lone.actions["align-left"]!.disabled).toBe(true);
  });
});

describe("«Trasforma»", () => {
  it("c'è dall'Esperto, e parte da niente da cambiare, coi suoi limiti", () => {
    expect(propertiesView(input({ selection: selection() })).fields.turn).toBeUndefined();
    const view = propertiesView(input({ level: "expert", selection: selection() }));
    expect((["turn", "scaleX", "scaleY", "skewX", "skewY"] as const).map((id) => number(view.fields[id]).value)).toEqual([0, 100, 100, 0, 0]);
    expect(number(view.fields.scaleX)).toMatchObject({ unit: "%", min: -100_000, max: 100_000 });
    expect(number(view.fields.skewY)).toMatchObject({ unit: "°", min: -89, max: 89 });
  });
});

describe("gli attributi", () => {
  it("il pannello li ospita solo con una selezione", () => {
    expect(propertiesView(input({ attributes: true })).attributes).toBe(false);
    expect(propertiesView(input({ attributes: true, selection: selection() })).attributes).toBe(true);
  });
});

describe("dal valore al cambio", () => {
  it("l'aspetto: lo spessore e il corpo tornano in unità della scena, l'opacità in frazione", () => {
    const units: readonly LengthUnit[] = ["px", "mm"];
    expect(units.map((unit) => lookChange("strokeWidth", 3, unit))).toEqual([{ width: 3 }, { width: 4 }]);
    expect(lookChange("size", 24, "pt")).toEqual({ size: 32 });
    expect(lookChange("opacity", 50, "px")).toEqual({ opacity: 0.5 });
    expect(lookChange("fill", "#e69f00", "px")).toEqual({ fill: "#e69f00" });
    expect(lookChange("stroke", "none", "px")).toEqual({ stroke: "none" });
    expect(lookChange("anchor", "end", "px")).toEqual({ anchor: "end" });
  });

  it("la fusione e l'isolamento: solo un modo del formato, solo un sì o un no", () => {
    for (const mode of BLEND_MODES) expect(lookChange("blend", mode, "px")).toEqual({ blend: mode });
    expect(lookChange("blend", "plus-lighter", "px")).toBeNull();
    expect(lookChange("blend", "inherit", "px")).toBeNull();
    expect(lookChange("blend", "", "px")).toBeNull();
    expect(lookChange("blend", 3, "px")).toBeNull();
    expect(lookChange("isolate", true, "px")).toEqual({ isolate: true });
    expect(lookChange("isolate", false, "px")).toEqual({ isolate: false });
    expect(lookChange("isolate", "true", "px")).toBeNull();
    // Il passo di annulla ha il suo nome, e l'interruttore dice il verso.
    expect(lookAction("blend", "multiply")).toBe("draw.action.blend");
    expect(lookAction("isolate", true)).toBe("draw.action.isolate");
    expect(lookAction("isolate", false)).toBe("draw.action.unisolate");
  });

  it("l'opacità scritta nella barra: intera, fra 0 e 100, letta come quella del pannello", () => {
    expect(typedOpacity("50", 100)).toBe(50);
    expect(typedOpacity("50%", 100)).toBe(50);
    expect(typedOpacity(" 40+10 ", null)).toBe(50);
    expect(typedOpacity("33.6", null)).toBe(34);
    expect(typedOpacity("250", 100)).toBe(100);
    expect(typedOpacity("-20", 100)).toBe(0);
    expect(typedOpacity("0", 100)).toBe(0);
    // Ciò che non si legge dice perché, e non è un numero.
    for (const wrong of ["", "abc", "5 px", "1/0"]) expect(typeof typedOpacity(wrong, 100)).toBe("string");
    expect(typedOpacity("", 100)).not.toBe(typedOpacity("abc", 100));
  });

  it("il testo: lo stile, il peso, gli interruttori dell'enfasi, e l'interlinea e la spaziatura in volte il corpo", () => {
    expect(lookChange("preset", "subtitle", "mm")).toEqual({ preset: { size: 48, weight: 600 } });
    expect(lookChange("preset", "custom", "px")).toBeNull();
    expect(lookChange("weight", "300", "px")).toEqual({ weight: 300 });
    expect(lookChange("weight", "1200", "px")).toBeNull();
    expect(lookChange("emphasis", "bold:true", "px")).toEqual({ weight: 700 });
    expect(lookChange("emphasis", "bold:false", "px")).toEqual({ weight: 400 });
    expect(lookChange("emphasis", "italic:true", "px")).toEqual({ italic: true });
    expect(lookChange("emphasis", "underline:false", "px")).toEqual({ underline: false });
    expect(lookChange("emphasis", "strike:true", "px")).toEqual({ strike: true });
    expect(lookChange("emphasis", "overline:true", "px")).toBeNull();
    expect(lookChange("emphasis", "italic", "px")).toBeNull();
    expect(lookChange("leading", 150, "px")).toEqual({ leading: 1.5 });
    expect(lookChange("leading", 0, "px")).toBeNull();
    expect(lookChange("spacing", -2.5, "px")).toEqual({ spacing: -0.025 });
    // Il passo di annulla di un interruttore ha il suo nome.
    expect(lookAction("emphasis", "italic:true")).toBe("draw.text.italic");
    expect(lookAction("leading", 150)).toBe("draw.action.leading");
    expect(lookAction("emphasis", "overline:true")).toBeNull();
  });

  it("il tipo di testo e il riquadro, in unità della scena", () => {
    expect(lookChange("textForm", "area", "px")).toEqual({ form: "area" });
    expect(lookChange("textForm", "path", "px")).toBeNull();
    expect(lookChange("wrap", 10, "mm")).toEqual({ wrap: fromUnit(10, "mm") });
    expect(lookChange("wrap", 0, "px")).toBeNull();
    expect(lookAction("textForm", "point")).toBe("draw.action.text_form");
    expect(lookAction("wrap", 10)).toBe("draw.action.text_frame");
  });

  it("un valore che non è del campo, o un campo che non è dell'aspetto, non cambia niente", () => {
    expect(lookChange("family", "", "px")).toBeNull();
    expect(lookChange("anchor", "justify", "px")).toBeNull();
    expect(lookChange("fill", 3, "px")).toBeNull();
    expect(lookChange("x", 3, "px")).toBeNull();
  });

  it("il contorno: solo i valori dei menu", () => {
    expect(outlineChange("dash", "dotted")).toEqual({ dash: "dotted" });
    expect(outlineChange("cap", "square")).toEqual({ cap: "square" });
    expect(outlineChange("join", "bevel")).toEqual({ join: "bevel" });
    expect(outlineChange("dash", "custom")).toBeNull();
    expect(outlineChange("fill", "dotted")).toBeNull();
  });

  it("le punte: la forma di un capo, la misura della punta e lo scambio", () => {
    expect(tipChange("tipStart", "triangle")).toEqual({ end: "start", shape: "triangle" });
    expect(tipChange("tipEnd", "vee")).toEqual({ end: "end", shape: "vee" });
    expect(tipChange("tipEnd", "none")).toEqual({ end: "end", shape: "none" });
    expect(tipChange("tipStart", "size:small")).toEqual({ end: "start", size: "small" });
    expect(tipChange("tipEnd", "size:large")).toEqual({ end: "end", size: "large" });
    expect(tipChange("tipStart", "swap")).toEqual({ swap: true });
    expect(tipChange("tipEnd", "swap")).toEqual({ swap: true });
  });

  it("le punte: un valore che non è del campo, o un campo che non è delle punte, non cambia niente", () => {
    // Una punta di un'altra specie si vede nel menu, ma non si scrive.
    expect(tipChange("tipEnd", "custom")).toBeNull();
    expect(tipChange("tipEnd", "star")).toBeNull();
    expect(tipChange("tipEnd", "size:huge")).toBeNull();
    expect(tipChange("tipEnd", "size:")).toBeNull();
    expect(tipChange("tipEnd", "")).toBeNull();
    expect(tipChange("tipEnd", 3)).toBeNull();
    expect(tipChange("tipStart", true)).toBeNull();
    expect(tipChange("dash", "triangle")).toBeNull();
    expect(tipChange("fill", "swap")).toBeNull();
  });
});

describe("gli stili del documento", () => {
  const menu = (state: unknown): MenuChoiceState => state as MenuChoiceState;
  const RIQUADRO = { id: "rbox00000", name: "Riquadro", kind: "graphic", followers: 2 } as unknown as DocumentStyle;
  const TITOLO = { id: "rtitle000", name: "titolo", kind: "text", followers: 0 } as unknown as DocumentStyle;
  const SAMPLE = { text: "", css: { background: "rgb(230 159 0)" } };
  const row = (parts: Partial<StyleRow> = {}): StyleRow => ({
    kind: "graphic",
    count: 1,
    style: RIQUADRO,
    mixed: false,
    following: 1,
    differs: new Set<StyleField>(),
    differing: 0,
    fixed: 0,
    ...parts,
  });
  const facts = (parts: Partial<StyleFacts> = {}): StyleFacts => ({
    row: row(),
    styles: [{ id: RIQUADRO.id, name: RIQUADRO.name, followers: 2, sample: SAMPLE }],
    updatable: true,
    undeletable: null,
    fresh: "Stile grafico 1",
    ...parts,
  });
  /// Una selezione con un riempimento, un corpo e le righe «Stile» `styles`.
  const styled = (styles: SelectionFacts["styles"]): SelectionFacts =>
    selection({ look: look({ fill: { count: 1, value: "#e69f00" }, width: { count: 1, value: 2 }, size: { count: 1, value: 32 }, weight: { count: 1, value: 400 } }), styles });

  it("ci sono dallo Standard, in testa all'aspetto e al testo, e prendono il posto dello stile di serie", () => {
    const styles = { graphic: facts(), text: facts({ row: row({ kind: "text", style: null, following: 0 }), styles: [], fresh: "Stile di testo 1" }) };
    const view = propertiesView(input({ selection: styled(styles) }));
    expect(view.fields.lookStyle).toMatchObject({ kind: "menu", label: "Stile grafico", value: "style:rbox00000", summary: "Riquadro" });
    expect(view.fields.textStyle).toMatchObject({ kind: "menu", label: "Stile di testo", value: null, summary: "Nessuno" });
    expect("preset" in view.fields).toBe(false);
    const essential = propertiesView(input({ level: "essential", selection: styled(styles) }));
    expect(["lookStyle", "textStyle"].some((id) => id in essential.fields)).toBe(false);
    expect("preset" in essential.fields).toBe(true);
    // Una selezione che non ne può seguire uno non ha la riga.
    expect("lookStyle" in propertiesView(input({ selection: styled({ graphic: null, text: null }) })).fields).toBe(false);
  });

  it("dice lo stile, modificato, misto o nessuno", () => {
    const summary = (styles: StyleFacts): string | undefined => menu(propertiesView(input({ selection: styled({ graphic: styles, text: null }) })).fields.lookStyle).summary;
    expect(summary(facts())).toBe("Riquadro");
    expect(summary(facts({ row: row({ differing: 1, differs: new Set<StyleField>(["width"]) }) }))).toBe("Riquadro, modificato");
    expect(summary(facts({ row: row({ style: null, mixed: true, following: 1 }) }))).toBe("Misto");
    expect(summary(facts({ row: row({ style: null, following: 0 }) }))).toBe("Nessuno");
  });

  it("nel menu gli stili con l'anteprima e chi li segue, poi i comandi, spenti col perché", () => {
    const state = menu(propertiesView(input({ selection: styled({ graphic: facts({ updatable: false, undeletable: "locked" }), text: null }) })).fields.lookStyle);
    expect(state.options.map((option) => [option.value, option.disabled === true])).toEqual([
      ["style:rbox00000", false],
      ["new", false],
      ["update", true],
      ["revert", true],
      ["unlink", false],
      ["rename", false],
      ["delete", true],
    ]);
    expect(state.options[0]).toMatchObject({ label: "Riquadro", checked: true, sample: SAMPLE, note: "Lo seguono 2 oggetti" });
    expect(state.options[1]).toMatchObject({ separator: true, ask: { title: "Nuovo stile grafico", value: "Stile grafico 1", submit: "Crea" } });
    expect(state.options[2]!.note).toBe("Lo stile è già come la selezione.");
    expect(state.options[3]!.note).toBe("La selezione è già come lo stile.");
    expect(state.options[5]).toMatchObject({ ask: { title: "Rinomina «Riquadro»", value: "Riquadro", submit: "Rinomina" } });
    expect(state.options[6]).toMatchObject({ danger: true, note: "Un oggetto che lo segue sta in un livello o in un gruppo bloccato." });
    // Senza uno stile seguito da tutti, i comandi sullo stile dicono perché.
    const mixed = menu(propertiesView(input({ selection: styled({ graphic: facts({ row: row({ style: null, mixed: true }) }), text: null }) })).fields.lookStyle);
    expect(mixed.options.filter((option) => option.disabled === true).map((option) => [option.value, option.note])).toEqual([
      ["update", "La selezione segue stili diversi."],
      ["revert", "La selezione segue stili diversi."],
      ["rename", "La selezione segue stili diversi."],
      ["delete", "La selezione segue stili diversi."],
    ]);
    const none = menu(propertiesView(input({ selection: styled({ graphic: facts({ row: row({ style: null, following: 0 }), styles: [] }), text: null }) })).fields.lookStyle);
    expect(none.options[0]).toMatchObject({ value: "new", separator: false });
    expect(none.options.find((option) => option.value === "unlink")!.note).toBe("La selezione non segue uno stile.");
  });

  it("per il testo offre gli stili di serie che il documento non ha ancora", () => {
    const text = facts({ row: row({ kind: "text", style: TITOLO }), styles: [{ id: TITOLO.id, name: TITOLO.name, followers: 0, sample: { text: "Aa", css: {} } }], fresh: "Stile di testo 1" });
    const state = menu(propertiesView(input({ selection: styled({ graphic: null, text }) })).fields.textStyle);
    // «titolo» c'è già, a meno delle maiuscole.
    expect(state.options.slice(0, 5).map((option) => option.value)).toEqual(["style:rtitle000", "preset:subtitle", "preset:heading", "preset:body", "preset:caption"]);
    expect(state.options[0]!.note).toBe("Nessun oggetto lo segue");
    expect(state.options[1]).toMatchObject({ label: "Sottotitolo", action: true, sample: { text: "Aa", css: { "font-weight": "600" } } });
    expect(state.options[5]).toMatchObject({ value: "new", ask: { title: "Nuovo stile di testo" } });
  });

  it("segna i campi diversi dallo stile, e la riga li nomina", () => {
    const graphic = facts({ row: row({ differing: 1, differs: new Set<StyleField>(["width", "fill", "effects"]) }) });
    const view = propertiesView(input({ selection: styled({ graphic, text: null }) }));
    expect(view.fields.strokeWidth!.differs).toBe("Diverso dallo stile «Riquadro»");
    expect(view.fields.fill!.differs).toBe("Diverso dallo stile «Riquadro»");
    expect(view.fields.size!.differs).toBeUndefined();
    expect(view.fields.lookStyle!.note).toBe("Diverso dallo stile: riempimento, spessore e effetti.");
    // Senza uno stile seguito da tutti non c'è niente da segnare.
    const mixed = propertiesView(input({ selection: styled({ graphic: facts({ row: row({ style: null, mixed: true, differs: new Set<StyleField>(["width"]) }) }), text: null }) }));
    expect(mixed.fields.strokeWidth!.differs).toBeUndefined();
    expect(mixed.fields.lookStyle!.note).toBeUndefined();
  });
});
