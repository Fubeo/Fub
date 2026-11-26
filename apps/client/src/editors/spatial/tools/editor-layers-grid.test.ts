// @vitest-environment happy-dom
// L'editor del disegno: i livelli, la griglia e la pagina nel Completo.
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime } from "../../../ui/lifetime";
import { SceneEngine } from "../scene/engine";
import { doc } from "../scene/test-support";
import { createDrawEditor } from "./editor";
import { LAYER } from "./test-support";
import { DEFAULT_CURVE } from "../../../ink/input/pressure";
import { cellaLivello } from "../livello-corrente";
import { SOURCE, banco, dialog, drag, field, key, mount, size, spoken, submit, surface } from "./editor-test-support";

// happy-dom non disegna: il PNG degli appunti è il testo che riceve.
vi.mock("./png", async (real) => ({
  ...(await real<typeof import("./png")>()),
  rasterize: vi.fn(async (svg: string) => new Blob([svg], { type: "image/png" })),
}));

describe("i livelli, nel Completo", () => {
  /// Due livelli con un rettangolo ciascuno: «Sfondo» sotto, «Note» sopra.
  const TWO = doc(
    `<title>Prova</title><g id="l1" fub:layer="Sfondo"><rect id="oa1a1a1a1" x="10" y="10" width="20" height="10" fill="#0072b2"/></g>` +
      `<g id="l2" fub:layer="Note"><rect id="ob2b2b2b2" x="40" y="40" width="10" height="10" fill="#000000"/></g>`,
  );
  const A = "oa1a1a1a1";
  const B = "ob2b2b2b2";

  const layers = (): HTMLButtonElement => banco.host.querySelector<HTMLButtonElement>(".draw-layer-button")!;
  const shownName = (): string => `${layers().querySelector(".draw-layer-name")!.textContent}${layers().querySelector<HTMLElement>(".draw-layer-state")!.hidden ? "" : ` (${layers().querySelector(".draw-layer-state")!.textContent})`}`;
  const menu = (): HTMLButtonElement[] => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>("button")];
  };
  const labelOf = (entry: HTMLElement): string => entry.querySelector(".menu-label")!.textContent ?? "";
  /// Apre il menu dei livelli e ne preme la voce `label`.
  const choose = (label: string): void => {
    layers().click();
    menu().find((entry) => labelOf(entry) === label)!.click();
  };
  /// Gli id dei livelli e dei rettangoli, nell'ordine del file.
  const order = (): string[] => [...banco.editor.engine.text.matchAll(/<(?:g|rect) id="([a-z0-9]+)"/g)].map((match) => match[1]!);

  afterEach(() => {
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  });

  it("il pulsante c'è nel Completo e dice dove si disegna; il menu sceglie il livello corrente", () => {
    mount(TWO, { workspace: "simple" });
    expect(layers().closest("[hidden]")).not.toBeNull();
    banco.editor.setSpace("full");
    expect(layers().closest("[hidden]")).toBeNull();
    expect(layers().closest('[role="group"]')!.getAttribute("aria-label")).toBe("Livelli");
    expect(shownName()).toBe("Note");
    expect(layers().getAttribute("aria-label")).toBe("Livelli: si disegna in «Note»");
    expect(layers().getAttribute("aria-haspopup")).toBe("menu");
    expect(formatIssues(checkAccessibility(banco.host))).toBe("");

    layers().click();
    expect(layers().getAttribute("aria-expanded")).toBe("true");
    const open = document.querySelector<HTMLElement>(".context-menu")!;
    expect(open.getAttribute("aria-labelledby")).toBe(layers().id);
    expect(menu().map((entry) => [entry.getAttribute("role"), labelOf(entry), entry.getAttribute("aria-checked"), entry.getAttribute("aria-disabled")])).toEqual([
      ["menuitemradio", "Note", "true", null],
      ["menuitemradio", "Sfondo", "false", null],
      ["menuitem", "Nuovo livello", null, null],
      ["menuitem", "Rinomina «Note»…", null, null],
      ["menuitem", "Nascondi «Note»", null, null],
      ["menuitem", "Blocca «Note»", null, null],
      ["menuitem", "Sposta «Note» su", null, "true"],
      ["menuitem", "Sposta «Note» giù", null, null],
      ["menuitem", "Individua oggetto", null, "true"],
      ["menuitem", "Elimina «Note»", null, null],
    ]);
    menu().find((entry) => labelOf(entry) === "Sfondo")!.click();
    expect(spoken()).toBe("Si disegna in «Sfondo».");
    expect(shownName()).toBe("Sfondo");
    expect(banco.changes).toEqual([]);

    // Il rettangolo va nel livello corrente, anche se sotto.
    banco.editor.setTool("rect");
    drag([[60, 60], [90, 80]]);
    expect(banco.editor.engine.text).toMatch(new RegExp(`<g id="l1" fub:layer="Sfondo">\\s*<rect id="${A}"[^>]*/>\\s*<rect id="o[a-z0-9]{8}"[^>]*/>\\s*</g>`));
    expect(banco.editor.selection).toEqual([]);
    // Nel Semplice si disegna nel più alto, come sempre.
    banco.editor.setSpace("simple");
    drag([[60, 60], [90, 80]]);
    expect(banco.editor.engine.text).toMatch(new RegExp(`<rect id="${B}"[^>]*/>\\s*<rect id="o[a-z0-9]{8}"[^>]*/>\\s*</g>\\s*</svg>`));
  });

  it("un clic sulla riga di un livello lo rende corrente; Individua oggetto apre l'albero sulla riga scelta", () => {
    mount(TWO, { workspace: "full" });
    expect(shownName()).toBe("Note");
    banco.editor.select([A]);
    choose("Individua oggetto");
    const tree = banco.host.querySelector<HTMLElement>(".draw-objects")!;
    expect(tree.closest("[hidden]")).toBeNull();
    expect(tree.querySelector<HTMLElement>(`[data-key="${A}"]`)).not.toBeNull();
    expect(tree.querySelector('[role="tree"]')!.getAttribute("aria-activedescendant")).toBe(tree.querySelector<HTMLElement>(`[data-key="${A}"]`)!.id);
    expect(banco.changes).toEqual([]);
    tree.querySelector<HTMLElement>('[data-key="l1"] .draw-object-label')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(shownName()).toBe("Sfondo");
    expect(spoken()).toBe("Si disegna in «Sfondo».");
    expect(banco.changes).toEqual([]);
  });

  it("il livello corrente è del disegno: due editor lo condividono, e resta dopo il rimontaggio e la rilettura", () => {
    // La cella del disegno, come la dà la sessione del documento (`livello-corrente.ts`).
    const cella = cellaLivello();
    mount(TWO, { livello: cella });
    expect(shownName()).toBe("Note");
    choose("Sfondo");
    expect(shownName()).toBe("Sfondo");
    // Un secondo riquadro sullo stesso disegno, aperto dopo, disegna già in «Sfondo»…
    const otherHost = document.createElement("div");
    document.body.append(otherHost);
    const otherLife = openLifetime();
    const other = createDrawEditor(otherHost, SceneEngine.open(TWO), otherLife, { livello: cella });
    const otherName = (): string => otherHost.querySelector(".draw-layer-name")!.textContent ?? "";
    expect(otherName()).toBe("Sfondo");
    // …e segue la scelta fatta nell'altro.
    choose("Note");
    expect(otherName()).toBe("Note");
    choose("Sfondo");
    expect(otherName()).toBe("Sfondo");
    // Rimontato (il motore riaperto, la superficie rifatta): la scelta resta.
    otherLife.close();
    otherHost.remove();
    const again = document.createElement("div");
    document.body.append(again);
    const againLife = openLifetime();
    createDrawEditor(again, SceneEngine.open(TWO), againLife, { livello: cella });
    expect(again.querySelector(".draw-layer-name")!.textContent).toBe("Sfondo");
    againLife.close();
    again.remove();
    expect(other).toBeDefined();
    // Il file riletto da disco: la scelta resta.
    banco.editor.load(SceneEngine.open(TWO));
    expect(shownName()).toBe("Sfondo");
    // Cancellato da un altro pannello (il testo arriva senza «Sfondo»): si
    // disegna nel livello in cima; con Annulla torna.
    const senza = TWO.replace(/<g id="l1"[^]*?<\/g>/, "");
    banco.editor.setEngine(SceneEngine.open(senza));
    expect(shownName()).toBe("Note");
    banco.editor.setEngine(SceneEngine.open(TWO));
    expect(shownName()).toBe("Sfondo");
  });

  it("senza cella del disegno l'editor ne ha una sua: un livello sparito lascia il più alto", () => {
    mount(TWO);
    choose("Sfondo");
    expect(shownName()).toBe("Sfondo");
    banco.editor.setEngine(SceneEngine.open(TWO.replace(/<g id="l1"[^]*?<\/g>/, "")));
    expect(shownName()).toBe("Note");
  });

  it("scegliere oggetti di un livello solo lo rende corrente, e l'albero lo dice", () => {
    mount(TWO);
    banco.host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Oggetti"]')!.click();
    const labels = (): string[] => [...banco.host.querySelectorAll(".draw-object-label")].map((label) => label.textContent ?? "");
    // Dal davanti: il livello sopra è in cima.
    expect(labels()).toEqual(["Note", "Rettangolo, Nero", "Sfondo", "Rettangolo, Blu"]);
    banco.editor.select([A]);
    expect(shownName()).toBe("Sfondo");
    expect(labels()).toEqual(["Note", "Rettangolo, Nero", "Sfondo", "Rettangolo, Blu"]);
    // Oggetti di due livelli non cambiano il livello corrente.
    banco.editor.select([A, B]);
    expect(shownName()).toBe("Sfondo");
    banco.editor.select([B]);
    expect(shownName()).toBe("Note");
    banco.editor.setSpace("simple");
    expect(labels()).toEqual(["Note", "Rettangolo, Nero", "Sfondo", "Rettangolo, Blu"]);
  });

  it("un livello nuovo sopra quello corrente, rinominato, nascosto e mostrato: un passo di annulla ciascuno", async () => {
    mount(TWO);
    choose("Sfondo");
    choose("Nuovo livello");
    const [, , made] = order();
    expect(made).toMatch(/^l[a-z0-9]+$/);
    expect(order()).toEqual(["l1", A, made, "l2", B]);
    expect(banco.editor.engine.text).toMatch(new RegExp(`<g id="${made}" fub:layer="Livello 3">\\s*</g>`));
    expect(spoken()).toBe("Livello «Livello 3» creato: si disegna lì.");
    expect(shownName()).toBe("Livello 3");

    choose("Rinomina «Livello 3»…");
    expect(dialog().querySelector("h2")!.textContent).toBe("Rinomina il livello");
    const name = field("name") as HTMLInputElement;
    expect([name.value, name.required, name.maxLength]).toEqual(["Livello 3", true, 80]);
    name.value = "  Schizzi  ";
    await submit();
    expect(banco.editor.engine.text).toMatch(new RegExp(`<g id="${made}" fub:layer="Schizzi">\\s*</g>`));
    expect(spoken()).toBe("Il livello ora si chiama «Schizzi».");

    choose("Nascondi «Schizzi»");
    expect(banco.editor.engine.text).toMatch(new RegExp(`<g id="${made}" fub:layer="Schizzi" display="none">\\s*</g>`));
    expect(spoken()).toBe("«Schizzi» nascosto.");
    expect(shownName()).toBe("Schizzi (nascosto)");
    expect(layers().getAttribute("aria-label")).toBe("Livelli: si disegna in «Schizzi», nascosto");
    // In un livello nascosto non si disegna, e lo si dice.
    const before = banco.editor.engine.text;
    banco.editor.setTool("rect");
    drag([[60, 60], [90, 80]]);
    expect(banco.editor.engine.text).toBe(before);
    expect(spoken()).toBe("«Schizzi» è nascosto: mostralo, o scegli un altro livello, per disegnare.");

    choose("Mostra «Schizzi»");
    expect(spoken()).toBe("«Schizzi» di nuovo visibile.");
    banco.editor.undo();
    expect(spoken()).toBe("Annullato: Livello mostrato.");
    banco.editor.undo();
    banco.editor.undo();
    expect(spoken()).toBe("Annullato: Nome del livello.");
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(TWO);
    expect(spoken()).toBe("Annullato: Nuovo livello.");
    // Il livello che se n'è andato lascia corrente quello in cima (DECISIONS,
    // livello corrente opzione (a)); con Ripeti torna corrente.
    expect(shownName()).toBe("Note");
    banco.editor.redo();
    expect(shownName()).toBe("Livello 3");
  });

  it("un livello bloccato non riceve né si elimina; i suoi oggetti escono dalla selezione", () => {
    mount(TWO);
    banco.editor.select([B]);
    choose("Blocca «Note»");
    expect(banco.editor.engine.text).toContain('<g id="l2" fub:layer="Note" fub:locked="true">');
    expect(spoken()).toBe("«Note» bloccato.");
    expect(banco.editor.selection).toEqual([]);
    expect(shownName()).toBe("Note (bloccato)");
    banco.editor.setTool("pen");
    const before = banco.editor.engine.text;
    drag([[60, 60], [70, 70], [80, 75]]);
    expect(banco.editor.engine.text).toBe(before);
    expect(spoken()).toBe("«Note» è bloccato: sbloccalo, o scegli un altro livello, per disegnare.");

    layers().click();
    const remove = menu().find((entry) => labelOf(entry) === "Elimina «Note»")!;
    expect(remove.getAttribute("aria-disabled")).toBe("true");
    expect(remove.querySelector(".menu-description")!.textContent).toBe("È bloccato: sbloccalo per eliminarlo.");
    expect(menu().find((entry) => labelOf(entry) === "Note")!.querySelector(".menu-description")!.textContent).toBe("bloccato");
    // Sceglierne uno bloccato dice subito che lì non si disegna.
    menu().find((entry) => labelOf(entry) === "Sfondo")!.click();
    choose("Note");
    expect(spoken()).toBe("Si disegna in «Note». «Note» è bloccato: sbloccalo, o scegli un altro livello, per disegnare.");
    choose("Sblocca «Note»");
    expect(banco.editor.engine.text).toBe(TWO);
    expect(spoken()).toBe("«Note» sbloccato.");
  });

  it("cambia l'ordine dei livelli ed elimina quello corrente con ciò che contiene; annulla lo riporta", () => {
    mount(TWO);
    choose("Sfondo");
    layers().click();
    expect(menu().find((entry) => labelOf(entry) === "Sposta «Sfondo» giù")!.getAttribute("aria-disabled")).toBe("true");
    menu().find((entry) => labelOf(entry) === "Sposta «Sfondo» su")!.click();
    expect(order()).toEqual(["l2", B, "l1", A]);
    expect(spoken()).toBe("«Sfondo» ora sta sopra «Note».");
    choose("Sposta «Sfondo» giù");
    expect(order()).toEqual(["l1", A, "l2", B]);
    expect(spoken()).toBe("«Sfondo» ora sta sotto «Note».");
    const shifted = banco.editor.engine.text;

    choose("Elimina «Sfondo»");
    expect(order()).toEqual(["l2", B]);
    expect(spoken()).toBe("«Sfondo» eliminato, con 1 oggetto. Si disegna in «Note».");
    expect(shownName()).toBe("Note");
    layers().click();
    const remove = menu().find((entry) => labelOf(entry) === "Elimina «Note»")!;
    expect(remove.getAttribute("aria-disabled")).toBe("true");
    expect(remove.querySelector(".menu-description")!.textContent).toBe("È l’unico livello.");
    document.querySelector(".context-menu")!.remove();

    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(shifted);
    expect(spoken()).toBe("Annullato: Eliminazione del livello.");
    // Ciò che torna è scelto, e il suo livello è di nuovo quello corrente.
    expect(banco.editor.selection).toEqual([A]);
    expect(shownName()).toBe("Sfondo");
  });

  it("«Sposta in un livello» porta la selezione in cima a un altro livello, dove si vedeva", () => {
    const scaled = TWO.replace('<g id="l2" fub:layer="Note">', '<g id="l2" fub:layer="Note" transform="scale(2)">');
    mount(scaled);
    const into = (): HTMLButtonElement => banco.host.querySelector<HTMLButtonElement>('.draw-arrange button[aria-label="Sposta in un livello"]')!;
    banco.editor.select([A]);
    expect(into().hidden).toBe(false);
    expect(into().getAttribute("aria-haspopup")).toBe("menu");
    into().click();
    expect(menu().map((entry) => [labelOf(entry), entry.getAttribute("aria-disabled"), entry.querySelector(".menu-description")?.textContent ?? null])).toEqual([
      ["Note", null, null],
      ["Sfondo", "true", "Gli oggetti scelti sono già qui."],
    ]);
    menu()[0]!.click();
    expect(order()).toEqual(["l1", "l2", B, A]);
    expect(banco.editor.engine.text).toContain(`<rect id="${A}" x="10" y="10" width="20" height="10" fill="#0072b2" transform="matrix(0.5 0 0 0.5 0 0)"/>`);
    expect(spoken()).toBe("1 oggetto spostato in «Note».");
    expect(banco.editor.selection).toEqual([A]);
    expect(shownName()).toBe("Note");
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(scaled);
    expect(spoken()).toBe("Annullato: Spostamento in un livello.");
    expect(shownName()).toBe("Sfondo");
  });

  it("un livello senza id resta quello corrente quando ne riceve uno", () => {
    const source = doc(`<g fub:layer="Sotto"/><g fub:layer="Sopra"/>`);
    mount(source);
    choose("Sotto");
    banco.editor.setTool("rect");
    drag([[10, 10], [40, 30]]);
    expect(banco.editor.engine.text).toMatch(/<g id="l[a-z0-9]+" fub:layer="Sotto">\s*<rect id="o[a-z0-9]{8}"[^>]*\/>\s*<\/g>\s*<g fub:layer="Sopra"\/>/);
    expect(shownName()).toBe("Sotto");
    drag([[50, 10], [80, 30]]);
    expect(banco.editor.engine.text).toMatch(/fub:layer="Sotto">\s*<rect[^>]*\/>\s*<rect[^>]*\/>\s*<\/g>/);
    // Annullato l'id, il livello resta quello corrente.
    banco.editor.undo();
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(source);
    expect(shownName()).toBe("Sotto");
  });
});

describe("la griglia e la pagina, nel Completo", () => {
  /// La griglia con l'aggancio acceso, al passo di partenza.
  const SNAP = { shown: false, snap: true, step: 20, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE } as const;
  /// Un quadrato pieno senza contorno, fuori dalla griglia, in una pagina
  /// che lo lascia muovere: il riquadro è quello scritto.
  const OFF = doc(`<title>Prova</title>${LAYER}<rect id="oa1a1a1a1" x="13" y="7" width="40" height="40" fill="#000000"/></g>`).replace(
    'viewBox="0 0 100 100"',
    'viewBox="0 0 400 400"',
  );
  const A = "oa1a1a1a1";

  const pageButton = (): HTMLButtonElement => banco.host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Pagina e griglia"]')!;
  const lines = (): HTMLElement => banco.host.querySelector<HTMLElement>(".draw-grid")!;
  const menu = (): HTMLButtonElement[] => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>("button")];
  };
  const labelOf = (entry: HTMLElement): string => entry.querySelector(".menu-label")!.textContent ?? "";
  const entry = (label: string): HTMLButtonElement => menu().find((one) => labelOf(one) === label)!;
  /// Apre «Pagina e griglia» e ne preme la voce `label`.
  const choose = (label: string): void => {
    pageButton().click();
    entry(label).click();
  };
  /// Un tasto premuto con AltGr, che su Windows arriva come Ctrl e Alt.
  const altGraph = (name: string): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { key: name, ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
    Object.defineProperty(event, "getModifierState", { value: (state: string) => state === "AltGraph" });
    surface().dispatchEvent(event);
    return event;
  };

  afterEach(() => {
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  });

  it("«Pagina e griglia» c'è nei due spazi; la griglia, nel Completo, si vede sopra la carta, e chi monta l'editor lo sa", () => {
    const grids: unknown[] = [];
    mount(SOURCE, { workspace: "simple", onGridChange: (grid) => grids.push(grid) });
    size(200, 100);
    expect(pageButton().hidden).toBe(false);
    expect(lines().style.display).toBe("none");
    banco.editor.setSpace("full");
    expect(pageButton().hidden).toBe(false);
    expect(pageButton().getAttribute("aria-haspopup")).toBe("menu");
    expect(lines().getAttribute("aria-hidden")).toBe("true");
    expect(formatIssues(checkAccessibility(banco.host))).toBe("");

    pageButton().click();
    expect(pageButton().getAttribute("aria-expanded")).toBe("true");
    expect(menu().map((one) => [one.getAttribute("role"), labelOf(one), one.getAttribute("aria-checked"), one.getAttribute("aria-keyshortcuts")])).toEqual([
      ["menuitemcheckbox", "Mostra la griglia", "false", "#"],
      ["menuitemcheckbox", "Aggancia alla griglia", "false", "%"],
      ["menuitemradio", "Passo di 5", "false", null],
      ["menuitemradio", "Passo di 10", "false", null],
      ["menuitemradio", "Passo di 20", "true", null],
      ["menuitemradio", "Passo di 50", "false", null],
      ["menuitemradio", "Passo di 100", "false", null],
      ["menuitemcheckbox", "Forme dal tratto", "true", null],
      ["menuitemcheckbox", "Barra accanto alla selezione", "true", null],
      ["menuitem", "Ruota la vista a sinistra", null, "4"],
      ["menuitem", "Ruota la vista a destra", null, "6"],
      ["menuitem", "Raddrizza la vista", null, "5"],
      ["menuitem", "Penna e dita…", null, null],
      ["menuitem", "Adatta la pagina al disegno", null, null],
    ]);
    expect(entry("Aggancia alla griglia").querySelector(".menu-description")!.textContent).toBe("Tieni premuto Ctrl mentre trascini per posare libero.");
    entry("Mostra la griglia").click();
    expect(spoken()).toBe("Griglia visibile.");
    expect(lines().style.display).toBe("");
    const [minor, major] = [...lines().querySelectorAll("path")];
    expect(minor!.getAttribute("d")).toContain("M20.5 0V100");
    expect(major!.getAttribute("data-major")).toBe("");
    expect(major!.getAttribute("d")).toContain("M100.5 0V100");
    expect(major!.getAttribute("d")).not.toContain("M20.5 0V100");

    choose("Passo di 50");
    expect(spoken()).toBe("Passo della griglia: 50.");
    expect(minor!.getAttribute("d")).toContain("M50.5 0V100");
    pageButton().click();
    expect(entry("Passo di 50").getAttribute("aria-checked")).toBe("true");
    expect(entry("Mostra la griglia").getAttribute("aria-checked")).toBe("true");
    entry("Aggancia alla griglia").click();
    expect(spoken()).toBe("Aggancio alla griglia acceso.");
    expect(banco.editor.grid).toEqual({ shown: true, snap: true, step: 50, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    expect(grids).toEqual([
      { shown: true, snap: false, step: 20, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE },
      { shown: true, snap: false, step: 50, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE },
      { shown: true, snap: true, step: 50, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE },
    ]);

    // Nel Semplice non si vede e non aggancia, ma resta com'era.
    banco.editor.setSpace("simple");
    expect(lines().style.display).toBe("none");
    expect(banco.editor.grid.shown).toBe(true);
    banco.editor.setSpace("full");
    expect(lines().style.display).toBe("");
    // La griglia non entra nel file.
    expect(banco.changes).toEqual([]);
  });

  it("`setGrid` la cambia senza dirlo; un passo fuori dai limiti resta quello di prima, e uno insolito entra nel menu", () => {
    const grids: unknown[] = [];
    mount(SOURCE, { grid: { shown: true, snap: false, step: 0, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE }, onGridChange: (grid) => grids.push(grid) });
    expect(banco.editor.grid).toEqual({ shown: true, snap: false, step: 20, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    banco.editor.setGrid({ shown: true, snap: true, step: 25, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    banco.editor.setGrid({ shown: false, snap: true, step: 5000, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    expect(banco.editor.grid).toEqual({ shown: false, snap: true, step: 25, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    expect(spoken()).toBe("");
    expect(grids).toEqual([]);
    pageButton().click();
    expect(menu().filter((one) => one.getAttribute("role") === "menuitemradio").map(labelOf)).toEqual([
      "Passo di 5",
      "Passo di 10",
      "Passo di 20",
      "Passo di 25",
      "Passo di 50",
      "Passo di 100",
    ]);
    expect(entry("Passo di 25").getAttribute("aria-checked")).toBe("true");
  });

  it("«#» la mostra e «%» aggancia, anche con AltGr; con Ctrl e nel Semplice no", () => {
    mount(SOURCE);
    expect(key("#", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(spoken()).toBe("Griglia visibile.");
    expect(key("%", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(spoken()).toBe("Aggancio alla griglia acceso.");
    expect(altGraph("#").defaultPrevented).toBe(true);
    expect(spoken()).toBe("Griglia nascosta.");
    expect(banco.editor.grid).toEqual({ shown: false, snap: true, step: 20, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    expect(key("#", { ctrlKey: true }).defaultPrevented).toBe(false);
    banco.editor.setSpace("simple");
    expect(key("%", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(banco.editor.grid).toEqual({ shown: false, snap: true, step: 20, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    // Nel titolo si scrivono.
    banco.editor.setSpace("full");
    const title = banco.host.querySelector<HTMLInputElement>(".draw-title-input")!;
    expect(key("#", { shiftKey: true }, title).defaultPrevented).toBe(false);
    expect(banco.editor.grid.shown).toBe(false);
  });

  it("una forma va da un incrocio all'altro; tenendo Ctrl si posa libera", () => {
    mount(doc(`${LAYER}</g>`), { grid: SNAP });
    banco.editor.setTool("rect");
    drag([[13, 17], [30, 40], [59, 61]]);
    expect(banco.editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="20" y="20" width="40" height="40" fill="none"/);
    drag([[13, 17], [30, 40], [59, 61]], { ctrlKey: true });
    expect(banco.editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="13" y="17" width="46" height="44" fill="none"/);
    // Nel Semplice non si aggancia.
    banco.editor.setSpace("simple");
    drag([[113, 117], [159, 161]]);
    expect(banco.editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="113" y="117" width="46" height="44" fill="none"/);
  });

  it("trascinare porta sull'incrocio più vicino l'angolo della geometria vicino al punto preso, contorno escluso", () => {
    mount(SOURCE, { grid: SNAP });
    banco.editor.setTool("select");
    // Preso a sinistra, a metà altezza: l'angolo in alto a sinistra, (60, 60),
    // spostato di (13, 9) va a (73, 69), e si aggancia a (80, 60).
    drag([[60, 70], [66, 74], [73, 79]]);
    expect(banco.editor.engine.text).toContain('transform="matrix(1 0 0 1 20 0)"');
    expect(spoken()).toBe("1 oggetto spostato.");
    banco.editor.undo();
    drag([[60, 70], [66, 74], [73, 79]], { ctrlKey: true });
    expect(banco.editor.engine.text).toContain('transform="matrix(1 0 0 1 13 9)"');
  });

  it("le frecce spostano la selezione di riga in riga, cinque con Maiusc", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    mount(OFF, { grid: SNAP });
    banco.editor.select([A]);
    key("ArrowRight");
    expect(banco.editor.engine.text).toContain('transform="matrix(1 0 0 1 7 0)"');
    key("ArrowRight");
    expect(banco.editor.engine.text).toContain('transform="matrix(1 0 0 1 27 0)"');
    key("ArrowDown", { shiftKey: true });
    expect(banco.editor.engine.text).toContain('transform="matrix(1 0 0 1 27 93)"');
    key("ArrowLeft");
    expect(banco.editor.engine.text).toContain('transform="matrix(1 0 0 1 7 93)"');
    // I colpi di fila sono un passo solo.
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(OFF);
  });

  it("Ctrl e le frecce portano il lato destro o quello in basso alla riga dopo, ma non oltre la prima dopo quello opposto", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    mount(doc(`${LAYER}<rect id="${A}" x="0" y="0" width="50" height="10" fill="#000000"/></g>`), { grid: SNAP });
    banco.editor.select([A]);
    key("ArrowRight", { ctrlKey: true });
    expect(banco.editor.engine.text).toContain('transform="matrix(1.2 0 0 1 0 0)"');
    expect(spoken()).toBe("Misure: 60 × 10.");
    key("ArrowDown", { ctrlKey: true });
    expect(banco.editor.engine.text).toContain('transform="matrix(1.2 0 0 2 0 0)"');
    expect(spoken()).toBe("Misure: 60 × 20.");
    key("ArrowLeft", { ctrlKey: true, shiftKey: true });
    expect(banco.editor.engine.text).toContain('transform="matrix(0.4 0 0 2 0 0)"');
    expect(spoken()).toBe("Misure: 20 × 20.");
    const before = banco.editor.engine.text;
    key("ArrowLeft", { ctrlKey: true });
    expect(banco.editor.engine.text).toBe(before);
  });

  it("con un contorno, la geometria va sulla riga e la misura detta è quella che si vede", () => {
    mount(SOURCE, { grid: SNAP });
    banco.editor.select(["o1a2b3c4d"]);
    key("ArrowRight", { ctrlKey: true });
    // Da 60–80 a 60–100: il contorno di 2 si allarga con la forma.
    expect(banco.editor.engine.text).toContain('transform="matrix(2 0 0 1 -60 0)"');
    expect(spoken()).toBe("Misure: 44 × 22.");
  });

  it("il cursore va di incrocio in incrocio; con Ctrl resta libero", () => {
    mount(SOURCE, { grid: SNAP });
    size(200, 140);
    key("ArrowRight");
    expect(spoken()).toBe("x 120, y 80");
    key("ArrowDown", { shiftKey: true });
    expect(spoken()).toBe("x 120, y 180");
    key("ArrowLeft", { ctrlKey: true });
    expect(spoken()).toBe("x 119, y 180");
    key("ArrowUp");
    expect(spoken()).toBe("x 120, y 160");
    expect(banco.changes).toEqual([]);
  });

  it("Ctrl+D scosta le copie di un numero intero di passi", () => {
    mount(OFF, { grid: SNAP });
    banco.editor.select([A]);
    key("d", { ctrlKey: true });
    const [copy] = banco.editor.selection;
    expect(banco.editor.engine.text).toContain(`<rect id="${copy}" x="13" y="7" width="40" height="40" fill="#000000" transform="matrix(1 0 0 1 40 40)"/>`);
  });

  it("«Adatta la pagina» la porta attorno al disegno con un margine, in un passo che si annulla", () => {
    mount(SOURCE);
    choose("Adatta la pagina al disegno");
    // Il rettangolo col contorno va da 59 a 81: 20 di margine, a numeri interi.
    expect(banco.editor.engine.text).toContain('viewBox="39 39 62 62"');
    expect(spoken()).toBe("Pagina adattata: 62 × 62.");
    expect(banco.changes).toHaveLength(1);
    expect(banco.editor.engine.text).toContain('<rect id="o1a2b3c4d" x="60" y="60" width="20" height="20"');
    pageButton().click();
    const fit = entry("Adatta la pagina al disegno");
    expect(fit.getAttribute("aria-disabled")).toBe("true");
    expect(fit.querySelector(".menu-description")!.textContent).toBe("La pagina è già adattata al disegno.");
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
    banco.editor.undo();
    expect(spoken()).toBe("Annullato: Pagina adattata al disegno.");
    expect(banco.editor.engine.text).toBe(SOURCE);
  });

  it("comprende i livelli bloccati e nascosti", () => {
    mount(
      doc(
        `<g id="l1" fub:layer="Sfondo" fub:locked="true"><rect x="-50" y="-50" width="10" height="10" fill="#000000"/></g>` +
          `<g id="l2" fub:layer="Note" display="none"><rect x="200" y="10" width="10" height="10" fill="#000000"/></g>` +
          `<g id="l3" fub:layer="Disegno"><rect x="10" y="10" width="10" height="10" fill="#000000"/></g>`,
      ),
      {},
    );
    choose("Adatta la pagina al disegno");
    expect(banco.editor.engine.text).toContain('viewBox="-70 -70 300 110"');
    expect(spoken()).toBe("Pagina adattata: 300 × 110.");
  });

  it("un disegno vuoto non ha una pagina da adattare, e lo dice", () => {
    mount(doc(`${LAYER}</g>`));
    pageButton().click();
    const fit = entry("Adatta la pagina al disegno");
    expect(fit.getAttribute("aria-disabled")).toBe("true");
    expect(fit.querySelector(".menu-description")!.textContent).toBe("Il disegno è vuoto.");
    fit.click();
    expect(banco.changes).toEqual([]);
  });

  it("un disegno con le sole tavole porta la pagina attorno alle tavole", () => {
    mount(
      doc(
        '<rect id="fub-paper" fub:role="paper" fub:board="b1a2b3c4d" x="0" y="0" width="400" height="200" fill="#fafafa"/>' +
          '<rect id="c5e6f7g8h" fub:role="paper" fub:board="b9i0j1k2l" x="480" y="0" width="400" height="200" fill="#fafafa"/>' +
          '<view id="b1a2b3c4d" fub:role="board" viewBox="0 0 400 200"><title>Copertina</title></view>' +
          '<view id="b9i0j1k2l" fub:role="board" viewBox="480 0 400 200"><title>Evaporazione</title></view>' +
          `${LAYER}</g>`,
      ),
      {},
    );
    pageButton().click();
    const fit = entry("Adatta la pagina al disegno");
    expect(fit.hasAttribute("aria-disabled")).toBe(false);
    expect(fit.querySelector(".menu-description")).toBeNull();
    fit.click();
    expect(banco.editor.engine.text).toContain('viewBox="-20 -20 920 240"');
    expect(spoken()).toBe("Pagina adattata: 920 × 240.");
  });

  it("«?» elenca i tasti della griglia, e le frecce dicono dove vanno con l'aggancio", async () => {
    mount(SOURCE);
    const rows = (): (string | null)[][] => [...dialog().querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]);
    key("?", { shiftKey: true });
    expect([...dialog().querySelectorAll("caption")].map((caption) => caption.textContent)).toContain("Griglia");
    expect(rows()).toContainEqual(["# o Ctrl+'", "Mostra o nasconde la griglia"]);
    expect(rows()).toContainEqual(["%", "Accende o spegne l’aggancio alla griglia"]);
    expect(rows()).toContainEqual(["Ctrl", "Tenuto mentre si trascina: posa libero, fuori dalla griglia"]);
    expect(rows()).toContainEqual(["←↑→↓", "Sposta la selezione di 1, con Maiusc di 10"]);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    banco.editor.setGrid(SNAP);
    key("?", { shiftKey: true });
    expect(rows()).toContainEqual(["←↑→↓", "Sposta la selezione alla riga seguente della griglia, a cinque righe con Maiusc"]);
    expect(rows()).toContainEqual(["Ctrl+←↑→↓", "Ridimensiona la selezione fino alla riga seguente della griglia, a cinque righe con Maiusc"]);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});
