// @vitest-environment happy-dom
// L'editor del disegno, dal puntatore al testo: ogni strumento produce le
// operazioni attese, annulla e ripeti le disfano, e chi non vede sente che
// cosa è successo.
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_GRID } from "./grid";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { closeContextMenu } from "../../../ui/menu";
import { doc } from "../scene/test-support";
import { MERGE_MS } from "./history";
import { LAYER } from "./test-support";
import { MOUSE, SOURCE, banco, drag, key, mount, pointer, railNames, railSlots, railTool, spoken, surface, well } from "./editor-test-support";

// happy-dom non disegna: il PNG degli appunti è il testo che riceve.
vi.mock("./png", async (real) => ({
  ...(await real<typeof import("./png")>()),
  rasterize: vi.fn(async (svg: string) => new Blob([svg], { type: "image/png" })),
}));

/// Il selettore del colore, aperto dal pozzo se non lo è.
function picker(): HTMLElement {
  if (well().getAttribute("aria-expanded") !== "true") well().click();
  return document.querySelector<HTMLElement>(".kit-color-popover")!;
}

/// Sceglie nel selettore il campione che si chiama `name`.
function pickSwatch(name: string): void {
  picker().querySelector<HTMLButtonElement>(`.kit-color-swatch[aria-label="${name}"]`)!.click();
}

/// Scrive `code` nel campo del codice del selettore, e Invio.
function typeColor(code: string): void {
  const input = picker().querySelector<HTMLInputElement>(".kit-color-input")!;
  input.focus();
  input.value = code;
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
}

/// I nomi dei campioni del selettore, gruppo per gruppo.
function pickerGroups(): string[][] {
  return [...picker().querySelectorAll<HTMLElement>(".kit-color-group")].map((group) => [
    group.querySelector(".kit-color-group-title")!.textContent!,
    ...[...group.querySelectorAll<HTMLElement>(".kit-color-swatch")].map((swatch) => swatch.getAttribute("aria-label")!),
  ]);
}

describe("la barra e il foglio", () => {
  it("mettono in fila strumenti, colori, spessori, modifica e vista, e il titolo", () => {
    mount();
    const toolbar = banco.host.querySelector('[role="toolbar"]')!;
    expect(toolbar.getAttribute("aria-label")).toBe("Strumenti di disegno");
    // La barra è la testa intera; la riga delle opzioni è una fila dentro.
    expect(toolbar.classList.contains("draw-header")).toBe(true);
    expect(toolbar.querySelector(".draw-toolbar")!.hasAttribute("role")).toBe(false);
    const groups = [...toolbar.querySelectorAll(".draw-toolbar .draw-group:not([hidden])")].map((group) => [group.getAttribute("role"), group.getAttribute("aria-label")]);
    expect(groups).toEqual([
      ["group", "Colore"],
      ["radiogroup", "Spessore"],
      ["group", "Penna"],
      ["group", "Modifica"],
      ["group", "Livelli"],
      ["group", "Vista"],
    ]);
    // Gli strumenti stanno nella colonna, a sinistra del foglio: le forme in
    // una casella con la tendina, che mostra il rettangolo.
    const rail = banco.host.querySelector('.draw-rail [role="toolbar"]')!;
    expect(rail.getAttribute("aria-label")).toBe("Strumenti");
    expect(rail.getAttribute("aria-orientation")).toBe("vertical");
    const tools = railSlots();
    expect(tools.map((control) => control.getAttribute("aria-label"))).toEqual(["Selezione", "Mano", "Inchiostro", "Gomma", "Rettangolo", "Testo"]);
    expect(tools.map((control) => control.getAttribute("aria-pressed"))).toEqual(["false", "false", "true", "false", "false", "false"]);
    expect(tools[5]!.getAttribute("aria-keyshortcuts")).toBe("T");
    expect(railNames()).toEqual(["Selezione", "Mano", "Zoom", "Inchiostro", "Evidenziatore", "Gomma", "Rettangolo", "Ellisse", "Linea", "Freccia", "Testo"]);
    // Una casella con tendina dice anche la freccia di lato, che la apre.
    expect(tools[4]!.getAttribute("aria-keyshortcuts")).toBe("R ArrowRight");
    tools[4]!.focus();
    expect(document.getElementById(tools[4]!.getAttribute("aria-describedby")!)?.textContent).toMatch(/^Rettangolo \(R\) — .*Maiusc/);
    // Il colore è un pozzo col nome, niente formine: apre il selettore, con
    // gli otto colori consigliati in cima.
    expect(well().getAttribute("aria-label")).toBe("Colore: Nero");
    expect(toolbar.querySelectorAll(".draw-color, .draw-swatch")).toHaveLength(0);
    expect(toolbar.querySelectorAll('.draw-width[role="radio"]')).toHaveLength(3);
    expect(banco.host.querySelector<HTMLInputElement>(".draw-title-input")!.value).toBe("Prova");
    expect(banco.host.querySelector(".draw-title-label")!.textContent).toBe("Che cosa hai disegnato?");
    expect(surface().getAttribute("role")).toBe("application");
    expect(surface().getAttribute("aria-label")).toBe("Foglio del disegno");
  });

  it("danno alla testa un solo punto di tabulazione, e le frecce la percorrono dal menu a «Esporta»", () => {
    mount(SOURCE, { onExport: () => {} });
    const header = banco.host.querySelector<HTMLElement>('.draw-header[role="toolbar"]')!;
    const controls = (): HTMLElement[] => [...header.querySelectorAll<HTMLElement>("button, input, select")];
    const reachable = (): HTMLElement[] =>
      controls().filter((control) => !(control as HTMLButtonElement).disabled && control.closest("[hidden]") === null && !(control instanceof HTMLInputElement && control.type === "range"));
    // Un solo controllo della testa sta nel Tab: il menu del disegno, il primo.
    const stops = controls().filter((control) => control.tabIndex === 0);
    expect(stops.map((control) => control.getAttribute("aria-label"))).toEqual(["Disegno"]);
    const menu = stops[0]!;
    menu.focus();
    key("ArrowRight", {}, menu);
    const second = reachable()[1]!;
    expect(document.activeElement).toBe(second);
    expect(second.tabIndex).toBe(0);
    expect(menu.tabIndex).toBe(-1);
    // Ai capi la fila gira: «Esporta» è l'ultimo, e da lì si torna al menu.
    key("End", {}, second);
    const last = document.activeElement as HTMLElement;
    expect(last.getAttribute("aria-label")).toBe("Esporta");
    key("ArrowRight", {}, last);
    expect(document.activeElement).toBe(menu);
    key("ArrowLeft", {}, menu);
    expect(document.activeElement).toBe(last);
    key("Home", {}, last);
    expect(document.activeElement).toBe(menu);
    expect(controls().filter((control) => control.tabIndex === 0)).toEqual([menu]);
  });

  it("vestono la testa del kit: il vassoio, i foglietti e i pulsanti", () => {
    mount(SOURCE, { onExport: () => {} });
    const header = banco.host.querySelector<HTMLElement>(".draw-header")!;
    expect(header.classList.contains("kit-bar")).toBe(true);
    for (const group of header.querySelectorAll(".draw-group")) expect(group.classList.contains("kit-bar-group"), group.getAttribute("aria-label") ?? group.className).toBe(true);
    for (const control of header.querySelectorAll(".draw-button")) expect(control.classList.contains("kit-bar-button"), control.getAttribute("aria-label") ?? "").toBe(true);
    // La colonna e la barra della selezione hanno la loro pelle.
    for (const control of banco.host.querySelectorAll(".draw-rail .draw-button, .draw-arrange .draw-button")) expect(control.classList.contains("kit-bar-button")).toBe(false);
    expect(banco.host.querySelector(".draw-rail .draw-group")!.classList.contains("kit-bar-group")).toBe(false);
  });

  it("hanno in alto il menu del disegno, Annulla e Ripeti", () => {
    mount();
    const header = banco.host.querySelector<HTMLElement>(".draw-header")!;
    const top = (): string[] => [...header.querySelectorAll<HTMLButtonElement>(".draw-top button")].map((control) => control.getAttribute("aria-label")!);
    expect(top()).toEqual(["Disegno", "Annulla", "Ripeti"]);
    expect(header.querySelector('.draw-toolbar button[aria-label="Annulla"]')).toBeNull();
    const menuButton = header.querySelector<HTMLButtonElement>('button[aria-label="Disegno"]')!;
    expect(menuButton.getAttribute("aria-haspopup")).toBe("menu");
    menuButton.click();
    const labels = (): string[] =>
      [...document.querySelectorAll<HTMLElement>(".context-menu .menu-label")].map((label) => label.textContent!);
    expect(labels()).toContain("Titolo del disegno…");
    expect(labels()).toContain("Tasti del disegno");
    expect(labels()).not.toContain("Esporta…");
    const title = [...document.querySelectorAll<HTMLElement>(".context-menu [role=menuitem]")].find(
      (entry) => entry.querySelector(".menu-label")!.textContent === "Titolo del disegno…",
    )!;
    title.click();
    expect(document.activeElement).toBe(banco.host.querySelector(".draw-title-input"));
    closeContextMenu();
  });

  it("hanno «Esporta», in alto e nel menu, se chi monta sa esportare", () => {
    const onExport = vi.fn();
    mount(SOURCE, { onExport });
    const fresh = banco.host.querySelector<HTMLElement>(".draw-header")!;
    const exportButton = fresh.querySelector<HTMLButtonElement>('.draw-top button[aria-label="Esporta"]')!;
    expect(exportButton.textContent).toBe("Esporta");
    exportButton.click();
    expect(onExport).toHaveBeenCalledTimes(1);
    fresh.querySelector<HTMLButtonElement>('button[aria-label="Disegno"]')!.click();
    const labels = [...document.querySelectorAll<HTMLElement>(".context-menu .menu-label")].map((label) => label.textContent!);
    expect(labels).toContain("Esporta…");
    closeContextMenu();
  });

  it("dicono lo zoom con la percentuale che si vede", () => {
    mount();
    const zoom = banco.host.querySelector<HTMLButtonElement>(".draw-zoom-level")!;
    expect(zoom.textContent).toMatch(/^100\s?%$/);
    expect(zoom.getAttribute("aria-label")).toBe(`${zoom.textContent}: riporta lo zoom al 100%`);
    key("+");
    expect(zoom.textContent).toMatch(/^125\s?%$/);
    expect(zoom.getAttribute("aria-label")).toContain(zoom.textContent!);
  });
});

describe("gli strumenti", () => {
  it("il rettangolo scrive un `add` nel livello, e lo annuncia", () => {
    mount();
    banco.editor.setTool("rect");
    expect(spoken()).toBe("Strumento: Rettangolo.");
    drag([[10, 10], [30, 20], [50, 40]]);
    expect(banco.changes.map((change) => change.origin)).toEqual(["input"]);
    expect(banco.editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="10" y="10" width="40" height="30" fill="none" stroke="#000000" stroke-width="4"\/>/);
    expect(spoken()).toBe("Rettangolo aggiunto. Il disegno ha 2 oggetti.");
    expect(banco.changes[0]!.text).toBe(banco.editor.engine.text);
  });

  it("con il colore e lo spessore scelti", () => {
    mount();
    banco.editor.setTool("ellipse");
    banco.editor.setColor("#0072b2");
    banco.editor.setWidth(8);
    drag([[10, 10], [50, 30]]);
    expect(banco.editor.engine.text).toMatch(/<ellipse id="o[a-z0-9]{8}" cx="30" cy="20" rx="20" ry="10" fill="none" stroke="#0072b2" stroke-width="8"\/>/);
  });

  it("nel disegno si disegna anche fuori dalla pagina, che si allarga: il limite è solo delle annotazioni di un PDF", () => {
    // La pagina è 100 × 100: il rettangolo comincia fuori e ci resta.
    mount();
    banco.editor.setTool("rect");
    drag([[150, 150], [200, 180], [250, 200]]);
    expect(banco.editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="150" y="150" width="100" height="50"/);
    banco.editor.setTool("pen");
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: 300, clientY: 300 }));
    expect(surface().hasAttribute("data-off-page")).toBe(false);
    drag([[300, 300], [340, 300], [380, 310]]);
    expect(banco.changes).toHaveLength(2);
  });

  it("un tocco con una forma non scrive niente", () => {
    mount();
    banco.editor.setTool("line");
    drag([[10, 10], [11, 11]]);
    expect(banco.changes).toEqual([]);
  });

  it("la penna scrive un tratto col suo inchiostro", () => {
    mount();
    expect(banco.editor.tool).toBe("pen");
    drag([[10, 10], [14, 12], [20, 15], [28, 16], [36, 16]]);
    expect(banco.editor.engine.text).toMatch(/<path id="o[a-z0-9]{8}" fub:tool="pen" fub:at="[^"]+Z" fub:brush="pf1 size=4 [^"]*" d="M[^"]+" fill="#000000" fub:ink="1 [^"]+"\/>/);
    expect(spoken()).toBe("Tratto aggiunto. Il disegno ha 2 oggetti.");
  });

  it("con lo stabilizzatore di «Penna e dita» la corda assorbe il tremito del tratto", () => {
    const shaky: [number, number][] = [[10, 10], [14, 13], [18, 9], [22, 13], [26, 9], [30, 13], [34, 9], [60, 11]];
    const pathOf = (): string => /fub:tool="pen"[^>]* d="([^"]+)"/.exec(banco.editor.engine.text)![1]!;
    mount(SOURCE);
    drag(shaky);
    const raw = pathOf();
    banco.editor.dispose();
    mount(SOURCE, { grid: { ...DEFAULT_GRID, steady: { amount: 1, string: true } } });
    drag(shaky);
    const steady = pathOf();
    expect(steady).not.toBe(raw);
    // La corda tiene fermo il pennino sotto un tremito più corto di lei: il
    // contorno del tratto stabilizzato è più basso di quello che trema.
    const span = (d: string): number => {
      const ys = [...d.matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => Number(m[2]));
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(span(steady)).toBeLessThan(span(raw));
  });

  it("la gomma toglie gli oggetti interi che attraversa", () => {
    mount();
    banco.editor.setTool("eraser");
    drag([[50, 70], [56, 70], [64, 70]]);
    expect(banco.editor.engine.text).not.toContain("o1a2b3c4d");
    expect(spoken()).toBe("1 oggetto cancellato. Il disegno ha 0 oggetti.");
  });

  it("la gomma su un oggetto di un gruppo estraneo toglie lui solo, non il gruppo coi suoi vicini", () => {
    // Come un livello di Inkscape: un `<g>` della radice senza `fub:layer`,
    // con dentro tutto il disegno, un collegamento e un figlio bloccato.
    const source = doc(
      '<g id="strade"><rect id="a" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/>'
        + '<rect id="b" x="200" y="200" width="20" height="20"/>'
        + '<a href="parco.md" id="link"><rect id="c" x="300" y="60" width="20" height="20"/></a>'
        + '<rect id="fermo" x="60" y="60" width="20" height="20" fub:locked="true"/></g>',
    );
    mount(source);
    const before = banco.editor.engine.text;
    banco.editor.setTool("eraser");
    drag([[50, 70], [56, 70], [64, 70]]);
    const after = banco.editor.engine.text;
    expect(after).not.toContain('id="a"');
    for (const kept of ['id="strade"', 'id="b"', 'id="link"', 'id="c"', 'id="fermo"']) expect(after).toContain(kept);
    expect(spoken()).toBe("1 oggetto cancellato. Il disegno ha 1 oggetto.");
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(before);
  });

  it("la gomma che passa su tutti i figli di un gruppo toglie il gruppo, senza lasciarne il guscio", () => {
    mount(doc('<g id="coppia"><rect id="su" x="60" y="60" width="20" height="20"/><rect id="giu" x="60" y="90" width="20" height="20"/></g>'));
    banco.editor.setTool("eraser");
    drag([[70, 50], [70, 120]]);
    expect(banco.editor.engine.text).not.toContain('id="coppia"');
    expect(banco.editor.engine.text).not.toContain('id="su"');
    expect(banco.editor.engine.text).not.toContain('id="giu"');
  });

  it("la gomma su un collegamento dentro un gruppo lo toglie intero, e il gruppo resta", () => {
    mount(doc(
      '<g id="altro"><a href="parco.md" id="link"><rect id="c" x="60" y="60" width="20" height="20"/></a>'
        + '<rect id="d" x="10" y="10" width="20" height="10"/></g>',
    ));
    banco.editor.setTool("eraser");
    drag([[50, 70], [56, 70], [64, 70]]);
    // Niente `<a>` vuoto: se ne va col suo unico figlio.
    expect(banco.editor.engine.text).not.toContain('id="link"');
    expect(banco.editor.engine.text).not.toContain("<a ");
    expect(banco.editor.engine.text).toContain('id="altro"');
    expect(banco.editor.engine.text).toContain('id="d"');
  });

  it("la gomma toglie intero un testo di un altro programma che attraversa, e lascia i vicini (IMP-038)", () => {
    // Come la «Mappa del quartiere» adottata: un livello di Inkscape con un
    // collegamento `mailto:` e un testo senza righe, che il formato dei
    // disegni non sa riscrivere e lascia estranei.
    const source = doc(
      '<g id="strade"><a href="mailto:comune@example.org"><text x="60" y="200">Scrivi al comune</text></a>'
        + '<text x="60" y="300">Resto</text>'
        + '<rect id="b" x="60" y="60" width="20" height="20"/></g>',
    );
    mount(source);
    const before = banco.editor.engine.text;
    banco.editor.setTool("eraser");
    drag([[50, 194], [80, 194], [120, 194]]);
    const after = banco.editor.engine.text;
    expect(after).not.toContain("Scrivi al comune");
    expect(after).not.toContain("mailto:");
    for (const kept of ['id="strade"', ">Resto</text>", 'id="b"']) expect(after).toContain(kept);
    expect(spoken()).toBe("1 oggetto cancellato. Il disegno ha 1 oggetto.");
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(before);
  });

  it("la gomma precisa toglie intero un testo di un altro programma in un livello", () => {
    mount(doc(`<title>Prova</title>${LAYER}<text x="60" y="200">Via Roma</text><rect id="b" x="60" y="60" width="20" height="20"/></g>`), {
      grid: { ...DEFAULT_GRID, eraser: "precise" },
    });
    banco.editor.setTool("eraser");
    drag([[50, 194], [80, 194], [120, 194]]);
    expect(banco.editor.engine.text).not.toContain("Via Roma");
    expect(banco.editor.engine.text).toContain('id="b"');
  });

  it("la gomma ferma mentre la rotella sposta la vista non cancella ciò che non ha toccato", () => {
    mount();
    banco.editor.setTool("eraser");
    const target = surface();
    target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: 20, clientY: 70, timeStamp: (banco.clock += 8) }));
    target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: 40, clientY: 70, timeStamp: (banco.clock += 8) }));
    // Sotto la gomma ferma la scena scorre fin oltre il rettangolo.
    target.dispatchEvent(new WheelEvent("wheel", { deltaX: 40, deltaMode: 0, bubbles: true, cancelable: true, clientX: 40, clientY: 70 }));
    target.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: 40, clientY: 70, timeStamp: (banco.clock += 8) }));
    expect(banco.editor.engine.text).toContain("o1a2b3c4d");
  });

  it("la selezione prende l'oggetto sotto il puntatore e lo sposta con `transform`", () => {
    mount();
    banco.editor.setTool("select");
    drag([[60, 70], [70, 70], [80, 75]]);
    expect(banco.editor.selection).toEqual(["o1a2b3c4d"]);
    expect(banco.editor.engine.text).toContain('transform="matrix(1 0 0 1 20 5)"');
    expect(spoken()).toBe("1 oggetto spostato.");
  });

  it("un gruppo di disegni estranei si prende dove si vede, e la sua immagine lo segue mentre lo si trascina", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:scena");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(() => Promise.resolve());
    mount(doc(`<title>Prova</title>${LAYER}<g id="w"><rect class="logo" x="60" y="60" width="20" height="20"/></g></g>`));
    await Promise.resolve();
    banco.editor.setTool("select");
    const image = (): HTMLElement => banco.host.querySelector<HTMLElement>(".spatial-image")!;
    expect(image().style.transform).toBe("translate(-100px, -75px)");
    const target = surface();
    target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: 70, clientY: 70, timeStamp: (banco.clock += 8) }));
    target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: 90, clientY: 75, timeStamp: (banco.clock += 8) }));
    expect(image().style.transform).toBe("matrix(1, 0, 0, 1, -80, -70)");
    target.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: 90, clientY: 75, timeStamp: (banco.clock += 8) }));
    expect(banco.editor.selection).toEqual(["w"]);
    expect(banco.editor.engine.text).toContain('<g id="w" transform="matrix(1 0 0 1 20 5)">');
    expect(spoken()).toBe("1 oggetto spostato.");
    for (let i = 0; i < 3; i++) await Promise.resolve();
    // L'immagine nuova ha già il gruppo spostato.
    expect(image().style.transform).toBe("translate(-100px, -75px)");
  });

  it("un tocco sul vuoto toglie la selezione, un riquadro sceglie ciò che contiene", () => {
    mount();
    banco.editor.setTool("select");
    banco.editor.select(["o1a2b3c4d"]);
    drag([[10, 10], [10, 10]]);
    expect(banco.editor.selection).toEqual([]);
    drag([[50, 50], [70, 70], [90, 90]]);
    expect(banco.editor.selection).toEqual(["o1a2b3c4d"]);
    expect(banco.changes).toEqual([]);
  });

  it("le frecce spostano la selezione di 1, con Maiusc di 10, e i colpi di fila si annullano insieme", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    mount();
    banco.editor.select(["o1a2b3c4d"]);
    key("ArrowRight");
    key("ArrowDown", { shiftKey: true });
    expect(banco.editor.engine.text).toContain('transform="matrix(1 0 0 1 1 10)"');
    now.mockReturnValue(MERGE_MS + 1);
    key("ArrowRight");
    expect(banco.editor.engine.text).toContain('transform="matrix(1 0 0 1 2 10)"');

    banco.editor.undo();
    expect(banco.editor.engine.text).toContain('transform="matrix(1 0 0 1 1 10)"');
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(SOURCE);
    expect(spoken()).toBe("Annullato: Spostamento.");
  });

  it("Canc elimina la selezione", () => {
    mount();
    banco.editor.select(["o1a2b3c4d"]);
    key("Delete");
    expect(banco.editor.engine.text).not.toContain("o1a2b3c4d");
    expect(banco.editor.selection).toEqual([]);
    expect(spoken()).toBe("1 oggetto eliminato. Il disegno ha 0 oggetti.");
  });

  it("le lettere scelgono lo strumento, senza Maiusc", () => {
    mount();
    key("r");
    expect(banco.editor.tool).toBe("rect");
    key("E", { shiftKey: true });
    expect(banco.editor.tool).toBe("rect");
    key("v");
    expect(banco.editor.tool).toBe("select");
  });
});

describe("l'evidenziatore e il colore", () => {
  /// Se il selettore sceglie un colore qualunque, o soltanto i campioni.
  const free = (): boolean => {
    const open = picker().querySelector(".kit-color-input") !== null;
    well().click();
    return open;
  };
  const widths = (): string[] =>
    [...banco.host.querySelectorAll<HTMLElement>(".draw-width")].map((control) => `${control.querySelector<HTMLElement>(".draw-width-bar")!.style.getPropertyValue("--draw-width")}${control.getAttribute("aria-checked") === "true" ? "*" : ""}`);

  it("il Semplice e il Completo hanno lo stesso evidenziatore e lo stesso colore a piacere", () => {
    mount(SOURCE, { workspace: "simple" });
    expect(railNames()).toContain("Evidenziatore");
    expect(free()).toBe(true);
    key("q");
    expect(banco.editor.tool).toBe("pen");
    key("P", { shiftKey: true });
    expect(banco.editor.tool).toBe("highlighter");

    banco.editor.select(["o1a2b3c4d"]);
    banco.editor.setSpace("full");
    expect(banco.editor.workspace).toBe("full");
    expect(railNames()).toEqual(["Selezione", "Mano", "Zoom", "Inchiostro", "Evidenziatore", "Gomma", "Rettangolo", "Ellisse", "Linea", "Freccia", "Testo"]);
    expect(free()).toBe(true);
    expect(railTool("Evidenziatore").title).toBe("Evidenziatore (Shift+P)");
    // Lo strumento, il documento, la selezione e la cronologia restano.
    expect(banco.editor.tool).toBe("highlighter");
    const highlighter = banco.host.querySelector<HTMLButtonElement>('.draw-rail [data-tool="highlighter"]')!;
    highlighter.focus();
    expect(document.getElementById(highlighter.getAttribute("aria-describedby")!)?.textContent).toContain("spessore costante");
    expect(banco.changes).toEqual([]);
    expect(banco.editor.selection).toEqual(["o1a2b3c4d"]);
    expect(formatIssues(checkAccessibility(banco.host))).toBe("");
  });

  it("l'evidenziatore scrive un tratto giallo, largo e trasparente, che si annulla col suo nome", () => {
    mount(SOURCE);
    banco.editor.setTool("highlighter");
    expect(banco.editor.color).toBe("#f0e442");
    expect(banco.editor.width).toBe(16);
    drag([[10, 10], [14, 12], [20, 15], [28, 16], [36, 16]], { pressure: 0.9 });
    expect(banco.editor.engine.text).toMatch(
      /<path id="o[a-z0-9]{8}" fub:tool="highlighter" fub:at="[^"]+Z" fub:brush="pf1 size=16 thinning=0 [^"]*capStart=0 capEnd=0 sim=0 pen=highlighter" d="M[^"]+" fill="#f0e442" fill-opacity="0.5" style="mix-blend-mode: multiply" fub:ink="1 [^"]+"\/>/,
    );
    expect(spoken()).toBe("Evidenziatura aggiunta. Il disegno ha 2 oggetti.");
    // Ha un nome suo anche nel giro degli oggetti e nel loro albero.
    key("End");
    expect(spoken()).toBe("Evidenziatura, Giallo, 2 di 2.");
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(SOURCE);
    expect(spoken()).toBe("Annullato: Evidenziatura.");
  });

  it("l'evidenziatore ha colore e spessori suoi, e la penna ritrova i propri", () => {
    mount(SOURCE);
    expect(widths()).toEqual(["2px", "4px*", "8px"]);
    banco.editor.setColor("#d55e00");
    banco.editor.setTool("highlighter");
    expect(widths()).toEqual(["8px", "16px*", "24px"]);
    banco.host.querySelectorAll<HTMLButtonElement>(".draw-width")[2]!.click();
    expect(banco.editor.width).toBe(24);
    // La misura è libera, da 0,25 a 200, e resta dell'evidenziatore.
    banco.editor.setWidth(30);
    expect(banco.editor.width).toBe(30);
    banco.editor.setWidth(201);
    expect(banco.editor.width).toBe(30);
    banco.editor.setColor("#56b4e9");
    banco.editor.setTool("pen");
    expect([banco.editor.color, banco.editor.width]).toEqual(["#d55e00", 4]);
    banco.editor.setTool("highlighter");
    expect([banco.editor.color, banco.editor.width]).toEqual(["#56b4e9", 30]);
  });

  it("il selettore scrive un codice, e il colore resta fra i recenti", () => {
    mount(SOURCE);
    expect(pickerGroups()).toEqual([["Consigliati", "Nero", "Blu", "Vermiglio", "Verde", "Porpora", "Arancione", "Azzurro", "Giallo"]]);
    expect(picker().querySelector('.kit-color-swatch[aria-pressed="true"]')?.getAttribute("aria-label")).toBe("Nero");
    typeColor("3A7BD5");
    expect(banco.editor.color).toBe("#3a7bd5");
    expect(spoken()).toBe("Colore: #3a7bd5.");
    expect(well().getAttribute("aria-label")).toBe("Colore: #3a7bd5");
    well().click();

    // Un altro colore della tavolozza, e il codice resta fra i recenti per
    // tornarci.
    pickSwatch("Nero");
    expect(banco.editor.color).toBe("#000000");
    well().click();
    expect(pickerGroups()[1]).toEqual(["Recenti", "#3a7bd5"]);
    pickSwatch("#3a7bd5");
    expect(banco.editor.color).toBe("#3a7bd5");
    well().click();
    banco.editor.setTool("rect");
    drag([[10, 10], [50, 40]]);
    expect(banco.editor.engine.text).toContain('stroke="#3a7bd5"');
    expect(formatIssues(checkAccessibility(banco.host))).toBe("");
  });

  it("un codice della tavolozza sceglie il suo campione, e uno sbagliato non sceglie niente", () => {
    mount(SOURCE);
    typeColor("#0072B2");
    expect(banco.editor.color).toBe("#0072b2");
    expect(spoken()).toBe("Colore: Blu.");
    expect(well().getAttribute("aria-label")).toBe("Colore: Blu");
    typeColor("rosso");
    expect(banco.editor.color).toBe("#0072b2");
    expect(picker().querySelector(".kit-color-input")!.getAttribute("aria-invalid")).toBe("true");
    well().click();
  });
});
