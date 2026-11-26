// @vitest-environment happy-dom
// L'editor del disegno: fusione e opacità, i connettori, lo spazio di lavoro, l'aggancio al pixel.
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GRID } from "./grid";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime } from "../../../ui/lifetime";
import { closeContextMenu } from "../../../ui/menu";
import { doc } from "../scene/test-support";
import { filterElem, writeEffects, type Shadow } from "./effects";
import { LAYER } from "./test-support";
import { DEFS, written } from "./tip-support";
import { MOUSE, SOURCE, banco, dialog, drag, key, mount, pointer, railNames, railTool, spoken, surface, typeIn } from "./editor-test-support";

// happy-dom non disegna: il PNG degli appunti è il testo che riceve.
vi.mock("./png", async (real) => ({
  ...(await real<typeof import("./png")>()),
  rasterize: vi.fn(async (svg: string) => new Blob([svg], { type: "image/png" })),
}));

describe("la fusione e l'opacità", () => {
  const A = "oa1a1a1a1";
  const B = "ob1b1b1b1";
  const G = "og1g1g1g1";
  const SHEET = doc(
    `${LAYER}<rect id="${A}" x="0" y="0" width="40" height="40" fill="#0072b2" opacity="0.5"/>`
      + `<rect id="${B}" x="50" y="0" width="40" height="40" fill="#d55e00"/>`
      + `<g id="${G}"><rect id="oc1c1c1c1" x="100" y="0" width="40" height="40" fill="#009e73"/></g></g>`,
  );

  const arrangeBar = (): HTMLElement => banco.host.querySelector<HTMLElement>('.draw-arrange[aria-label="Disponi"]')!;
  const opacity = (): HTMLInputElement => arrangeBar().querySelector<HTMLInputElement>(".draw-arrange-input")!;
  const opacityLabel = (): HTMLElement => arrangeBar().querySelector<HTMLElement>(".draw-arrange-field")!;
  /// L'opacità scritta nell'elemento `id`, o `null` se non la scrive.
  const opacityOf = (id: string): string | null => new RegExp(`<(?:rect|g) id="${id}"[^>]*? opacity="([^"]*)"`).exec(banco.editor.engine.text)?.[1] ?? null;
  const style = (id: string): string | null => new RegExp(`<(?:rect|g) id="${id}"[^>]*? style="([^"]*)"`).exec(banco.editor.engine.text)?.[1] ?? null;
  /// Un tasto dentro il campo dell'opacità.
  const press = (name: string, init: KeyboardEventInit = {}): KeyboardEvent => key(name, init, opacity());

  it("c'è nel Completo, nella barra «Disponi», col nome, il valore e i limiti; nel Semplice e senza selezione no", () => {
    mount(SHEET);
    expect(arrangeBar().hidden).toBe(true);
    banco.editor.select([A]);
    expect(arrangeBar().hidden).toBe(false);
    expect(opacityLabel().hidden).toBe(false);
    expect(opacity().value).toBe("50");
    expect(opacity().getAttribute("role")).toBe("spinbutton");
    expect(opacity().getAttribute("aria-label")).toBe("Opacità");
    expect(opacityLabel().title).toBe("Opacità");
    expect([opacity().getAttribute("aria-valuemin"), opacity().getAttribute("aria-valuemax"), opacity().getAttribute("aria-valuenow"), opacity().getAttribute("aria-valuetext")]).toEqual(["0", "100", "50", "50%"]);
    expect(arrangeBar().querySelector(".draw-arrange-suffix")!.getAttribute("aria-hidden")).toBe("true");
    expect(formatIssues(checkAccessibility(banco.host))).toBe("");
    // Un oggetto che non scrive l'opacità la ha piena.
    banco.editor.select([B]);
    expect(opacity().value).toBe("100");
    // Di oggetti diversi il campo è vuoto, e lo dice.
    banco.editor.select([A, B]);
    expect(opacity().value).toBe("");
    expect(opacity().placeholder).toBe("Misto");
    expect(opacity().getAttribute("aria-valuetext")).toBe("Misto");
    expect(opacity().hasAttribute("aria-valuenow")).toBe(false);
    banco.editor.select([]);
    expect(arrangeBar().hidden).toBe(true);
    banco.editor.setSpace("simple");
    banco.editor.select([A]);
    expect(opacityLabel().hidden).toBe(true);
    expect(banco.changes).toEqual([]);
  });

  it("un valore scritto e Invio cambiano l'opacità in un passo, «Opacità», che si annulla e si ripete", () => {
    mount(SHEET);
    banco.editor.select([A]);
    typeIn(opacity(), "30");
    expect(press("Enter").defaultPrevented).toBe(true);
    expect(opacityOf(A)).toBe("0.3");
    expect(banco.changes).toHaveLength(1);
    expect(opacity().value).toBe("30");
    expect(opacity().getAttribute("aria-valuenow")).toBe("30");
    banco.editor.undo();
    expect(spoken()).toBe("Annullato: Opacità.");
    expect(banco.editor.engine.text).toBe(SHEET);
    expect(opacity().value).toBe("50");
    banco.editor.redo();
    expect(opacityOf(A)).toBe("0.3");
    // Anche con il segno e un calcolo, come nel pannello.
    typeIn(opacity(), "20+5%");
    press("Enter");
    expect(opacityOf(A)).toBe("0.25");
  });

  it("lasciare il campo scrive il numero; lo stesso numero non scrive niente", () => {
    mount(SHEET);
    banco.editor.select([A]);
    typeIn(opacity(), "50");
    opacity().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(banco.changes).toEqual([]);
    typeIn(opacity(), "80");
    opacity().blur();
    opacity().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(opacityOf(A)).toBe("0.8");
    expect(banco.changes).toHaveLength(1);
  });

  it("le frecce, Pagina, Inizio e Fine la cambiano subito, fra 0 e 100, e i colpi di fila sono un passo", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    mount(SHEET);
    banco.editor.select([A]);
    opacity().focus();
    press("ArrowUp");
    press("ArrowUp");
    expect(opacityOf(A)).toBe("0.52");
    press("ArrowDown", { shiftKey: true });
    expect(opacityOf(A)).toBe("0.42");
    press("PageUp");
    expect(opacityOf(A)).toBe("0.52");
    press("PageDown");
    press("PageDown");
    expect(opacityOf(A)).toBe("0.32");
    expect(opacity().value).toBe("32");
    // Un passo solo: annulla riporta al principio.
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(SHEET);
    banco.editor.redo();
    press("End");
    expect(opacity().value).toBe("100");
    expect(opacityOf(A)).toBeNull();
    const count = banco.changes.length;
    press("ArrowUp");
    press("PageUp");
    press("End");
    expect(opacity().value).toBe("100");
    expect(banco.changes).toHaveLength(count);
    press("Home");
    expect(opacityOf(A)).toBe("0");
    const zero = banco.changes.length;
    press("ArrowDown");
    press("PageDown", { shiftKey: true });
    press("Home");
    expect(opacityOf(A)).toBe("0");
    expect(opacity().value).toBe("0");
    expect(banco.changes).toHaveLength(zero);
    // Il tasto è del campo: non arriva al foglio, e la selezione non si sposta.
    expect(banco.editor.engine.text).not.toContain("transform=");
  });

  it("un valore che non si legge lo dice e il campo torna com'era; Esc toglie il numero, e poi torna al foglio", () => {
    mount(SHEET);
    banco.editor.select([A]);
    opacity().focus();
    typeIn(opacity(), "abc");
    press("Enter");
    expect(spoken()).toBe("Scrivi un numero o un calcolo, come 120+15.");
    expect(opacity().value).toBe("50");
    typeIn(opacity(), "5 px");
    press("Enter");
    expect(spoken()).toMatch(/^Qui valgono queste unità:/);
    expect(opacity().value).toBe("50");
    typeIn(opacity(), "");
    press("Enter");
    expect(opacity().value).toBe("50");
    expect(banco.changes).toEqual([]);
    // Fuori da 0–100 il valore si ferma al limite.
    typeIn(opacity(), "250");
    press("Enter");
    expect(opacityOf(A)).toBeNull();
    // Esc, con un numero scritto, lo toglie e resta nel campo.
    typeIn(opacity(), "70");
    const first = press("Escape");
    expect(first.defaultPrevented).toBe(true);
    expect(opacity().value).toBe("100");
    expect(document.activeElement).toBe(opacity());
    // Poi torna al foglio, come ogni barra.
    press("Escape");
    expect(document.activeElement).toBe(surface());
  });

  it("con opacità diverse le frecce dicono che sono diverse, e un numero le porta tutte allo stesso valore", () => {
    mount(SHEET);
    banco.editor.select([A, B]);
    opacity().focus();
    press("ArrowUp");
    expect(spoken()).toBe("I valori sono diversi: scrivi quello da dare a tutti.");
    expect(banco.changes).toEqual([]);
    typeIn(opacity(), "60");
    press("Enter");
    expect(opacityOf(A)).toBe("0.6");
    expect(opacityOf(B)).toBe("0.6");
    expect(banco.changes).toHaveLength(1);
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(SHEET);
  });

  it("un gruppo prende l'opacità sul gruppo, e il campo segue la selezione senza perdere il fuoco", () => {
    mount(SHEET);
    banco.editor.select([G]);
    opacity().focus();
    press("PageDown");
    expect(opacityOf(G)).toBe("0.9");
    expect(document.activeElement).toBe(opacity());
    // Cambiare la selezione ridice il valore; un numero a metà della stessa selezione resta.
    typeIn(opacity(), "4");
    banco.editor.select([G]);
    expect(opacity().value).toBe("4");
    banco.editor.select([A]);
    expect(opacity().value).toBe("50");
  });

  it("si raggiunge con le frecce dai pulsanti vicini, ha il suo Tab, e dentro le frecce sono sue", () => {
    mount(SHEET);
    banco.editor.select([A]);
    const buttons = [...arrangeBar().querySelectorAll<HTMLButtonElement>("button")].filter((control) => !control.hidden);
    // I pulsanti hanno un Tab solo fra loro; il campo ha il suo.
    expect(buttons.filter((control) => control.tabIndex === 0)).toHaveLength(1);
    expect(opacity().tabIndex).toBe(0);
    const last = buttons[buttons.length - 1]!;
    last.focus();
    key("ArrowRight", {}, last);
    expect(document.activeElement).toBe(opacity());
    // Dentro, le frecce sinistra e destra e Inizio e Fine non vanno ai pulsanti.
    key("ArrowLeft", {}, opacity());
    expect(document.activeElement).toBe(opacity());
    // Dall'altra parte, la freccia a sinistra dal primo pulsante arriva al campo.
    buttons[0]!.focus();
    key("ArrowLeft", {}, buttons[0]!);
    expect(document.activeElement).toBe(opacity());
    key("End", {}, last);
  });

  it("in un disegno che non si modifica non c'è", () => {
    mount(SHEET.replace(' fub:version="1"', ""));
    banco.editor.select([A]);
    expect(arrangeBar().hidden).toBe(true);
    expect(banco.changes).toEqual([]);
  });

  // --- La fusione nel pannello ----------------------------------------------

  const panelButton = (): HTMLButtonElement => banco.host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Proprietà"]')!;

  it("«Fusione» non c'è più in nessuno spazio (ADR 0231)", () => {
    for (const workspace of ["simple", "full"] as const) {
      mount(SHEET, { workspace });
      banco.editor.select([A]);
      panelButton().click();
      expect(banco.host.querySelector('.draw-properties-field[data-field="blend"]')).toBeNull();
      expect(banco.host.querySelector('.draw-properties-field[data-field="isolate"]')).toBeNull();
      banco.owner.close();
      banco.owner = openLifetime();
      banco.host.replaceChildren();
    }
  });

  // --- Gli effetti: lo stile copiato, il contagocce, il riquadro -------------

  const SHADOW: Shadow = { kind: "shadow", dx: 0, dy: 4, blur: 8, color: "#000000", opacity: 0.25, hidden: false };
  /// Il filtro dell'ombra per un quadrato di 20 × 20 in (10, 10), e per uno di 40 × 40 in (230, 130).
  const filterFor = (id: string, x: number, y: number, side: number): string =>
    DEFS(written(filterElem(id, [SHADOW], { x: String(x - 14), y: String(y - 10), width: String(side + 28), height: String(side + 28) })));
  const FX = `filter="url(#rf1f1f1f1)" fub:effect="${writeEffects([SHADOW])}"`;
  /// A senza niente; B con un'ombra e una fusione, più in là.
  const LOOKS = doc(
    `${filterFor("rf1f1f1f1", 230, 130, 40)}${LAYER}<rect id="${A}" x="10" y="10" width="20" height="20" fill="#0072b2"/>`
      + `<rect id="${B}" x="230" y="130" width="40" height="40" fill="#e69f00" ${FX} style="mix-blend-mode: multiply"/></g>`,
  );

  it("lo stile copiato porta la fusione e gli effetti, nel Completo, e incollarli è un passo solo", () => {
    mount(LOOKS);
    banco.editor.select([B]);
    key("c", { ctrlKey: true, altKey: true });
    expect(spoken()).toBe("Stile copiato.");
    banco.editor.select([A]);
    key("v", { ctrlKey: true, altKey: true });
    expect(spoken()).toBe("Stile incollato su 1 oggetto.");
    expect(style(A)).toBe("mix-blend-mode: multiply");
    expect(new RegExp(`<rect id="${A}"[^>]* fub:effect="shadow 0 4 8 #000000 0\\.25"`).test(banco.editor.engine.text)).toBe(true);
    expect(banco.editor.engine.text.match(/<filter /g)).toHaveLength(2);
    expect(banco.changes).toHaveLength(1);
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(LOOKS);
    // E lo stile di un oggetto liscio toglie ombra e fusione a chi le ha.
    banco.editor.select([A]);
    key("c", { ctrlKey: true, altKey: true });
    banco.editor.select([B]);
    key("v", { ctrlKey: true, altKey: true });
    expect(style(B)).toBeNull();
    expect(banco.editor.engine.text).not.toContain("fub:effect");
    expect(banco.editor.engine.text).not.toContain("<filter");
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(LOOKS);
  });

  /// Un rettangolo con l'ombra, e un gruppo spostato di 100 con un altro dentro.
  const SHADOWED = doc(
    `${filterFor("rf1f1f1f1", 10, 10, 20)}${LAYER}<rect id="${A}" x="10" y="10" width="20" height="20" fill="#0072b2" ${FX}/>`
      + `<g id="${G}" transform="translate(100 0)"><rect id="oc1c1c1c1" x="10" y="10" width="20" height="20" fill="#009e73" ${FX}/></g></g>`,
  );

  it("l'export della selezione conta l'ombra: quella di un oggetto, e quella di ciò che un gruppo porta, spostata come lui", () => {
    mount(SHADOWED);
    banco.editor.select([A]);
    // L'ombra arriva 12 a sinistra e a destra, 8 sopra e 16 sotto.
    expect(banco.editor.exportScene().scene.selection!.box).toEqual([-2, 2, 44, 44]);
    banco.editor.select([G]);
    expect(banco.editor.exportScene().scene.selection!.box).toEqual([98, 2, 44, 44]);
    banco.editor.select([A, G]);
    expect(banco.editor.exportScene().scene.selection!.box).toEqual([-2, 2, 144, 44]);
    // Senza effetti, il riquadro è quello della forma.
    banco.editor.dispose();
    mount(doc(`${LAYER}<rect id="${A}" x="10" y="10" width="20" height="20" fill="#0072b2"/></g>`));
    banco.editor.select([A]);
    expect(banco.editor.exportScene().scene.selection!.box).toEqual([10, 10, 20, 20]);
  });

  it("«Adatta la pagina al disegno» comprende l'ombra, con il suo margine, in un passo che si annulla", () => {
    mount(SHADOWED);
    banco.host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Pagina e griglia"]')!.click();
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>("button")].find((one) => one.querySelector(".menu-label")!.textContent === "Adatta la pagina al disegno")!.click();
    // Da -2 a 142 e da 2 a 46, con 20 di margine.
    expect(banco.editor.engine.text).toContain('viewBox="-22 -18 184 84"');
    expect(spoken()).toBe("Pagina adattata: 184 × 84.");
    expect(banco.changes).toHaveLength(1);
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(SHADOWED);
    for (const menu of document.querySelectorAll(".context-menu")) menu.remove();
  });
});

describe("i connettori del file", () => {
  const A = "oa1a1a1a1";
  const B = "ob2b2b2b2";
  const K = "ok3k3k3k3";
  const rect = (id: string, name: string, x: number, y: number): string =>
    `<rect id="${id}" x="${x}" y="${y}" width="60" height="40" fill="#e69f00"><title>${name}</title></rect>`;
  /// Alfa e Beta, e un connettore scritto prima della decisione 0231 dal
  /// lato destro di Alfa al sinistro di Beta.
  const LINKED = doc(
    `<title>Prova</title>${LAYER}${rect(A, "Alfa", 40, 60)}${rect(B, "Beta", 240, 60)}` +
      `<path id="${K}" fub:shape="connector" fub:geom="straight 100 80 240 80" fub:from="${A} right" fub:to="${B} left" d="M100 80 L240 80" fill="none" stroke="#000000"/></g>`,
  ).replace('viewBox="0 0 100 100"', 'viewBox="0 0 400 300"');
  const tag = (id: string): string => new RegExp(`<[a-zA-Z]+ id="${id}"[^>]*>`).exec(banco.editor.engine.text)![0];
  const attr = (id: string, name: string): string | null => new RegExp(` ${name}="([^"]*)"`).exec(tag(id))?.[1] ?? null;
  const pointsOf = (id: string): Array<[number, number]> => {
    const all = attr(id, "fub:geom")!.split(" ").slice(1).map(Number);
    return Array.from({ length: all.length / 2 }, (_, i) => [all[2 * i]!, all[2 * i + 1]!]);
  };
  /// Il `d` che la geometria dritta di `id` detta.
  const dictated = (id: string): string => {
    const points = pointsOf(id).map(([x, y]) => `${x} ${y}`);
    return `M${points[0]} ${points.slice(1).map((each) => `L${each}`).join(" ")}`;
  };
  const painted = (id: string): SVGElement => banco.host.querySelector<SVGElement>(`[data-scene-id="${id}"]`)!;

  it("seguono l'oggetto spostato col mouse, e un annulla riporta tutto com'era", () => {
    mount(LINKED);
    banco.editor.setTool("select");
    const before = banco.editor.engine.text;
    const resting = attr(K, "d");
    const target = surface();
    const at = (type: string, x: number, y: number, held = 1): void =>
      void target.dispatchEvent(pointer(type, { ...MOUSE, button: type === "pointermove" ? -1 : 0, buttons: held, pressure: held === 1 ? 0.5 : 0, clientX: x, clientY: y, timeStamp: (banco.clock += 8) }));
    at("pointerdown", 60, 90);
    at("pointermove", 65, 110);
    at("pointermove", 60, 130);
    // Mentre si trascina, la linea segue l'oggetto sul foglio.
    expect(painted(K).getAttribute("d")).not.toBe(resting);
    expect(attr(K, "d")).toBe(resting);
    at("pointerup", 60, 130, 0);
    expect(attr(A, "transform")).toBe("matrix(1 0 0 1 0 40)");
    expect(attr(K, "fub:from")).toBe(`${A} right`);
    expect(pointsOf(K)[0]).toEqual([100, 120]);
    expect(attr(K, "d")).toBe(dictated(K));
    expect(painted(K).getAttribute("d")).toBe(attr(K, "d"));
    expect(banco.changes).toHaveLength(1);
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(before);
  });

  it("e quello spostato con le frecce, in un passo solo", () => {
    mount(LINKED);
    const before = banco.editor.engine.text;
    banco.editor.select([B]);
    key("ArrowDown", { shiftKey: true });
    expect(attr(B, "transform")).toBe("matrix(1 0 0 1 0 10)");
    const points = pointsOf(K);
    expect(points[points.length - 1]).toEqual([240, 90]);
    expect(attr(K, "d")).toBe(dictated(K));
    expect(banco.changes).toHaveLength(1);
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(before);
  });

  it("l'oggetto eliminato lascia il connettore con l'ultima geometria e il capo libero", () => {
    mount(LINKED);
    const before = banco.editor.engine.text;
    banco.editor.select([B]);
    key("Delete");
    expect(banco.editor.engine.text).not.toContain(`id="${B}"`);
    expect(attr(K, "fub:to")).toBeNull();
    expect(attr(K, "fub:from")).toBe(`${A} right`);
    expect(attr(K, "fub:geom")).toBe("straight 100 80 240 80");
    expect(attr(K, "d")).toBe("M100 80 L240 80");
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(before);
  });

  it("lo strumento, il tasto X e la sezione delle proprietà non ci sono più (ADR 0231)", () => {
    mount(LINKED);
    key("x");
    expect(banco.editor.tool).toBe("pen");
    expect(railTool("Connettore").hidden).toBe(true);
  });
});

describe("lo spazio di lavoro e la colonna personalizzata", () => {
  /// La voce `label` del menu aperto per ultimo.
  const menuEntry = (label: string): HTMLButtonElement => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>("button")].find((one) => one.querySelector(".menu-label")?.textContent === label)!;
  };
  const openMenu = (): void => banco.host.querySelector<HTMLButtonElement>('.draw-top button[aria-label="Disegno"]')!.click();
  const fullButton = (): HTMLButtonElement => banco.host.querySelector<HTMLButtonElement>(".draw-rail-full")!;
  const rail = (): HTMLElement => banco.host.querySelector<HTMLElement>(".draw-rail .kit-rail")!;
  const custom = (): HTMLElement => document.querySelector<HTMLElement>(".draw-toolbar-dialog")!;
  const action = (id: string): HTMLButtonElement => custom().querySelector<HTMLButtonElement>(`[data-action="${id}"]`)!;
  const rows = (): string[] => [...custom().querySelectorAll(".draw-toolbar-row")].map((row) => (row as HTMLElement).dataset.tool!);
  const row = (tool: string): HTMLElement => custom().querySelector<HTMLElement>(`.draw-toolbar-row[data-tool="${tool}"]`)!;
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  afterEach(() => closeContextMenu());

  it("il Semplice offre gli strumenti per disegnare a mano, con caselle grandi, e «Completo» è a un clic", () => {
    const onWorkspace = vi.fn();
    mount(SOURCE, { workspace: "simple", onWorkspace });
    expect(banco.host.querySelector<HTMLElement>(".draw-editor")!.dataset.workspace).toBe("simple");
    expect(rail().dataset.size).toBe("large");
    expect(railNames()).toEqual(["Selezione", "Mano", "Zoom", "Inchiostro", "Evidenziatore", "Gomma", "Rettangolo", "Ellisse", "Linea", "Freccia", "Testo"]);
    expect(fullButton().hidden).toBe(false);

    fullButton().click();
    expect(onWorkspace).toHaveBeenLastCalledWith("full");
    expect(banco.host.querySelector<HTMLElement>(".draw-editor")!.dataset.workspace).toBe("full");
    expect(rail().dataset.size).toBe("normal");
    expect(fullButton().hidden).toBe(true);
    expect(spoken()).toContain("Completo");
  });

  it("il menu del disegno sceglie lo spazio, e chi monta lo cambia dal vivo", async () => {
    const onWorkspace = vi.fn();
    mount(SOURCE, { workspace: "full", onWorkspace });
    expect(banco.host.querySelector<HTMLElement>(".draw-editor")!.dataset.workspace).toBe("full");
    openMenu();
    menuEntry("Spazio di lavoro").click();
    await settle();
    const simple = menuEntry("Semplice");
    expect(simple.getAttribute("role")).toBe("menuitemradio");
    expect(simple.getAttribute("aria-checked")).toBe("false");
    simple.click();
    expect(onWorkspace).toHaveBeenLastCalledWith("simple");

    // Dall'esterno (un'altra finestra ha cambiato l'impostazione): niente
    // richiamo, perché la scelta è già ricordata.
    onWorkspace.mockClear();
    banco.editor.setSpace("full", ["select", "rect", "pen"]);
    expect(railNames()).toEqual(["Selezione", "Rettangolo", "Inchiostro"]);
    expect(onWorkspace).not.toHaveBeenCalled();
  });

  it("nel Semplice «Mostra tutto» aggiunge i tasti di Completo e dice dove si sceglie; in Completo non manca niente", async () => {
    mount(SOURCE, { workspace: "simple" });
    key("?", { shiftKey: true });
    const extra = dialog().querySelector<HTMLElement>(".keys-more")!;
    dialog().querySelector<HTMLButtonElement>(".keys-show-all")!.click();
    expect(extra.querySelector(".keys-note")!.textContent).toBe(
      "I tasti qui sotto sono dello spazio «Completo», che si sceglie dal menu «Disegno» o col pulsante in fondo alla colonna.",
    );
    const captions = [...extra.querySelectorAll("caption")].map((caption) => caption.textContent);
    // Gli strumenti sono gli stessi nei due spazi (ADR 0231): manca ciò che
    // si fa con gli oggetti.
    expect(captions[0]).toBe("Oggetti");
    expect(captions.some((caption) => caption!.includes("livello")), "niente livelli").toBe(false);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
    await settle();

    banco.editor.setSpace("full");
    key("?", { shiftKey: true });
    expect(dialog().querySelector<HTMLElement>(".keys-show-all")?.hidden ?? true, "in Completo non c'è altro").toBe(true);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
    await settle();
  });

  it("una colonna personalizzata mette i suoi strumenti, nel suo ordine; gli altri restano nei tasti", () => {
    mount(SOURCE, { workspace: "full", toolbar: ["select", "ellipse", "pen", "domani" as never] });
    expect(railNames()).toEqual(["Selezione", "Ellisse", "Inchiostro"]);
    // Senza la Selezione, la colonna la mette in cima.
    banco.editor.setSpace("full", ["rect", "pen"]);
    expect(railNames()).toEqual(["Selezione", "Rettangolo", "Inchiostro"]);
    key("o");
    expect(banco.editor.tool).toBe("ellipse");
  });

  it("«Personalizza la barra…» sposta, toglie, rimette di serie e salva; Annulla rimette com'era", async () => {
    const onToolbar = vi.fn();
    mount(SOURCE, { workspace: "full", onToolbar });
    const standard = railNames();
    openMenu();
    menuEntry("Personalizza la barra…").click();
    expect(formatIssues(checkAccessibility(custom()))).toBe("");
    expect(rows()[0]).toBe("select");
    expect(row("select").querySelector<HTMLInputElement>("input")!.disabled, "la Selezione resta").toBe(true);

    // Giù la Selezione, via la Mano: la colonna cambia mentre si sceglie.
    row("select").querySelectorAll<HTMLButtonElement>(".draw-toolbar-move")[1]!.click();
    expect(rows().slice(0, 2)).toEqual(["hand", "select"]);
    expect(railNames().slice(0, 2)).toEqual(["Mano", "Selezione"]);
    const hand = row("hand").querySelector<HTMLInputElement>("input")!;
    hand.click();
    expect(railNames().slice(0, 2)).toEqual(["Selezione", "Zoom"]);
    expect(railNames()).not.toContain("Mano");

    // Annulla: com'era, e niente salvato.
    action("cancel").click();
    await settle();
    expect(railNames()).toEqual(standard);
    expect(onToolbar).not.toHaveBeenCalled();

    // Di nuovo, poi Salva.
    openMenu();
    menuEntry("Personalizza la barra…").click();
    row("hand").querySelector<HTMLInputElement>("input")!.click();
    action("save").click();
    await settle();
    expect(onToolbar).toHaveBeenCalledTimes(1);
    expect(onToolbar.mock.calls[0]![0]).not.toContain("hand");
    expect(railNames()).not.toContain("Mano");

    // «Ripristina» torna alla colonna di serie, che si salva vuota.
    openMenu();
    menuEntry("Personalizza la barra…").click();
    custom().querySelector<HTMLButtonElement>(".draw-toolbar-reset")!.click();
    expect(railNames()).toEqual(standard);
    action("save").click();
    await settle();
    expect(onToolbar).toHaveBeenLastCalledWith([]);
  });
});

describe("l'aggancio al pixel (K6 T11): nel Completo sì, nel Semplice il valore resta e non agisce", () => {
  it("nel Semplice il pixel acceso non arrotonda: un rettangolo da 10,4 resta 10,4, e il valore resta nella griglia", () => {
    mount(SOURCE, { workspace: "simple", grid: { ...DEFAULT_GRID, snapPixel: true } });
    banco.editor.setTool("rect");
    drag([[10.4, 3.2], [60.7, 40.4]]);
    expect(banco.editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="10.4" y="3.2"/);
    expect(banco.editor.grid.snapPixel).toBe(true);
  });

  it("nel Completo lo stesso valore porta il rettangolo su interi: da 10,4 va su 10", () => {
    mount(SOURCE, { workspace: "full", grid: { ...DEFAULT_GRID, snapPixel: true } });
    banco.editor.setTool("rect");
    drag([[10.4, 3.2], [60.7, 40.4]]);
    expect(banco.editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="10" y="3" width="51" height="37"/);
  });
});
