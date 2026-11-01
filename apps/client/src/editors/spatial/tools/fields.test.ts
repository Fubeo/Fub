// I campi del pannello delle proprietà: dalla selezione e dal documento ai
// campi, coi nomi, le unità, i limiti e ciò che il livello offre; e dal
// valore scritto al cambio dell'aspetto o del contorno.

import { describe, expect, it } from "vitest";
import type { LengthUnit } from "../scene/rulers";
import {
  lookAction,
  lookChange,
  propertiesView,
  tipChange,
  typedOpacity,
  type FieldsInput,
  type FontFacts,
  type SelectionFacts,
} from "./fields";
import type { Frame } from "./frame";
import { DEFAULT_GRID } from "./grid";
import type { Look } from "./look";
import type { ChoiceState, MenuChoiceState, NumberState, SegmentState, TogglesState } from "./properties";
import { featuresFor, type Feature, type Workspace } from "./registry";
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
  ...parts,
});

const input = (parts: Partial<FieldsInput> & { readonly workspace?: Workspace } = {}): FieldsInput => {
  const { workspace = "full", ...rest } = parts;
  return {
    features: featuresFor(workspace),
    unit: "px",
    editable: true,
    selection: null,
    document: { page: { width: 400, height: 300 }, boards: false, desc: "" },
    grid: DEFAULT_GRID,
    bar: true,
    swatches: [],
    recent: [],
    paper: "#ffffff",
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
      "bar",
    ]);
    expect(view.actions).toEqual({});
  });

  it("senza pagina non ha i suoi lati, e la vista ha solo ciò che il livello offre", () => {
    const view = propertiesView(input({ workspace: "simple", bar: false, document: { page: null, boards: false, desc: "" } }));
    expect(view.fields.pageWidth).toBeUndefined();
    expect(view.fields.pagePreset).toBeUndefined();
    expect(view.fields.unit).toBeDefined();
    expect(["grid", "snap", "bar"].filter((id) => id in view.fields)).toEqual([]);
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
    // Senza i colori a piacere (chi monta passa le sue parti) restano lo
    // spessore e l'opacità.
    const plain = propertiesView(input({ features: new Set<Feature>(["pen"]), selection: selection({ look: painted }) }));
    expect(plain.fields.fill).toBeUndefined();
    expect(plain.fields.stroke).toBeUndefined();
    expect(plain.fields.strokeWidth).toBeDefined();
    expect(plain.fields.opacity).toMatchObject({ value: 50, unit: "%", places: 0, min: 0, max: 100 });
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

describe("il contorno", () => {
  it("ha il tratteggio, e non gli estremi né gli angoli (ADR 0231)", () => {
    const outline = { dashable: true, dash: "dashed" as const, custom: null, cap: "round" as const, join: null };
    for (const workspace of ["full"] as const) {
      const view = propertiesView(input({ workspace, selection: selection({ outline }) }));
      expect(view.fields.dash).toMatchObject({ kind: "choice", value: "dashed" });
      expect(Object.keys(view.fields)).not.toContain("cap");
      expect(Object.keys(view.fields)).not.toContain("join");
    }
  });

  it("non offre il tratteggio alle sole linee a spessore variabile", () => {
    const outline = { dashable: false, dash: null, custom: null, cap: "round" as const, join: "bevel" as const };
    expect(propertiesView(input({ selection: selection({ outline }) })).fields.dash).toBeUndefined();
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
    for (const workspace of ["simple", "full"] as const) {
      const view = propertiesView(input({ workspace, selection: selection({ tips }) }));
      expect(["tipStart", "tipEnd"].map((id) => id in view.fields), workspace).toEqual(workspace === "simple" ? [false, false] : [true, true]);
    }
    const custom = propertiesView(input({ features: new Set<Feature>(["pen", "colors"]), selection: selection({ tips }) }));
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

  it("non offre le famiglie del vault, e un testo che ne usa una la mostra col suo nome", () => {
    const fonts: FontFacts = {
      families: [
        { name: "Caslon", generic: "serif" },
        { name: "Noto Sans JP", generic: "sans-serif" },
        { name: 'Un "nome"', generic: "sans-serif" },
        { name: "a\\b", generic: "monospace" },
      ],
      notes: { missing: [], unreadable: [], over: [], failed: [] },
      shown: () => "Inter",
    };
    const families = (value: string): ChoiceState["options"] => options(propertiesView(input({ fonts, selection: selection({ look: look({ family: { count: 1, value } }) }) })).fields.family);
    // Senza i caratteri del vault (ADR 0231) l'editor non le offre, ma un
    // testo che ne usa una la mostra col suo nome.
    expect(families("Inter, sans-serif")).toHaveLength(3);
    expect(families('"Noto Sans JP", sans-serif').slice(3)).toEqual([{ value: '"Noto Sans JP", sans-serif', label: "Noto Sans JP" }]);
  });

  it("dice sotto il carattere la famiglia che manca, è oltre il tetto o non si carica, e con quale si vede", () => {
    const note = (value: string, notes: Partial<FontFacts["notes"]>): string | undefined => {
      const fonts: FontFacts = { families: [], notes: { missing: [], unreadable: [], over: [], failed: [], ...notes }, shown: (each) => (each.startsWith("Roboto") ? "Roboto" : "Inter") };
      return (propertiesView(input({ fonts, selection: selection({ look: look({ family: { count: 1, value } }) }) })).fields.family as ChoiceState).note;
    };
    expect(note("Arial, sans-serif", { missing: ["arial"] })).toBe("Arial non è fra i caratteri del vault: il testo usa Inter.");
    expect(note("Arial, Roboto, sans-serif", { missing: ["Arial"] })).toBe("Arial non è fra i caratteri del vault: il testo usa Inter.");
    expect(note("Arial, sans-serif", { missing: ["Arial"], unreadable: ["Caratteri/rotto.ttf", "b.otf", "c.woff2", "d.ttf"] })).toBe(
      "Arial non è fra i caratteri che il vault sa leggere: il testo usa Inter. Non si leggono: rotto.ttf, b.otf, c.woff2 e un altro.",
    );
    expect(note("Arial, sans-serif", { missing: ["Arial"], unreadable: ["a.ttf", "b.otf"] })).toContain("Non si leggono: a.ttf e b.otf.");
    expect(note("Grande, serif", { over: ["Grande"] })).toBe("Grande supera i 64 MiB di caratteri di un disegno: il testo usa Inter.");
    expect(note("Rotto, serif", { failed: ["Rotto"] })).toBe("Rotto non si carica: il testo usa Inter.");
    expect(note("Roboto, sans-serif", { missing: ["Arial"] })).toBeUndefined();
    expect(note("Inter, sans-serif", { missing: ["Inter"] })).toBeUndefined();
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
      propertiesView(input({ workspace: "simple", selection: selection({ look: look({ size: { count: 1, value: size }, weight: { count: 1, value: weight } }) }) })).fields.preset as ChoiceState;
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
    expect(propertiesView(input({ workspace: "simple", selection: selection() })).actions).toEqual({});
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

  it("un valore che non è del campo, o un campo che non è dell'aspetto, non cambia niente", () => {
    expect(lookChange("family", "", "px")).toBeNull();
    expect(lookChange("anchor", "justify", "px")).toBeNull();
    expect(lookChange("fill", 3, "px")).toBeNull();
    expect(lookChange("x", 3, "px")).toBeNull();
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
