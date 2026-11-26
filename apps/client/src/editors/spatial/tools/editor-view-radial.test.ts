// @vitest-environment happy-dom
// L'editor del disegno: la vista girata e i gesti, il menu radiale, le tavole, «Esporta», le punte.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { closeContextMenu } from "../../../ui/menu";
import { decodeInk } from "../ink/codec";
import { doc } from "../scene/test-support";
import { LAYER } from "./test-support";
import { closeRadial } from "./radial";
import { setReducedMotionPreference } from "../../../theme/reduced-motion";
import { Init, SOURCE, banco, dialog, drag, enter, key, mount, pointer, property, propertyInput, size, spoken, submit, surface, well } from "./editor-test-support";

// happy-dom non disegna: il PNG degli appunti è il testo che riceve.
vi.mock("./png", async (real) => ({
  ...(await real<typeof import("./png")>()),
  rasterize: vi.fn(async (svg: string) => new Blob([svg], { type: "image/png" })),
}));

describe("la vista girata e i gesti", () => {
  const A = "o1a2b3c4d";
  /// La camera del foglio, come matrice `[a b c d e f]`.
  const cameraOf = (): number[] => banco.host.querySelector(".draw-preview g")!.getAttribute("transform")!.match(/^matrix\((.*)\)$/)![1]!.split(" ").map(Number);
  const near = (actual: readonly number[], expected: readonly number[], digits = 9): void =>
    expect(actual).toEqual(expected.map((value) => expect.closeTo(value, digits)));
  /// Il punto della scena `p` sullo schermo, con la camera di adesso.
  const onScreen = ([x, y]: readonly [number, number]): [number, number] => {
    const [a, b, c, d, e, f] = cameraOf();
    return [a! * x + c! * y + e!, b! * x + d! * y + f!];
  };
  const turnButton = (): HTMLButtonElement => banco.host.querySelector<HTMLButtonElement>(".draw-zoom-level[data-turn]")!;
  const pageButton = (): HTMLButtonElement => banco.host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Pagina e griglia"]')!;
  const menu = (): HTMLButtonElement[] => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>("button")];
  };
  const entry = (label: string): HTMLButtonElement => menu().find((one) => one.querySelector(".menu-label")!.textContent === label)!;
  /// Un dito, il `pointerId` `id`, in (`x`, `y`) al tempo `at`.
  const touch = (type: string, id: number, x: number, y: number, at: number): void => {
    const up = type === "pointerup";
    surface().dispatchEvent(
      pointer(type, { pointerId: id, pointerType: "touch", isPrimary: false, button: type === "pointermove" ? -1 : 0, buttons: up ? 0 : 1, pressure: up ? 0 : 0.5, clientX: x, clientY: y, timeStamp: at }),
    );
  };
  const wheel = (init: { readonly deltaY: number; readonly ctrlKey?: boolean; readonly shiftKey?: boolean }): void => {
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: init.deltaY });
    // happy-dom fa di WheelEvent un UIEvent: i tasti e il punto si danno a mano.
    const fields = { ctrlKey: init.ctrlKey ?? false, shiftKey: init.shiftKey ?? false, metaKey: false, clientX: 100, clientY: 50 };
    for (const [name, value] of Object.entries(fields)) Object.defineProperty(event, name, { value });
    surface().dispatchEvent(event);
  };

  afterEach(() => {
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  });

  it("4 e 6 girano la vista di 15° attorno al centro, 5 la raddrizza; il pulsante dice l'angolo e la raddrizza", () => {
    mount(SOURCE);
    size(200, 100);
    expect(turnButton().hidden).toBe(true);
    key("6");
    expect(spoken()).toBe("Vista ruotata di 15°.");
    expect(turnButton().hidden).toBe(false);
    expect(turnButton().textContent).toBe("15°");
    expect(turnButton().getAttribute("aria-label")).toBe("15°: raddrizza la vista");
    expect(turnButton().getAttribute("aria-keyshortcuts")).toBe("5");
    for (let i = 0; i < 5; i++) key("6");
    // Il centro del foglio, (100, 50), resta fermo; l'angolo retto è esatto.
    expect(spoken()).toBe("Vista ruotata di 90°.");
    near(cameraOf(), [0, 1, -1, 0, 150, -50]);
    expect(cameraOf().slice(0, 4)).toEqual([0, 1, -1, 0]);
    key("4");
    expect(spoken()).toBe("Vista ruotata di 75°.");
    key("5");
    expect(spoken()).toBe("Vista diritta.");
    near(cameraOf(), [1, 0, 0, 1, 0, 0]);
    expect(turnButton().hidden).toBe(true);
    key("4");
    expect(spoken()).toBe("Vista ruotata di -15°.");
    expect(formatIssues(checkAccessibility(banco.host))).toBe("");
    turnButton().click();
    expect(spoken()).toBe("Vista diritta.");
    expect(turnButton().hidden).toBe(true);
  });

  it("la vista gira nel Semplice e nel Completo, e cambiare spazio non la raddrizza", () => {
    mount(SOURCE, { workspace: "simple" });
    size(200, 100);
    key("6");
    expect(turnButton().hidden).toBe(false);
    banco.editor.setSpace("full");
    expect(turnButton().hidden).toBe(false);
    expect(cameraOf()[0]).not.toBeCloseTo(1);
  });

  it("la rotella con Ctrl e Maiusc gira a passi, attorno al puntatore", () => {
    mount(SOURCE);
    size(200, 100);
    wheel({ deltaY: 100, ctrlKey: true, shiftKey: true });
    expect(spoken()).toBe("Vista ruotata di 15°.");
    // Il punto sotto il puntatore resta dov'è.
    near(onScreen([100, 50]), [100, 50]);
    wheel({ deltaY: 30, ctrlKey: true, shiftKey: true });
    expect(spoken()).toBe("Vista ruotata di 15°.");
    wheel({ deltaY: 30, ctrlKey: true, shiftKey: true });
    expect(spoken()).toBe("Vista ruotata di 30°.");
    wheel({ deltaY: -100, ctrlKey: true, shiftKey: true });
    expect(spoken()).toBe("Vista ruotata di 15°.");
    // Senza Maiusc è lo zoom di sempre, all'angolo di adesso.
    const before = cameraOf();
    wheel({ deltaY: -50, ctrlKey: true });
    expect(Math.atan2(cameraOf()[1]!, cameraOf()[0]!)).toBeCloseTo(Math.atan2(before[1]!, before[0]!), 12);
    expect(Math.hypot(cameraOf()[0]!, cameraOf()[1]!)).toBeGreaterThan(Math.hypot(before[0]!, before[1]!));
  });

  it("sul foglio girato si sceglie e si sposta ciò che si vede sotto il puntatore, e le frecce vanno dove si vede", () => {
    mount(SOURCE);
    size(200, 100);
    banco.editor.setTool("select");
    for (let i = 0; i < 6; i++) key("6");
    // Il quadrato da (60, 60) a (80, 80) si vede da (70, 10) a (90, 30).
    near(onScreen([60, 60]), [90, 10]);
    drag([[80, 11], [85, 11], [90, 11]]);
    expect(banco.editor.selection).toEqual([A]);
    // Dieci pixel a destra sullo schermo sono dieci verso l'alto nella scena.
    expect(banco.editor.engine.text).toContain('transform="matrix(1 0 0 1 0 -10)"');
    key("ArrowRight");
    expect(banco.editor.engine.text).toContain('transform="matrix(1 0 0 1 0 -11)"');
    key("ArrowDown");
    expect(banco.editor.engine.text).toContain('transform="matrix(1 0 0 1 1 -11)"');
    // Ctrl e → allarga la misura che si vede in orizzontale: l'altezza.
    key("ArrowRight", { ctrlKey: true });
    const [a, b, c, d] = banco.editor.engine.text.match(/transform="matrix\(([^)]*)\)"/)![1]!.split(" ").map(Number);
    expect([a, b, c]).toEqual([1, 0, 0]);
    expect(d).toBeGreaterThan(1);
  });

  it("il riquadro di selezione su un foglio girato di traverso sceglie ciò che sta nel rettangolo come si vede", () => {
    mount(SOURCE);
    size(200, 100);
    banco.editor.setTool("select");
    key("6");
    key("6");
    // Il quadrato col suo contorno, da (59, 59) a (81, 81), sullo schermo.
    const corners = ([[59, 59], [81, 59], [81, 81], [59, 81]] as const).map(onScreen);
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    const [left, top, right, bottom] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    // Un po' più stretto del quadrato girato: i suoi angoli escono.
    drag([[left + 3, top + 3], [right - 3, bottom - 3]]);
    expect(banco.editor.selection).toEqual([]);
    drag([[left - 2, top - 2], [right + 2, bottom + 2]]);
    expect(banco.editor.selection).toEqual([A]);
  });

  it("due dita che ruotano girano il foglio, oltre una soglia e senza salti, e rilasciate vicino a un angolo retto ci si posano", () => {
    mount(SOURCE);
    size(200, 100);
    let at = 1000;
    const around = (degrees: number): [number, number] => [50 + 100 * Math.cos((degrees * Math.PI) / 180), 50 + 100 * Math.sin((degrees * Math.PI) / 180)];
    const twist = (steps: readonly number[]): void => {
      touch("pointerdown", 11, 50, 50, (at += 16));
      touch("pointerdown", 12, 150, 50, (at += 16));
      touch("pointermove", 11, 50, 50, (at += 16));
      for (const degrees of steps) touch("pointermove", 12, ...around(degrees), (at += 16));
      touch("pointerup", 11, 50, 50, (at += 16));
      touch("pointerup", 12, ...around(steps[steps.length - 1]!), (at += 16));
    };
    const angle = (): number => (Math.atan2(cameraOf()[1]!, cameraOf()[0]!) * 180) / Math.PI;
    // I primi 10° aprono il gesto: il foglio gira dei 20 dopo.
    twist([5, 10, 20, 30]);
    expect(angle()).toBeCloseTo(20, 9);
    expect(spoken()).toBe("Vista ruotata di 20°.");
    // A 88° si posa sull'angolo retto, esatto: i pixel restano interi.
    const square = (): void => {
      const [a, b, c, d] = cameraOf();
      expect([a, d]).toEqual([0, 0]);
      expect(b).toBeCloseTo(1, 12);
      expect(c).toBeCloseTo(-1, 12);
    };
    twist([5, 10, 78]);
    square();
    expect(spoken()).toBe("Vista ruotata di 90°.");
    // Un pizzico che gira appena non gira il foglio, e non annulla niente.
    twist([3, 6]);
    square();
    expect(banco.editor.engine.text).toBe(SOURCE);
    // Spenta, le dita non girano più.
    banco.editor.setGrid({ ...banco.editor.grid, twist: false });
    twist([5, 10, 40]);
    square();
  });

  it("un tocco di due dita annulla, uno di tre ripete; un tocco lungo o che scorre no, e si spengono", () => {
    mount(SOURCE);
    size(200, 100);
    drag([[10, 10], [40, 10]]);
    const drawn = banco.editor.engine.text;
    expect(drawn).not.toBe(SOURCE);
    let at = 5000;
    const tap = (fingers: number, hold = 60, slide = 0): void => {
      for (let i = 0; i < fingers; i++) touch("pointerdown", 21 + i, 100 + 20 * i, 50, (at += 10));
      if (slide > 0) touch("pointermove", 21, 100 + slide, 50, (at += 10));
      at += hold;
      for (let i = 0; i < fingers; i++) touch("pointerup", 21 + i, 100 + 20 * i + (i === 0 ? slide : 0), 50, (at += 10));
    };
    tap(2);
    expect(banco.editor.engine.text).toBe(SOURCE);
    expect(spoken()).toBe("Annullato: Tratto.");
    tap(3);
    expect(banco.editor.engine.text).toBe(drawn);
    expect(spoken()).toBe("Ripetuto: Tratto.");
    tap(3);
    expect(spoken()).toBe("Niente da ripetere.");
    tap(2, 400);
    expect(banco.editor.engine.text).toBe(drawn);
    tap(2, 60, 30);
    expect(banco.editor.engine.text).toBe(drawn);
    banco.editor.setGrid({ ...banco.editor.grid, taps: false });
    tap(2);
    expect(banco.editor.engine.text).toBe(drawn);
  });

  it("«Penna e dita…», da «Pagina e griglia», sceglie i gesti e la curva della penna, che preme con lei", async () => {
    const grids: unknown[] = [];
    mount(SOURCE, { onGridChange: (grid) => grids.push(grid) });
    size(200, 100);
    pageButton().click();
    entry("Penna e dita…").click();
    expect(dialog().querySelector("h2")!.textContent).toBe("Penna e dita");
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    const checks = [...dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checks.map((check) => [check.closest("label")!.textContent, check.checked])).toEqual([
      ["Due dita che ruotano girano il foglio", true],
      ["Un tocco di due dita annulla, uno di tre ripete", true],
      ["Tira il tratto con una corda: un tremito più corto della corda non lo muove", false],
    ]);
    expect(document.activeElement).toBe(checks[0]);
    checks[0]!.click();
    const soft = [...dialog().querySelectorAll<HTMLInputElement>('input[type="range"]')][0]!;
    expect(soft.closest("label")!.querySelector("span")!.textContent).toBe("Morbidezza");
    soft.value = "100";
    soft.dispatchEvent(new Event("input", { bubbles: true }));
    expect(soft.getAttribute("aria-valuetext")).toBe("+100%");
    await submit();
    expect(spoken()).toBe("Penna e dita aggiornate.");
    expect(banco.editor.grid.twist).toBe(false);
    expect(banco.editor.grid.taps).toBe(true);
    expect(banco.editor.grid.pen).toEqual({ soft: 1, min: 0, full: 1 });
    // Lo stabilizzatore lasciato a zero resta spento.
    expect(banco.editor.grid.steady).toEqual({ amount: 0, string: false });
    expect(grids[grids.length - 1]).toEqual(banco.editor.grid);

    // Un ottavo della corsa, sulla curva più morbida, è metà pressione.
    const PEN = { pointerId: 5, pointerType: "pen" } as const;
    const target = surface();
    target.dispatchEvent(pointer("pointerdown", { ...PEN, button: 0, buttons: 1, pressure: 0.125, clientX: 10, clientY: 10, timeStamp: (banco.clock += 8) }));
    for (const x of [20, 30, 40]) target.dispatchEvent(pointer("pointermove", { ...PEN, button: -1, buttons: 1, pressure: 0.125, clientX: x, clientY: 10, timeStamp: (banco.clock += 8) }));
    target.dispatchEvent(pointer("pointerup", { ...PEN, button: 0, buttons: 0, pressure: 0, clientX: 40, clientY: 10, timeStamp: (banco.clock += 8) }));
    const ink = decodeInk(/fub:ink="([^"]+)"/.exec(banco.editor.engine.text)![1]!);
    const width = ink.channels.length;
    const pressures = ink.values.filter((_, i) => i % width === ink.channels.indexOf("p"));
    expect(pressures.length).toBeGreaterThan(1);
    for (const p of pressures) expect(p).toBe(128);
  });
});

describe("il menu radiale", () => {
  const A = "o1a2b3c4d";
  const radial = (): HTMLElement | null => document.querySelector<HTMLElement>(".draw-radial:not([data-shell-motion='exit'])");
  /// Le voci, dall'alto in senso orario: il nome, o `-` per una spenta.
  const voices = (): string[] =>
    [...radial()!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].map(
      (one) => `${one.dataset.direction} ${one.getAttribute("aria-label")}${one.getAttribute("aria-disabled") === "true" ? " -" : ""}`,
    );
  const voice = (label: string): HTMLButtonElement =>
    [...radial()!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((one) => one.getAttribute("aria-label") === label)!;
  /// Il menu contestuale, sull'orologio dei puntatori delle prove: della
  /// penna, che col mouse apre il menu della selezione.
  const rightClick = (x: number, y: number, init: Init = {}): MouseEvent => {
    const event = pointer("contextmenu", { button: 2, pointerType: "pen", clientX: x, clientY: y, timeStamp: (banco.clock += 8), ...init });
    surface().dispatchEvent(event);
    return event;
  };
  /// Le voci del menu contestuale aperto.
  const entries = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>(".context-menu [role^='menuitem']")];
  const onPage = (type: string, init: Init): void => {
    document.dispatchEvent(pointer(type, init));
  };

  beforeEach(() => setReducedMotionPreference(true));
  afterEach(() => {
    closeRadial();
    for (const open of document.querySelectorAll(".draw-radial")) open.remove();
    closeContextMenu();
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
    setReducedMotionPreference(false);
  });

  it("il clic destro con la penna lo apre: annulla in alto, gli strumenti di prima a destra, i colori a sinistra", () => {
    mount(SOURCE);
    size(200, 100);
    surface().focus();
    expect(rightClick(100, 50).defaultPrevented).toBe(true);
    expect(radial()!.querySelector('[role="menu"]')!.getAttribute("aria-label")).toBe("Menu radiale");
    // Chi non ha ancora cambiato strumento o colore trova i più comuni.
    expect(voices()).toEqual([
      "n Annulla -",
      "ne Selezione",
      "e Gomma",
      "se Evidenziatore",
      "s Ripeti -",
      "sw Colore: Verde",
      "w Colore: Blu",
      "nw Colore: Vermiglio",
    ]);
    expect(formatIssues(checkAccessibility(radial()!))).toBe("");
    voice("Gomma").click();
    expect(radial()).toBeNull();
    expect(banco.editor.tool).toBe("eraser");
    expect(spoken()).toBe("Strumento: Gomma.");
    expect(document.activeElement).toBe(surface());

    rightClick(100, 50);
    expect(voices().slice(1, 4)).toEqual(["ne Selezione", "e Inchiostro", "se Evidenziatore"]);
    voice("Colore: Blu").click();
    expect(spoken()).toBe("Colore: Blu.");
    banco.editor.setTool("pen");
    expect(well().getAttribute("aria-label")).toBe("Colore: Blu");
    rightClick(100, 50);
    // Il colore e lo strumento di prima, in orizzontale: un gesto solo per
    // tornarci.
    expect(voices().slice(1, 4)).toEqual(["ne Selezione", "e Gomma", "se Evidenziatore"]);
    expect(voices().slice(5)).toEqual(["sw Colore: Verde", "w Colore: Nero", "nw Colore: Vermiglio"]);
  });

  it("i colori a sinistra sono i recenti che chi monta l'editor ricorda, senza quello di adesso", () => {
    /// Le voci a sinistra, quelle dei colori.
    const colors = (): string[] => voices().filter((each) => /^(sw|w|nw) /.test(each));
    mount(SOURCE, { colors: ["#3a7bd5", "#000000", "#cc79a7", "#56b4e9"] });
    size(200, 100);
    surface().focus();
    rightClick(100, 50);
    expect(colors()).toEqual(["sw Colore: Azzurro", "w Colore: Personalizzato #3a7bd5", "nw Colore: Porpora"]);
    voice("Colore: Personalizzato #3a7bd5").click();
    expect(spoken()).toBe("Colore: Personalizzato #3a7bd5.");
  });

  it("tenuto premuto segue il puntatore: lasciato verso una voce la sceglie, e non disegna", () => {
    mount(SOURCE);
    size(200, 100);
    drag([[10, 10], [40, 10]]);
    const drawn = banco.editor.engine.text;
    // Il menu sta intero nella finestra: aperto lontano dai bordi, il suo
    // centro è il punto del tocco lungo.
    const FINGER = { pointerId: 9, pointerType: "touch" } as const;
    surface().dispatchEvent(pointer("pointerdown", { ...FINGER, button: 0, buttons: 1, pressure: 0.5, clientX: 400, clientY: 300, timeStamp: (banco.clock += 8) }));
    rightClick(400, 300, { pointerType: "touch", buttons: 1 });
    expect(radial()).not.toBeNull();
    onPage("pointermove", { ...FINGER, button: -1, buttons: 1, pressure: 0.5, clientX: 410, clientY: 200, timeStamp: (banco.clock += 8) });
    expect(voice("Annulla").hasAttribute("data-hot")).toBe(true);
    expect(radial()!.querySelector(".draw-radial-caption")!.textContent).toMatch(/^Annulla · /);
    onPage("pointerup", { ...FINGER, button: 0, buttons: 0, pressure: 0, clientX: 410, clientY: 200, timeStamp: (banco.clock += 8) });
    expect(radial()).toBeNull();
    expect(banco.editor.engine.text).toBe(SOURCE);
    expect(spoken()).toBe("Annullato: Tratto.");
    // Aperto senza il puntatore giù, il menu resta aperto.
    rightClick(100, 50);
    expect(radial()).not.toBeNull();
    voice("Ripeti").click();
    expect(banco.editor.engine.text).toBe(drawn);
  });

  it("il tasto laterale della penna lo apre dov'è la penna; il clic destro che il sistema manda dopo non lo riapre", () => {
    mount(SOURCE);
    size(200, 100);
    const PEN = { pointerId: 6, pointerType: "pen" } as const;
    const down = pointer("pointerdown", { ...PEN, button: 2, buttons: 2, pressure: 0.3, clientX: 400, clientY: 300, timeStamp: (banco.clock += 8) });
    surface().dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(radial()).not.toBeNull();
    onPage("pointermove", { ...PEN, button: -1, buttons: 2, pressure: 0.3, clientX: 480, clientY: 310, timeStamp: (banco.clock += 8) });
    onPage("pointerup", { ...PEN, button: 2, buttons: 0, pressure: 0, clientX: 480, clientY: 310, timeStamp: (banco.clock += 8) });
    expect(banco.editor.tool).toBe("eraser");
    expect(radial()).toBeNull();
    expect(rightClick(480, 310, { pointerType: "pen" }).defaultPrevented).toBe(true);
    expect(radial()).toBeNull();
    expect(banco.editor.engine.text).toBe(SOURCE);
  });

  it("la penna girata cancella con qualunque strumento, e lo strumento resta", () => {
    mount(SOURCE);
    size(200, 100);
    drag([[10, 10], [40, 10]]);
    expect(banco.editor.engine.text).not.toBe(SOURCE);
    const ERASER = { pointerId: 6, pointerType: "pen", button: 5, buttons: 32 } as const;
    drag([[25, 2], [25, 18]], ERASER);
    expect(banco.editor.engine.text).toBe(SOURCE);
    expect(banco.editor.tool).toBe("pen");
  });

  it("il tasto laterale fa ciò che si è scelto: la gomma o niente", () => {
    mount(SOURCE);
    size(200, 100);
    drag([[10, 10], [40, 10]]);
    const drawn = banco.editor.engine.text;
    const BARREL = { pointerId: 6, pointerType: "pen", button: 2, buttons: 2 } as const;
    banco.editor.setGrid({ ...banco.editor.grid, barrel: "none" });
    drag([[25, 2], [25, 18]], BARREL);
    expect(radial()).toBeNull();
    expect(banco.editor.engine.text).toBe(drawn);
    banco.editor.setGrid({ ...banco.editor.grid, barrel: "eraser" });
    drag([[25, 2], [25, 18]], BARREL);
    expect(banco.editor.engine.text).toBe(SOURCE);
    expect(banco.editor.tool).toBe("pen");
  });

  it("il tocco lungo del dito che disegna lo apre senza lasciare un punto; alzato nel mezzo, resta aperto", () => {
    mount(SOURCE);
    size(200, 100);
    const FINGER = { pointerId: 9, pointerType: "touch" } as const;
    surface().dispatchEvent(pointer("pointerdown", { ...FINGER, button: 0, buttons: 1, pressure: 0.5, clientX: 100, clientY: 50, timeStamp: (banco.clock += 8) }));
    rightClick(100, 50, { pointerType: "touch", buttons: 1 });
    expect(radial()).not.toBeNull();
    onPage("pointerup", { ...FINGER, button: 0, buttons: 0, pressure: 0, clientX: 102, clientY: 51, timeStamp: (banco.clock += 8) });
    expect(radial()).not.toBeNull();
    expect(banco.editor.engine.text).toBe(SOURCE);
    key("Escape", {}, document.activeElement as HTMLElement);
    expect(radial()).toBeNull();
    expect(document.activeElement).toBe(surface());
  });

  it("col mouse e con Maiusc+F10 si apre il menu del foglio, e il radiale è la sua ultima voce, col fuoco sulla prima voce che vale", () => {
    mount(SOURCE);
    size(200, 100);
    expect(rightClick(100, 50, { pointerType: "mouse" }).defaultPrevented).toBe(true);
    expect(radial()).toBeNull();
    expect(entries().map((one) => one.querySelector(".menu-label")!.textContent).slice(0, 2)).toEqual(["Incolla", "Incolla nello stesso punto"]);
    closeContextMenu();
    surface().focus();
    expect(key("F10", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(radial()).toBeNull();
    const last = entries()[entries().length - 1]!;
    expect(last.querySelector(".menu-label")!.textContent).toBe("Menu radiale");
    last.click();
    expect(document.querySelector(".context-menu:not([data-shell-motion='exit'])")).toBeNull();
    expect(radial()).not.toBeNull();
    // Niente da annullare: il fuoco va alla prima voce che vale.
    expect(document.activeElement).toBe(voice("Selezione"));
    expect(radial()!.querySelector(".draw-radial-caption")!.textContent).toBe("Selezione · V");
    key("ArrowRight", {}, document.activeElement as HTMLElement);
    expect(radial()!.querySelector(".draw-radial-caption")!.textContent).toBe("Gomma · E");
    key("Escape", {}, document.activeElement as HTMLElement);
    expect(document.activeElement).toBe(surface());
    banco.editor.select([A]);
    key("F10", { shiftKey: true });
    expect(radial()).toBeNull();
    expect(document.querySelector(".context-menu")).not.toBeNull();
    // Senza il menu della selezione Maiusc+F10 apre il radiale.
    closeContextMenu();
    banco.editor.setSpace("simple");
    surface().focus();
    expect(key("F10", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(radial()).not.toBeNull();
  });

  it("con gli strumenti che scelgono il clic destro resta quello di prima", () => {
    mount(SOURCE);
    size(200, 100);
    banco.editor.setTool("select");
    rightClick(100, 50);
    expect(radial()).toBeNull();
    expect(document.querySelector(".context-menu")).not.toBeNull();
    closeContextMenu();
  });
});

describe("le tavole dei disegni che le hanno", () => {
  const SQUARE = "oa1a1a1a1";
  /// Due tavole 400 × 200, la seconda a 80 unità dalla prima, con un
  /// quadrato sopra.
  const BOARDS = doc(
    "<title>Ciclo</title>" +
      '<rect id="fub-paper" fub:role="paper" fub:board="b1a2b3c4d" x="0" y="0" width="400" height="200" fill="#fafafa"/>' +
      '<rect id="c5e6f7g8h" fub:role="paper" fub:board="b9i0j1k2l" x="480" y="0" width="400" height="200" fill="#fafafa"/>' +
      '<view id="b1a2b3c4d" fub:role="board" viewBox="0 0 400 200"><title>Copertina</title></view>' +
      '<view id="b9i0j1k2l" fub:role="board" viewBox="480 0 400 200"><title>Evaporazione</title></view>' +
      `${LAYER}<rect id="${SQUARE}" x="600" y="50" width="20" height="20" fill="#000000"/></g>`,
  ).replace('viewBox="0 0 100 100"', 'viewBox="0 0 1024 256"');

  const names = (): Array<[string | null, boolean]> =>
    [...banco.host.querySelectorAll<HTMLElement>(".draw-sheet-name")].map((name) => [name.textContent, name.hasAttribute("data-chosen")]);
  /// Dove stanno le carte delle tavole sullo schermo.
  const sheets = (): string[] => [...banco.host.querySelectorAll<HTMLElement>(".draw-sheets .draw-page")].map((sheet) => sheet.style.transform);

  it("dall'indice una tavola si sceglie e si inquadra, e la selezione resta", () => {
    mount(BOARDS);
    size(1000, 500);
    banco.editor.select([SQUARE]);
    const before = sheets();
    expect(banco.editor.reveal(BOARDS.indexOf('<view id="b9i0j1k2l"'))).toBe(true);
    expect(spoken()).toBe("Evaporazione, tavola 2 di 2, 400 × 200.");
    expect(sheets()).not.toEqual(before);
    expect(banco.editor.selection).toEqual([SQUARE]);
    // Un oggetto si sceglie come sempre.
    banco.editor.select([]);
    expect(banco.editor.reveal(BOARDS.indexOf(`<rect id="${SQUARE}"`))).toBe(true);
    expect(banco.editor.selection).toEqual([SQUARE]);
    // Il nome è dentro la tavola, e porta a lei; lo strumento Tavola la
    // trova scelta.
    expect(banco.editor.reveal(BOARDS.indexOf("<title>Copertina"))).toBe(true);
    expect(spoken()).toBe("Copertina, tavola 1 di 2, 400 × 200.");
  });

  it("si vedono coi loro nomi, ma lo strumento, i suoi tasti e l'elenco non ci sono più (ADR 0231)", () => {
    mount(BOARDS);
    size(1000, 500);
    key("f");
    key("PageDown", { altKey: true });
    expect(banco.editor.tool).toBe("pen");
    expect(spoken()).toBe("");
    expect(names()).toEqual([["Copertina", false], ["Evaporazione", false]]);
    expect(banco.host.querySelector('[role="toolbar"] button[aria-label="Tavole"]')).toBeNull();
  });
});

describe("«Esporta»: ciò che il disegno offre", () => {
  const SQUARE = "oa1a1a1a1";
  /// Due tavole, un quadrato con l'id e un triangolo senza.
  const SOURCE_EXPORT = doc(
    "<title>Ciclo</title>" +
      '<rect id="fub-paper" fub:role="paper" fub:board="b1a2b3c4d" x="0" y="0" width="400" height="200" fill="#fafafa"/>' +
      '<rect id="c5e6f7g8h" fub:role="paper" fub:board="b9i0j1k2l" x="480" y="0" width="400" height="200" fill="#fafafa"/>' +
      '<view id="b1a2b3c4d" fub:role="board" viewBox="0 0 400 200"><title>Copertina</title></view>' +
      '<view id="b9i0j1k2l" fub:role="board" viewBox="480 0 400 200"><title>Evaporazione</title></view>' +
      `${LAYER}<rect id="${SQUARE}" x="600" y="50" width="20" height="20" fill="#000000"/><path d="M10 10 L30 10 L30 30 Z" fill="#000000"/></g>`,
  ).replace('viewBox="0 0 100 100"', 'viewBox="0 0 1024 256"');
  const BOARDS_OFFERED = [
    { id: "b1a2b3c4d", name: "Copertina" },
    { id: "b9i0j1k2l", name: "Evaporazione" },
  ];

  it("senza selezione, le tavole nel loro ordine", () => {
    mount(SOURCE_EXPORT);
    expect(banco.editor.exportScene()).toEqual({ scene: { selection: null, boards: BOARDS_OFFERED }, naming: null, named: 0 });
  });

  it("la selezione per id, col riquadro sui numeri interi, e gli id che mancano pronti in un passo che non è ancora scritto", () => {
    mount(SOURCE_EXPORT);
    key("a", { ctrlKey: true });
    const offer = banco.editor.exportScene();
    const naming = offer.naming as { op: "batch"; ops: { op: string; path: number[]; tag: string; id: string }[] };
    expect(naming.op).toBe("batch");
    expect(naming.ops).toHaveLength(1);
    const [ident] = naming.ops;
    expect(ident).toMatchObject({ op: "ident", tag: "path" });
    expect(ident!.id).toMatch(/^o[0-9a-z]{8}$/);
    expect(offer.named).toBe(1);
    expect(offer.scene).toEqual({
      selection: { count: 2, ids: [SQUARE, ident!.id], box: [10, 10, 610, 60] },
      boards: BOARDS_OFFERED,
    });
    expect(banco.editor.engine.text, "chiedere non scrive").toBe(SOURCE_EXPORT);
    // Il passo, se lo si fa, dà proprio quegli id, e si annulla.
    expect(banco.editor.perform("draw.action.export_ids", offer.naming!)).toBe(true);
    expect(banco.editor.engine.text).toContain(`<path id="${ident!.id}"`);
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(SOURCE_EXPORT);
  });

  it("in sola lettura gli id non si danno: la selezione resta con quelli che ha", () => {
    mount(SOURCE_EXPORT);
    key("a", { ctrlKey: true });
    banco.editor.setReadOnly(true);
    expect(banco.editor.exportScene()).toEqual({
      scene: { selection: { count: 2, ids: [SQUARE], box: [10, 10, 610, 60] }, boards: BOARDS_OFFERED },
      naming: null,
      named: 0,
    });
  });
});

describe("le punte delle linee, nel Completo", () => {
  const L = "ol1l1l1l1";
  const LINE = doc(`${LAYER}<line id="${L}" x1="20" y1="40" x2="120" y2="40" stroke="#d55e00" stroke-width="2"/></g>`);
  const face = (id: string): HTMLButtonElement => property(id).querySelector<HTMLButtonElement>(".draw-properties-menu")!;
  const menu = (): HTMLButtonElement[] => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>("button")];
  };
  const labelOf = (entry: HTMLElement): string => entry.querySelector(".menu-label")!.textContent ?? "";
  /// Apre il menu del campo `id` e ne preme la voce `label`.
  const pick = (id: string, label: string): void => {
    face(id).click();
    menu().find((entry) => labelOf(entry) === label)!.click();
  };
  const markers = (): string[] => [...banco.editor.engine.text.matchAll(/<marker [^>]*>/g)].map((match) => match[0]);

  it("dal pannello una punta prende il colore della linea, e lo segue, ogni scelta in un passo col suo nome", () => {
    mount(LINE);
    banco.editor.select([L]);
    key("Enter");
    expect(face("tipEnd").getAttribute("aria-label")).toBe("Punta di fine: Nessuna");
    pick("tipEnd", "Triangolo");
    expect(markers()).toEqual([expect.stringContaining('fub:marker="triangle medium end"')]);
    expect(banco.editor.engine.text).toMatch(/<path d="[^"]+" fill="#d55e00"\/>/);
    expect(banco.editor.engine.text).toMatch(new RegExp(`<line id="${L}" [^>]*marker-end="url\\(#r\\w+\\)"/>`));
    expect(face("tipEnd").getAttribute("aria-label")).toBe("Punta di fine: Triangolo, media");
    pick("tipEnd", "Grande");
    expect(markers()).toEqual([expect.stringContaining('fub:marker="triangle large end"')]);
    // Il contorno nuovo ricolora la punta nello stesso passo, e la punta
    // rossa, che nessuno usa più, se ne va.
    enter(propertyInput("stroke"), "#0072b2");
    expect(markers()).toHaveLength(1);
    expect(banco.editor.engine.text).toMatch(/<path d="[^"]+" fill="#0072b2"\/>/);
    expect(banco.editor.engine.text).not.toContain("#d55e00");
    banco.editor.undo();
    expect(spoken()).toBe("Annullato: Colore del contorno.");
    expect(banco.editor.engine.text).toMatch(/<path d="[^"]+" fill="#d55e00"\/>/);
    banco.editor.undo();
    expect(spoken()).toBe("Annullato: Misura della punta.");
    banco.editor.undo();
    expect(spoken()).toBe("Annullato: Punta di fine.");
    expect(banco.editor.engine.text).toBe(LINE);
  });

  it("«Scambia inizio e fine» porta la punta al capo opposto, e Esc chiude il menu tornando al pulsante", () => {
    mount(LINE);
    banco.editor.select([L]);
    key("Enter");
    pick("tipStart", "Cerchio");
    pick("tipEnd", "Scambia inizio e fine");
    expect(markers()).toEqual([expect.stringContaining('fub:marker="circle medium end"')]);
    expect(banco.editor.engine.text).not.toContain("marker-start");
    expect(face("tipStart").getAttribute("aria-label")).toBe("Punta d’inizio: Nessuna");
    expect(face("tipEnd").getAttribute("aria-label")).toBe("Punta di fine: Cerchio, media");
    face("tipEnd").focus();
    face("tipEnd").click();
    expect(face("tipEnd").getAttribute("aria-expanded")).toBe("true");
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(face("tipEnd").getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(face("tipEnd"));
    banco.editor.undo();
    expect(spoken()).toBe("Annullato: Punte scambiate.");
  });
});
