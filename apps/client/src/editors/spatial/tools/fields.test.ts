// I campi del pannello delle proprietà: dalla selezione e dal documento ai
// campi, coi nomi, le unità, i limiti e ciò che il livello offre; e dal
// valore scritto al cambio dell'aspetto o del contorno.

import { describe, expect, it } from "vitest";
import type { LengthUnit } from "../scene/rulers";
import { lookAction, lookChange, outlineChange, propertiesView, shapeChange, type FieldsInput, type SelectionFacts } from "./fields";
import type { Frame } from "./frame";
import { DEFAULT_GRID } from "./grid";
import type { Look } from "./look";
import type { ChoiceState, NumberState, SegmentState, TogglesState } from "./properties";
import { featuresFor, type Level } from "./registry";
import type { ShapeFacts } from "./reshape";
import { fieldMin, fromUnit } from "./rulers";

const NONE = { count: 0, value: null };

/// Un aspetto in cui nessuno ha niente, tranne `parts`.
const look = (parts: Partial<Look> = {}): Look => ({
  fill: NONE,
  stroke: NONE,
  width: NONE,
  opacity: NONE,
  family: NONE,
  size: NONE,
  weight: NONE,
  italic: NONE,
  underline: NONE,
  strike: NONE,
  leading: NONE,
  spacing: NONE,
  anchor: NONE,
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
    document: { page: { width: 400, height: 300 }, desc: "" },
    grid: DEFAULT_GRID,
    bar: true,
    attributes: false,
    tool: null,
    ...rest,
  };
};

const number = (state: unknown): NumberState => state as NumberState;
const options = (state: unknown): ChoiceState["options"] | SegmentState["options"] => (state as ChoiceState | SegmentState).options;

describe("senza selezione, il disegno", () => {
  it("ha la pagina nell'unità del documento, l'unità, la descrizione e la vista", () => {
    const view = propertiesView(input({ unit: "mm", document: { page: { width: fromUnit(210, "mm"), height: fromUnit(297, "mm") }, desc: "Una prova" } }));
    expect(view.subject).toBe("Il disegno");
    expect(view.key).toBe("document\nmm");
    expect(view.attributes).toBe(false);
    const width = number(view.fields.pageWidth);
    expect([width.label, width.value, width.unit, width.places, width.relative, width.min]).toEqual(["Larghezza della pagina", expect.closeTo(210, 9), "mm", 3, true, fieldMin(1, "mm")]);
    expect(number(view.fields.pageHeight).value).toBeCloseTo(297, 9);
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
    const view = propertiesView(input({ level: "essential", bar: false, document: { page: null, desc: "" } }));
    expect(view.fields.pageWidth).toBeUndefined();
    expect(view.fields.unit).toBeDefined();
    expect(["grid", "snap", "guides", "rulers", "rulerGuides", "bar"].filter((id) => id in view.fields)).toEqual([]);
  });

  it("gli interruttori dicono la vista di adesso", () => {
    const view = propertiesView(input({ grid: { ...DEFAULT_GRID, shown: true, bar: false } }));
    expect(view.fields.grid).toMatchObject({ on: true });
    expect(view.fields.snap).toMatchObject({ on: false });
    expect(view.fields.bar).toMatchObject({ on: false });
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
    const preset = (size: number | null, weight: number | null): ChoiceState =>
      propertiesView(input({ selection: selection({ look: look({ size: { count: 1, value: size }, weight: { count: 1, value: weight } }) }) })).fields.preset as ChoiceState;
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
});
