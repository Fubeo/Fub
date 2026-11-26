// @vitest-environment happy-dom
// L'editor del disegno: le forme dal tratto, il pannello delle proprietà, la barra accanto alla selezione.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { doc } from "../scene/test-support";
import { LAYER } from "./test-support";
import { Init, MOUSE, SOURCE, banco, dialog, drag, enter, key, mount, pointer, properties, property, propertyInput, size, spoken, surface, typeIn } from "./editor-test-support";

// happy-dom non disegna: il PNG degli appunti è il testo che riceve.
vi.mock("./png", async (real) => ({
  ...(await real<typeof import("./png")>()),
  rasterize: vi.fn(async (svg: string) => new Blob([svg], { type: "image/png" })),
}));

const propertyLabel = (id: string): string => property(id).querySelector("label")!.textContent ?? "";

describe("le forme dal tratto, nel Completo", () => {
  /// La pagina larga quanto i tratti: non cresce, e i passi sono quelli
  /// dei tratti.
  const PAGE = SOURCE.replace('viewBox="0 0 100 100"', 'viewBox="0 0 600 600"');

  /// I punti di una mano senza tremito lungo gli spigoli `corners`, uno ogni
  /// quattro pixel.
  const trace = (corners: readonly (readonly [number, number])[]): Array<[number, number]> => {
    const out: Array<[number, number]> = [[corners[0]![0], corners[0]![1]]];
    for (let i = 1; i < corners.length; i++) {
      const [ax, ay] = corners[i - 1]!;
      const [bx, by] = corners[i]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
      for (let k = 1; k <= steps; k++) out.push([ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps]);
    }
    return out;
  };
  const RECT = trace([[100, 100], [300, 100], [300, 220], [100, 220], [100, 100]]);
  const LINE = trace([[100, 100], [300, 140]]);

  /// Il puntatore scende all'inizio di `points` e li percorre, senza
  /// alzarsi.
  const press = (points: readonly (readonly [number, number])[]): void => {
    const target = surface();
    const [x0, y0] = points[0]!;
    target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: x0, clientY: y0, timeStamp: (banco.clock += 8) }));
    for (const [x, y] of points.slice(1)) moveTo(x, y);
  };
  const moveTo = (x: number, y: number, init: Init = {}): void => {
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: x, clientY: y, timeStamp: (banco.clock += 8), ...init }));
  };
  const lift = (x: number, y: number, init: Init = {}): void => {
    surface().dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: x, clientY: y, timeStamp: (banco.clock += 8), ...init }));
  };
  /// Il puntatore resta fermo per `ms` millisecondi.
  const hold = (ms: number): void => {
    banco.clock += ms;
    vi.advanceTimersByTime(ms);
  };
  const preview = (): Element | null => banco.host.querySelector(".draw-preview > g > g > *");
  /// Il rettangolo che la forma dal tratto ha scritto, se c'è.
  const shaped = (): RegExpMatchArray | null => banco.editor.engine.text.match(/<rect id="o[a-z0-9]{8}" x="(?!60")[^>]*>/);
  const shapeButton = (): HTMLButtonElement => banco.host.querySelector<HTMLButtonElement>('.draw-arrange button[aria-label="Rendi forma"]')!;
  const pageButton = (): HTMLButtonElement => banco.host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Pagina e griglia"]')!;
  const menuEntry = (label: string): HTMLButtonElement => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>("button")].find((one) => one.querySelector(".menu-label")!.textContent === label)!;
  };
  const strokes = (): string[] => [...banco.editor.engine.text.matchAll(/<path id="(o[a-z0-9]{8})" fub:tool="pen"/g)].map((found) => found[1]!);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    // Ciò che aspetta un timer, come la chiusura di un menu, finisce prima
    // che tornino i timer veri.
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  });

  it("un tratto a penna tenuto fermo mezzo secondo diventa la forma a cui somiglia, e annulla riporta l'inchiostro", () => {
    mount(PAGE);
    press(RECT);
    hold(499);
    expect(preview()).toBeNull();
    hold(1);
    expect(spoken()).toBe("Rettangolo.");
    expect(preview()?.tagName.toLowerCase()).toBe("rect");
    expect(banco.changes).toEqual([]);
    lift(100, 100);
    expect(preview()).toBeNull();
    expect(banco.editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="100" y="100" width="200" height="120" fill="none" stroke="#000000" stroke-width="4"\/>/);
    expect(banco.editor.engine.text).not.toContain("fub:ink");
    expect(spoken()).toBe("Rettangolo dal tratto. Il disegno ha 2 oggetti.");
    // Due passi: il tratto, poi la forma al suo posto.
    expect(banco.changes).toHaveLength(2);
    banco.editor.undo();
    expect(spoken()).toBe("Annullato: Forma dal tratto.");
    expect(strokes()).toHaveLength(1);
    expect(shaped()).toBeNull();
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(PAGE);
  });

  it("muovendo dopo la tenuta la forma cresce e gira attorno al centro, e Maiusc la tiene regolare", () => {
    mount(PAGE);
    press(RECT);
    hold(500);
    // Il tremito della mano ferma non la muove.
    moveTo(102, 101);
    expect(preview()!.getAttribute("width")).toBe("200");
    // Dal centro (200, 160), il doppio più lontano nella stessa direzione.
    moveTo(0, 40);
    expect(preview()!.getAttribute("width")).toBe("400");
    key("Shift", { shiftKey: true });
    expect(preview()!.getAttribute("width")).toBe(preview()!.getAttribute("height"));
    lift(0, 40, { shiftKey: true });
    expect(banco.editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="40" y="0" width="320" height="320" /);
    expect(spoken()).toBe("Quadrato dal tratto. Il disegno ha 2 oggetti.");
  });

  it("una linea tenuta ferma diventa un segmento, e la sua fine segue il puntatore", () => {
    mount(PAGE);
    press(LINE);
    hold(500);
    expect(spoken()).toBe("Linea.");
    moveTo(300, 200);
    lift(300, 200);
    expect(banco.editor.engine.text).toMatch(/<line id="o[a-z0-9]{8}" x1="100" y1="100" x2="300" y2="200" stroke="#000000" stroke-width="4"/);
  });

  it("un tratto piccolo, o che non somiglia a una forma, resta inchiostro e si continua a disegnare", () => {
    mount(PAGE);
    press(trace([[100, 100], [115, 100], [115, 110], [100, 110], [100, 100]]));
    hold(800);
    lift(100, 100);
    expect(strokes()).toHaveLength(1);
    expect(spoken()).toBe("Tratto aggiunto. Il disegno ha 2 oggetti.");
    const zigzag = trace([[100, 300], [140, 360], [180, 300], [220, 360], [260, 300]]);
    press(zigzag);
    hold(600);
    // Non è una forma: il tratto continua.
    moveTo(300, 360);
    hold(600);
    lift(300, 360);
    expect(strokes()).toHaveLength(2);
    expect(banco.changes).toHaveLength(2);
  });

  it("Esc lascia il tratto e la forma", () => {
    mount(PAGE);
    press(RECT);
    hold(500);
    key("Escape");
    expect(preview()).toBeNull();
    lift(100, 100);
    expect(banco.changes).toEqual([]);
    expect(banco.editor.engine.text).toBe(PAGE);
  });

  it("non c'è nel Semplice, con l'evidenziatore, né con l'interruttore spento, che si ricorda", () => {
    const grids: unknown[] = [];
    mount(PAGE, { workspace: "simple", onGridChange: (grid) => grids.push(grid) });
    press(RECT);
    hold(600);
    lift(100, 100);
    expect(strokes()).toHaveLength(1);
    banco.editor.setSpace("full");
    banco.editor.setTool("highlighter");
    press(RECT);
    hold(600);
    lift(100, 100);
    expect(shaped()).toBeNull();
    banco.editor.setTool("pen");
    pageButton().click();
    const entry = menuEntry("Forme dal tratto");
    expect(entry.getAttribute("role")).toBe("menuitemcheckbox");
    expect(entry.getAttribute("aria-checked")).toBe("true");
    expect(entry.querySelector(".menu-description")!.textContent).toBe("Tieni fermo un tratto a penna alla fine: diventa una linea, una freccia o una forma.");
    entry.click();
    expect(spoken()).toBe("I tratti a penna restano inchiostro anche tenuti fermi.");
    expect(banco.editor.grid.shapes).toBe(false);
    expect(grids).toEqual([expect.objectContaining({ shapes: false })]);
    press(RECT);
    hold(600);
    lift(100, 100);
    expect(strokes()).toHaveLength(2);
    pageButton().click();
    menuEntry("Forme dal tratto").click();
    expect(spoken()).toBe("Un tratto a penna tenuto fermo alla fine diventa una forma.");
  });

  it("«Rendi forma» c'è con un tratto a penna scelto, e fa forme dei tratti in un passo che si annulla", () => {
    mount(PAGE);
    drag(RECT);
    drag(trace([[100, 300], [140, 360], [180, 300], [220, 360], [260, 300]]));
    const [rect, zigzag] = strokes();
    const before = banco.editor.engine.text;
    banco.changes.length = 0;
    banco.editor.setTool("select");
    banco.editor.select(["o1a2b3c4d"]);
    expect(shapeButton().hidden).toBe(true);
    banco.editor.select([rect!, zigzag!, "o1a2b3c4d"]);
    expect(shapeButton().hidden).toBe(false);
    expect(shapeButton().hasAttribute("aria-keyshortcuts")).toBe(false);
    shapeButton().click();
    expect(banco.editor.engine.text).toMatch(new RegExp(`<rect id="${rect}" x="100" y="100" width="200" height="120" fill="none" stroke="#000000" stroke-width="4"/>`));
    expect(strokes()).toEqual([zigzag]);
    expect(spoken()).toBe("1 tratto è diventato una forma. 1 tratto resta inchiostro: non somiglia a una forma.");
    expect(banco.editor.selection).toEqual(["o1a2b3c4d", rect, zigzag]);
    expect(banco.changes).toHaveLength(1);
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(before);
    expect(spoken()).toBe("Annullato: Forma dal tratto.");
    banco.editor.setSpace("simple");
    banco.editor.select([rect!]);
    expect(shapeButton().hidden).toBe(true);
  });

  it("«?» elenca il tasto delle forme dal tratto", () => {
    mount(SOURCE);
    key("?", { shiftKey: true });
    const tables = [...dialog().querySelectorAll(".keys-list > table")].map((table) => ({
      caption: table.querySelector("caption")!.textContent,
      rows: [...table.querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]),
    }));
    expect(tables.find((table) => table.caption === "Forme dal tratto")?.rows).toEqual([["Shift", "Tenuto, la forma dal tratto resta regolare"]]);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});

describe("il pannello delle proprietà, nel Completo", () => {
  const A = "o1a2b3c4d";
  const B = "ob2b2b2b2";
  const TWO = doc(
    `${LAYER}<rect id="${A}" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/><rect id="${B}" x="10" y="20" width="10" height="10" fill="#000000"/></g>`,
  );
  const button = (): HTMLButtonElement => banco.host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Proprietà"]')!;
  const dock = (): HTMLElement => banco.host.querySelector<HTMLElement>(".draw-dock")!;
  const choose = (id: string, value: string): void => {
    const select = property(id).querySelector("select")!;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const flip = (id: string): void => property(id).querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();

  it("«Proprietà» lo apre e lo chiude accanto al foglio, e chi monta l'editor lo sa", () => {
    const panels: (boolean | null)[] = [];
    mount(SOURCE, { onGridChange: (grid) => panels.push(grid.panel) });
    expect(button().hasAttribute("aria-haspopup")).toBe(false);
    expect(button().getAttribute("aria-controls")).toBe(properties().id);
    expect(button().getAttribute("aria-expanded")).toBe("false");
    button().click();
    expect(properties().hidden).toBe(false);
    expect(dock().hidden).toBe(false);
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(properties().querySelector(".draw-properties-subject")!.textContent).toBe("Il disegno");
    expect(properties().contains(document.activeElement)).toBe(true);
    expect(formatIssues(checkAccessibility(banco.host))).toBe("");
    button().click();
    expect(properties().hidden).toBe(true);
    expect(dock().hidden).toBe(true);
    expect(document.activeElement).toBe(surface());
    expect(panels).toEqual([true, false]);
    // Anche il Semplice ha il pannello: il pulsante non apre una finestra.
    banco.editor.setSpace("simple");
    expect(button().hasAttribute("aria-haspopup")).toBe(false);
    expect(button().getAttribute("aria-expanded")).toBe("false");
  });

  it("si apre da sé se l'editor ha posto accanto al foglio, o come l'ha lasciato chi disegna", () => {
    const observers: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          observers.push(callback);
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    const measured = (width: number): void => {
      Object.defineProperty(banco.host.querySelector(".draw-editor")!, "clientWidth", { configurable: true, value: width });
      for (const callback of observers.splice(0)) callback([], {} as ResizeObserver);
    };
    mount(SOURCE);
    // Finché l'editor non ha una misura, il pannello aspetta di saperla.
    expect(properties().hidden).toBe(true);
    measured(1000);
    expect(properties().hidden).toBe(false);
    // Aprirsi da sé non è una scelta di chi disegna: non si ricorda.
    expect(banco.editor.grid.panel).toBeNull();
    banco.editor.dispose();

    mount(SOURCE);
    measured(400);
    expect(properties().hidden).toBe(true);
    banco.editor.dispose();

    mount(SOURCE, { grid: { ...banco.editor.grid, panel: false } });
    measured(1000);
    expect(properties().hidden).toBe(true);
    // Chi monta l'editor lo riapre come l'aveva lasciato chi disegna.
    banco.editor.setGrid({ ...banco.editor.grid, panel: true });
    expect(properties().hidden).toBe(false);
    expect(document.activeElement).not.toBe(propertyInput("pageWidth"));
  });

  it("Invio ci porta; posizione e misure si scrivono, ciascuna in un passo che si annulla col suo nome", () => {
    mount(TWO);
    banco.editor.select([A]);
    banco.editor.focus();
    key("Enter");
    expect(document.activeElement).toBe(propertyInput("x"));
    expect(properties().querySelector(".draw-properties-subject")!.textContent).toBe("Rettangolo, Nero");
    // La cornice comprende il contorno, come quella sul foglio.
    expect(["x", "y", "width", "height", "rotation"].map((id) => propertyInput(id).value)).toEqual(["59", "59", "22", "22", "0"]);
    enter(propertyInput("x"), "100");
    // La pagina cresce, come per ogni spostamento che ne esce.
    expect(banco.editor.engine.text).toContain(`stroke-width="2" transform="matrix(1 0 0 1 41 0)"/>`);
    expect(propertyInput("x").value).toBe("100");
    expect(banco.changes).toHaveLength(1);
    banco.editor.undo();
    expect(spoken()).toBe("Annullato: Spostamento.");
    expect(propertyInput("x").value).toBe("59");
    enter(propertyInput("rotation"), "90");
    expect(propertyInput("rotation").value).toBe("90");
    expect(banco.editor.selection).toEqual([A]);
    banco.editor.undo();
    expect(spoken()).toBe("Annullato: Rotazione.");
    enter(propertyInput("width"), "44");
    expect(["width", "height"].map((id) => propertyInput(id).value)).toEqual(["44", "22"]);
    banco.editor.undo();
    expect(spoken()).toBe("Annullato: Ridimensionamento.");
    expect(banco.editor.engine.text).toBe(TWO);
  });

  it("il lucchetto tiene le proporzioni, finché chi disegna non lo riapre", () => {
    mount(TWO);
    banco.editor.select([A]);
    key("Enter");
    const lock = (): HTMLButtonElement => property("ratio").querySelector<HTMLButtonElement>("button")!;
    expect(lock().getAttribute("aria-pressed")).toBe("false");
    lock().click();
    expect(lock().getAttribute("aria-pressed")).toBe("true");
    enter(propertyInput("width"), "44");
    expect(["width", "height"].map((id) => propertyInput(id).value)).toEqual(["44", "44"]);
    expect(lock().getAttribute("aria-pressed")).toBe("true");
    // Un'altra selezione parte col suo lucchetto.
    banco.editor.select([B]);
    expect(lock().getAttribute("aria-pressed")).toBe("false");
  });

  it("l'aspetto: il riempimento, lo spessore in punti e l'opacità", () => {
    mount(TWO);
    banco.editor.select([A]);
    key("Enter");
    // In un documento in pixel lo spessore è in pixel; negli altri, in punti.
    expect(propertyLabel("strokeWidth")).toBe("Spessore (px)");
    expect(propertyInput("strokeWidth").value).toBe("2");
    enter(propertyInput("strokeWidth"), "4");
    expect(banco.editor.engine.text).toContain('stroke-width="4"');
    enter(propertyInput("fill"), "#e69f00");
    expect(banco.editor.engine.text).toContain('fill="#e69f00"');
    enter(propertyInput("opacity"), "50");
    expect(banco.editor.engine.text).toContain('opacity="0.5"');
    expect(banco.changes).toHaveLength(3);
    banco.editor.undo();
    expect(spoken()).toBe("Annullato: Opacità.");
    banco.editor.undo();
    expect(spoken()).toBe("Annullato: Riempimento.");
    banco.editor.undo();
    expect(spoken()).toBe("Annullato: Spessore del contorno.");
    expect(banco.editor.engine.text).toBe(TWO);
  });

  it("il testo: lo stile, il peso, l'enfasi, l'interlinea e la spaziatura valgono per il testo intero", () => {
    const T = "ot1t1t1t1";
    const TEXT = doc(
      `${LAYER}<text id="${T}" x="10" y="40" fill="#000000" font-family="Inter, sans-serif" font-size="32">` +
        `<tspan x="10" dy="0">Uno</tspan><tspan x="10" dy="40">Due <tspan font-weight="bold">tre</tspan></tspan></text></g>`,
    );
    mount(TEXT);
    banco.editor.select([T]);
    key("Enter");
    const toggle = (label: string): HTMLButtonElement => property("emphasis").querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    const opening = (): string => /<text [^>]*>/.exec(banco.editor.engine.text)![0];
    // Il grassetto di una parola rende misto il peso. Senza gli stili del
    // documento (ADR 0231) lo stile di serie ha il suo campo.
    expect(property("preset")).not.toBeNull();
    expect(property("weight").querySelector("select")!.value).toBe("");
    expect(toggle("Grassetto").getAttribute("aria-pressed")).toBe("mixed");
    expect(toggle("Corsivo").getAttribute("aria-pressed")).toBe("false");
    expect(propertyInput("leading").value).toBe("125");
    expect(propertyInput("spacing").value).toBe("0");
    toggle("Grassetto").click();
    expect(opening()).toContain('font-size="32" font-weight="bold">');
    expect(banco.editor.engine.text).toContain('<tspan x="10" dy="40">Due tre</tspan>');
    expect(toggle("Grassetto").getAttribute("aria-pressed")).toBe("true");
    enter(propertyInput("size"), "64");
    expect(opening()).toContain('font-size="64" font-weight="bold">');
    // L'interlinea segue il corpo.
    expect(banco.editor.engine.text).toContain('<tspan x="10" dy="80">');
    enter(propertyInput("leading"), "150");
    expect(banco.editor.engine.text).toContain('<tspan x="10" dy="96">');
    enter(propertyInput("spacing"), "5");
    expect(opening()).toContain('letter-spacing="3.2"');
    toggle("Corsivo").click();
    expect(opening()).toContain('font-style="italic"');
    expect(banco.changes).toHaveLength(5);
    const undone = [1, 2, 3, 4, 5].map(() => {
      banco.editor.undo();
      return spoken();
    });
    expect(undone).toEqual([
      "Annullato: Corsivo.",
      "Annullato: Spaziatura delle lettere.",
      "Annullato: Interlinea.",
      "Annullato: Dimensione del testo.",
      "Annullato: Grassetto.",
    ]);
    expect(banco.editor.engine.text).toBe(TEXT);
  });

  it("«Disponi» ha i comandi della barra, che dicono quando non servono", () => {
    mount(TWO);
    banco.editor.select([A, B]);
    key("Enter");
    expect(properties().querySelector(".draw-properties-subject")!.textContent).toBe("2 oggetti");
    const action = (id: string): HTMLButtonElement => properties().querySelector<HTMLButtonElement>(`[data-action="${id}"]`)!;
    expect(action("distribute-x").getAttribute("aria-disabled")).toBe("true");
    action("align-left").click();
    // Il bordo del contorno va a 10, dove comincia l'altro.
    expect(banco.editor.engine.text).toContain(`stroke-width="2" transform="matrix(1 0 0 1 -49 0)"/>`);
    expect(banco.changes).toHaveLength(1);
    expect(banco.editor.selection).toEqual([A, B]);
  });

  it("senza selezione: la pagina, l'unità, la descrizione e la vista", () => {
    const grids: (readonly [boolean | null, boolean])[] = [];
    mount(TWO, { onGridChange: (grid) => grids.push([grid.panel, grid.shown]) });
    key("Enter");
    expect(propertyInput("pageWidth").value).toBe("100");
    enter(propertyInput("pageWidth"), "200");
    expect(banco.editor.engine.text).toContain('viewBox="0 0 200 100"');
    choose("unit", "mm");
    expect(spoken()).toBe("Il documento ora misura in millimetri.");
    expect(banco.editor.engine.text).toContain('fub:units="mm"');
    expect(propertyLabel("pageWidth")).toBe("Larghezza della pagina (mm)");
    expect(propertyInput("pageWidth").value).toBe("52,917");
    const desc = property("desc").querySelector("textarea")!;
    typeIn(desc, "Una prova");
    key("Enter", { ctrlKey: true }, desc);
    expect(banco.editor.engine.text).toContain("<desc>Una prova</desc>");
    flip("grid");
    expect(banco.editor.grid.shown).toBe(true);
    expect(spoken()).toBe("Griglia visibile.");
    // Il pannello aperto da chi disegna si ricorda, come la griglia.
    expect(grids).toEqual([
      [true, false],
      [true, true],
    ]);
    expect(banco.changes).toHaveLength(3);
  });

  it("in un documento che si legge soltanto mostra, e non scrive", () => {
    mount(TWO);
    banco.editor.select([A]);
    key("Enter");
    banco.editor.setReadOnly(true);
    expect(propertyInput("x").readOnly).toBe(true);
    expect(button().disabled).toBe(false);
    enter(propertyInput("x"), "100");
    expect(banco.changes).toEqual([]);
    banco.editor.setReadOnly(false);
    expect(propertyInput("x").readOnly).toBe(false);
  });
});

describe("la barra accanto alla selezione, nel Completo", () => {
  const bar = (): HTMLElement => banco.host.querySelector<HTMLElement>(".draw-arrange")!;
  const spot = (): readonly number[] => /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(bar().style.transform)!.slice(1).map(Number);

  it("sta sotto la selezione, oltre le maniglie; in cima al foglio se chi disegna lo sceglie", () => {
    mount(SOURCE);
    size(800, 600);
    banco.editor.select(["o1a2b3c4d"]);
    expect(bar().hidden).toBe(false);
    expect(bar().hasAttribute("data-beside")).toBe(true);
    // Il rettangolo va da 59 a 81 col contorno: la barra, larga zero in
    // happy-dom, sta al suo centro e sotto le maniglie.
    const [x, y] = spot();
    expect(x).toBe(70);
    expect(y).toBeGreaterThan(81 + 12);
    banco.editor.select([]);
    key("Enter");
    property("bar").querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    expect(spoken()).toBe("La barra della selezione sta in cima al foglio.");
    expect(banco.editor.grid.bar).toBe(false);
    banco.editor.select(["o1a2b3c4d"]);
    expect(bar().hasAttribute("data-beside")).toBe(false);
    expect(bar().style.transform).toBe("");
  });

  it("durante un gesto non si vede, e dopo segue la selezione", () => {
    mount(doc(`${LAYER}<rect id="oa1a1a1a1" x="10" y="20" width="10" height="10" fill="#000000"/></g>`));
    size(800, 600);
    banco.editor.setTool("select");
    banco.editor.select(["oa1a1a1a1"]);
    expect(spot()[0]).toBe(15);
    const target = surface();
    target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: 15, clientY: 25, timeStamp: (banco.clock += 8) }));
    target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: 115, clientY: 25, timeStamp: (banco.clock += 8) }));
    expect(bar().hasAttribute("data-gesture")).toBe(true);
    target.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: 115, clientY: 25, timeStamp: (banco.clock += 8) }));
    expect(bar().hasAttribute("data-gesture")).toBe(false);
    expect(spot()[0]).toBe(115);
  });

  it("si sceglie anche in «Pagina e griglia»", () => {
    mount(SOURCE);
    size(800, 600);
    banco.host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Pagina e griglia"]')!.click();
    const item = [...document.querySelectorAll<HTMLElement>(".context-menu button")].find(
      (one) => one.querySelector(".menu-label")?.textContent === "Barra accanto alla selezione",
    )!;
    expect(item.getAttribute("aria-checked")).toBe("true");
    item.click();
    expect(spoken()).toBe("La barra della selezione sta in cima al foglio.");
    expect(banco.editor.grid.bar).toBe(false);
    banco.editor.select(["o1a2b3c4d"]);
    expect(bar().hidden).toBe(false);
    expect(bar().hasAttribute("data-beside")).toBe(false);
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  });
});
