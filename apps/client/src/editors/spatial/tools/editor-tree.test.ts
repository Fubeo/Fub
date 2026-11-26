// @vitest-environment happy-dom
// L'editor del disegno: i nomi e il filtro dell'albero, spostare dall'albero.
import { describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { SceneEngine } from "../scene/engine";
import { doc } from "../scene/test-support";
import { LAYER } from "./test-support";
import { banco, drag, key, mount, spoken, surface } from "./editor-test-support";

// happy-dom non disegna: il PNG degli appunti è il testo che riceve.
vi.mock("./png", async (real) => ({
  ...(await real<typeof import("./png")>()),
  rasterize: vi.fn(async (svg: string) => new Blob([svg], { type: "image/png" })),
}));

describe("i nomi e il filtro dell'albero, nel Completo", () => {
  const NAMED = doc(`${LAYER}<rect id="oa1a1a1a1" x="10" y="10" width="20" height="20" fill="#000000"/><rect x="40" y="10" width="20" height="20" fill="#0072b2"/></g>`);
  const button = (): HTMLButtonElement => banco.host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Oggetti"]')!;
  const tree = (): HTMLElement => banco.host.querySelector<HTMLElement>('[role="tree"]')!;
  const labels = (): string[] => [...banco.host.querySelectorAll(".draw-object-label")].map((label) => label.textContent ?? "");
  const field = (): HTMLInputElement | null => banco.host.querySelector<HTMLInputElement>(".draw-object-rename");
  const inTree = (name: string, init: KeyboardEventInit = {}): KeyboardEvent => key(name, init, tree());
  const activeKey = (): string | undefined => document.getElementById(tree().getAttribute("aria-activedescendant") ?? "")?.dataset.key;

  /// Scrive `text` nel campo del nome aperto e lo conferma con Invio.
  function rename(text: string): void {
    const input = field()!;
    input.value = text;
    key("Enter", {}, input);
  }

  it("F2 sulla riga dà all'oggetto il suo nome, il primo `title`, in un passo che si annulla; vuoto lo toglie", () => {
    mount(NAMED);
    button().click();
    // Dal davanti: in cima il rettangolo che il documento ha per ultimo.
    expect(labels()).toEqual(["Livello 1", "Rettangolo, Blu", "Rettangolo, Nero"]);
    inTree("End");
    expect(banco.editor.selection).toEqual(["oa1a1a1a1"]);
    expect(inTree("F2").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field());
    expect(field()!.value).toBe("");
    expect(field()!.getAttribute("aria-label")).toBe("Nome di Rettangolo, Nero");
    expect(formatIssues(checkAccessibility(banco.host))).toBe("");
    rename("  Tetto ");
    expect(banco.editor.engine.text).toMatch(/<rect id="oa1a1a1a1" x="10" y="10" width="20" height="20" fill="#000000">\s*<title>Tetto<\/title>\s*<\/rect>/);
    expect(spoken()).toBe("Ora si chiama «Tetto».");
    expect(labels()[2]).toBe("Rettangolo «Tetto», Nero");
    expect(document.activeElement).toBe(tree());
    expect(activeKey()).toBe("oa1a1a1a1");
    expect(banco.editor.selection).toEqual(["oa1a1a1a1"]);
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(NAMED);
    expect(spoken()).toBe("Annullato: Nome.");
    banco.editor.redo();
    tree().focus();
    inTree("F2");
    expect(field()!.value).toBe("Tetto");
    rename("");
    // Il rettangolo torna com'era, su una riga sua come ogni elemento riscritto.
    expect(banco.editor.engine.text).toContain('<rect id="oa1a1a1a1" x="10" y="10" width="20" height="20" fill="#000000"/>');
    expect(banco.editor.engine.text).not.toContain("<title>");
    expect(spoken()).toBe("Nome tolto: ora è Rettangolo, Nero.");
    expect(banco.changes.map((change) => change.origin)).toEqual(["input", "undo", "redo", "input"]);
  });

  it("un oggetto senza id ne riceve uno, e resta scelto e sulla riga attiva", () => {
    mount(NAMED);
    button().click();
    inTree("ArrowDown");
    expect(banco.editor.selection[0]).toMatch(/^@/);
    inTree("F2");
    rename("Finestra");
    const [now] = banco.editor.selection;
    expect(now).toMatch(/^o[a-z0-9]{8}$/);
    expect(banco.editor.engine.text).toMatch(new RegExp(`<rect id="${now}" x="40" y="10" width="20" height="20" fill="#0072b2">\\s*<title>Finestra</title>`));
    expect(activeKey()).toBe(now);
  });

  it("un livello si rinomina da qui, e non resta senza nome", () => {
    mount(NAMED);
    button().click();
    inTree("F2");
    expect(field()!.value).toBe("Livello 1");
    expect(field()!.maxLength).toBe(80);
    rename("Disegno");
    expect(banco.editor.engine.text).toContain('<g id="l1" fub:layer="Disegno">');
    expect(spoken()).toBe("Il livello ora si chiama «Disegno».");
    expect(labels()[0]).toBe("Disegno");
    inTree("F2");
    rename("   ");
    expect(spoken()).toBe("Un livello ha sempre un nome: resta quello di prima.");
    expect(banco.editor.engine.text).toContain('<g id="l1" fub:layer="Disegno">');
    // Esc lascia il nome com'era.
    inTree("F2");
    field()!.value = "Altro";
    key("Escape", {}, field()!);
    expect(banco.editor.engine.text).toContain('<g id="l1" fub:layer="Disegno">');
    expect(document.activeElement).toBe(tree());
  });

  it("dice perché non rinomina un oggetto bloccato, dentro qualcosa di bloccato o in un livello bloccato, o che non sa riscrivere", () => {
    const INKSCAPE = "http://www.inkscape.org/namespaces/inkscape";
    mount(
      doc(
        `${LAYER}<rect id="oa1a1a1a1" width="10" height="10" fub:locked="true"/>` +
          `<g id="og1g1g1g1" fub:locked="true"><rect id="ob2b2b2b2" width="10" height="10"/></g>` +
          `<rect id="oc3c3c3c3" xmlns:inkscape="${INKSCAPE}" inkscape:label="Tetto" width="10" height="10"/></g>`,
      ),
      {},
    );
    button().click();
    inTree("ArrowDown");
    expect(activeKey()).toBe("oc3c3c3c3");
    inTree("F2");
    expect(field()).toBeNull();
    expect(spoken()).toBe("Ha parti che il disegno non sa riscrivere: il suo nome resta com’è.");
    inTree("ArrowDown");
    inTree("F2");
    expect(spoken()).toBe("È bloccato: sbloccalo per cambiargli il nome.");
    inTree("ArrowRight");
    inTree("ArrowRight");
    expect(activeKey()).toBe("ob2b2b2b2");
    inTree("F2");
    expect(spoken()).toBe("Ciò che lo contiene è bloccato: sbloccalo prima di cambiargli il nome.");
    inTree("End");
    inTree("F2");
    expect(spoken()).toBe("È bloccato: sbloccalo per cambiargli il nome.");
    expect(field()).toBeNull();
    expect(banco.changes).toEqual([]);

    banco.editor.dispose();
    mount(doc(`${LAYER.replace(">", ' fub:locked="true">')}<rect id="oa1a1a1a1" width="10" height="10"/></g>`));
    button().click();
    inTree("ArrowDown");
    inTree("F2");
    expect(spoken()).toBe("Il suo livello è bloccato: sblocca il livello per cambiargli il nome.");
    // Il livello bloccato, lui, si rinomina.
    inTree("Home");
    inTree("F2");
    expect(field()!.value).toBe("Livello 1");
  });

  it("F2 sul foglio e «Rinomina» nel menu della selezione aprono il nome nell'albero", () => {
    // Una linea: F2 su una forma chiusa ne scrive l'etichetta.
    mount(NAMED.replace('<rect id="oa1a1a1a1" x="10" y="10" width="20" height="20" fill="#000000"/>', '<line id="oa1a1a1a1" x1="10" y1="10" x2="30" y2="30" stroke="#000000"/>'));
    banco.editor.select(["oa1a1a1a1"]);
    surface().focus();
    expect(key("F2").defaultPrevented).toBe(true);
    expect(banco.host.querySelector<HTMLElement>(".draw-objects")!.hidden).toBe(false);
    expect(document.activeElement).toBe(field());
    expect(field()!.closest('[data-key="oa1a1a1a1"]')).not.toBeNull();
    key("Escape", {}, field()!);
    surface().focus();
    key("a", { ctrlKey: true });
    key("F2");
    expect(spoken()).toBe("Scegli un oggetto solo per cambiargli il nome.");
    expect(field()).toBeNull();
    banco.editor.select(["oa1a1a1a1"]);
    banco.host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Selezione avanzata"]')!.click();
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    const rename = [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((entry) => entry.querySelector(".menu-label")!.textContent === "Rinomina")!;
    expect(rename.querySelector(".menu-hint")?.textContent).toBe("F2");
    rename.click();
    expect(document.activeElement).toBe(field());
    expect(banco.changes).toEqual([]);
  });

  it("il filtro c'è coi livelli, e scriverci non comanda il foglio", () => {
    mount(NAMED);
    button().click();
    const filter = banco.host.querySelector<HTMLElement>(".draw-objects-filter")!;
    const search = banco.host.querySelector<HTMLInputElement>(".draw-objects-search")!;
    expect(filter.hidden).toBe(false);
    const tool = banco.editor.tool;
    search.focus();
    expect(key("r", {}, search).defaultPrevented).toBe(false);
    expect(key("Delete", {}, search).defaultPrevented).toBe(false);
    expect(banco.editor.tool).toBe(tool);
    search.value = "blu";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(labels()).toEqual(["Livello 1", "Rettangolo, Blu"]);
    expect(banco.host.querySelector(".draw-objects-status")!.textContent).toBe("1 oggetto trovato.");
    expect(formatIssues(checkAccessibility(banco.host))).toBe("");
    // Un oggetto nuovo che il filtro trova ci entra.
    banco.editor.setTool("rect");
    drag([[100, 100], [120, 120]]);
    expect(banco.host.querySelector(".draw-objects-status")!.textContent).toBe("1 oggetto trovato.");
    banco.editor.setSpace("simple");
    expect(filter.hidden).toBe(true);
    expect(search.value).toBe("");
    expect(labels()).toHaveLength(4);
    // Senza i livelli niente nomi: F2 nell'albero passa.
    tree().focus();
    expect(inTree("F2").defaultPrevented).toBe(false);
    expect(banco.changes.map((change) => change.origin)).toEqual(["input"]);
  });
});

describe("spostare dall'albero, nel Completo", () => {
  // Dal davanti: «Sopra» col cerchio, poi «Livello 1» con c, il gruppo g
  // (chiuso, con b) e a.
  const STACKED = doc(
    `${LAYER}<rect id="oa1a1a1a1" x="10" y="10" width="20" height="20" fill="#000000"/>`
      + '<g id="og1g1g1g1" transform="translate(50 0)"><rect id="ob2b2b2b2" x="0" y="0" width="10" height="10" fill="#000000"/></g>'
      + '<rect id="oc3c3c3c3" x="70" y="10" width="20" height="20" fill="#0072b2"/></g>'
      + '<g id="l2" fub:layer="Sopra"><circle id="od4d4d4d4" cx="5" cy="5" r="4" fill="#000000"/></g>',
  );
  const button = (): HTMLButtonElement => banco.host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Oggetti"]')!;
  const tree = (): HTMLElement => banco.host.querySelector<HTMLElement>('[role="tree"]')!;
  const keys = (): string[] => [...banco.host.querySelectorAll<HTMLElement>(".draw-object")].map((row) => row.dataset.key ?? "");
  const inTree = (name: string, init: KeyboardEventInit = {}): KeyboardEvent => key(name, init, tree());
  const activeKey = (): string | undefined => document.getElementById(tree().getAttribute("aria-activedescendant") ?? "")?.dataset.key;
  /// Gli id degli elementi del disegno, in ordine di documento.
  const order = (): string[] => [...banco.editor.engine.text.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]!);
  const parentOf = (id: string): string | null => banco.editor.engine.holder(id)?.parent?.facts.id ?? null;

  /// Apre l'albero con la riga `key` attiva e scelta.
  function openAt(id: string): void {
    button().click();
    (document.activeElement as HTMLElement).blur();
    banco.editor.select([id]);
    tree().focus();
    expect(activeKey()).toBe(id);
  }

  it("Alt+↓ porta l'oggetto dietro a ciò che ha dietro, in un passo che si annulla, e dice dove è arrivato", () => {
    mount(STACKED);
    openAt("oc3c3c3c3");
    expect(keys()).toEqual(["l2", "od4d4d4d4", "l1", "oc3c3c3c3", "og1g1g1g1", "oa1a1a1a1"]);
    expect(inTree("ArrowDown", { altKey: true }).defaultPrevented).toBe(true);
    // Oltre il gruppo chiuso: fra a e il gruppo.
    expect(order()).toEqual(["l1", "oa1a1a1a1", "oc3c3c3c3", "og1g1g1g1", "ob2b2b2b2", "l2", "od4d4d4d4"]);
    expect(spoken()).toBe("Rettangolo, Blu nel livello «Livello 1», al posto 2 di 3 dal davanti.");
    expect(keys()).toEqual(["l2", "od4d4d4d4", "l1", "og1g1g1g1", "oc3c3c3c3", "oa1a1a1a1"]);
    expect(banco.editor.selection).toEqual(["oc3c3c3c3"]);
    expect(activeKey()).toBe("oc3c3c3c3");
    expect(document.activeElement).toBe(tree());
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(STACKED);
    expect(spoken()).toBe("Annullato: Riordino.");
    banco.editor.redo();
    expect(order()).toEqual(["l1", "oa1a1a1a1", "oc3c3c3c3", "og1g1g1g1", "ob2b2b2b2", "l2", "od4d4d4d4"]);
    expect(banco.changes.map((change) => change.origin)).toEqual(["input", "undo", "redo"]);
  });

  it("entra in un gruppo aperto restando dov'era sul foglio, ne esce, e passa al livello accanto", () => {
    mount(STACKED);
    openAt("oc3c3c3c3");
    inTree("ArrowDown");
    inTree("ArrowRight");
    inTree("ArrowUp");
    expect(activeKey()).toBe("oc3c3c3c3");
    inTree("ArrowDown", { altKey: true });
    expect(parentOf("oc3c3c3c3")).toBe("og1g1g1g1");
    // Il gruppo è spostato di 50: il rettangolo lo compensa.
    expect(banco.editor.engine.text).toContain('<rect id="oc3c3c3c3" x="70" y="10" width="20" height="20" fill="#0072b2" transform="matrix(1 0 0 1 -50 0)"/>');
    expect(spoken()).toMatch(/^Rettangolo, Blu dentro Gruppo.*, al posto 1 di 2 dal davanti\.$/);
    expect(activeKey()).toBe("oc3c3c3c3");
    // Davanti a tutto nel gruppo: Alt+↑ lo porta fuori, davanti al gruppo.
    inTree("ArrowUp", { altKey: true });
    expect(parentOf("oc3c3c3c3")).toBe("l1");
    expect(order().slice(0, 5)).toEqual(["l1", "oa1a1a1a1", "og1g1g1g1", "ob2b2b2b2", "oc3c3c3c3"]);
    expect(banco.editor.engine.text).toContain('<rect id="oc3c3c3c3" x="70" y="10" width="20" height="20" fill="#0072b2"/>');
    // Davanti a tutto nel livello: nel livello sopra, dietro a ciò che c'è.
    inTree("ArrowUp", { altKey: true });
    expect(parentOf("oc3c3c3c3")).toBe("l2");
    expect(order()).toEqual(["l1", "oa1a1a1a1", "og1g1g1g1", "ob2b2b2b2", "l2", "oc3c3c3c3", "od4d4d4d4"]);
    expect(spoken()).toBe("Rettangolo, Blu nel livello «Sopra», al posto 2 di 2 dal davanti.");
    inTree("ArrowUp", { altKey: true });
    inTree("ArrowUp", { altKey: true });
    expect(spoken()).toBe("È già davanti a tutto.");
    expect(banco.changes).toHaveLength(4);
  });

  it("un livello va sopra o sotto gli altri, e resta il livello corrente", () => {
    mount(STACKED);
    button().click();
    inTree("Home");
    expect(activeKey()).toBe("l2");
    const current = banco.host.querySelector(".draw-layer-button")?.textContent;
    inTree("ArrowDown", { altKey: true });
    expect(order()).toEqual(["l2", "od4d4d4d4", "l1", "oa1a1a1a1", "og1g1g1g1", "ob2b2b2b2", "oc3c3c3c3"]);
    expect(spoken()).toBe("«Sopra» ora è al posto 2 di 2 dall’alto.");
    expect(keys().filter((each) => each.startsWith("l"))).toEqual(["l1", "l2"]);
    expect(activeKey()).toBe("l2");
    expect(banco.host.querySelector(".draw-layer-button")?.textContent).toBe(current);
    inTree("ArrowDown", { altKey: true });
    expect(spoken()).toBe("È già l’ultimo livello.");
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(STACKED);
    expect(spoken()).toBe("Annullato: Ordine dei livelli.");
  });

  it("dice perché non sposta ciò che è bloccato, o dentro qualcosa di bloccato; non entra in un livello bloccato", () => {
    mount(
      doc(
        `${LAYER.replace(">", ' fub:locked="true">')}<rect id="oe5e5e5e5" width="10" height="10"/></g>`
          + `<g id="l2" fub:layer="Sopra"><rect id="oa1a1a1a1" width="10" height="10" fub:locked="true"/>`
          + `<g id="og1g1g1g1" fub:locked="true"><rect id="ob2b2b2b2" width="10" height="10"/></g>`
          + `<rect id="oc3c3c3c3" width="10" height="10"/></g>`,
      ),
      {},
    );
    button().click();
    expect(keys()).toEqual(["l2", "oc3c3c3c3", "og1g1g1g1", "oa1a1a1a1", "l1", "oe5e5e5e5"]);
    inTree("End");
    inTree("ArrowUp", { altKey: true });
    expect(spoken()).toBe("Il suo livello è bloccato: sblocca il livello per spostarlo.");
    inTree("ArrowUp");
    inTree("ArrowUp");
    expect(activeKey()).toBe("oa1a1a1a1");
    inTree("ArrowUp", { altKey: true });
    expect(spoken()).toBe("È bloccato: sbloccalo per spostarlo.");
    inTree("ArrowUp");
    inTree("ArrowRight");
    inTree("ArrowRight");
    expect(activeKey()).toBe("ob2b2b2b2");
    inTree("ArrowUp", { altKey: true });
    expect(spoken()).toBe("Ciò che lo contiene è bloccato: sbloccalo prima di spostarlo.");
    inTree("Home");
    inTree("ArrowDown");
    expect(activeKey()).toBe("oc3c3c3c3");
    // Davanti a tutto, sopra non c'è niente; il gruppo bloccato si scavalca.
    inTree("ArrowDown", { altKey: true });
    expect(order().indexOf("oc3c3c3c3")).toBeLessThan(order().indexOf("og1g1g1g1"));
    expect(parentOf("oc3c3c3c3")).toBe("l2");
    inTree("ArrowDown", { altKey: true });
    inTree("ArrowDown", { altKey: true });
    expect(spoken()).toBe("Lì non va: quel livello è bloccato.");
    expect(parentOf("oc3c3c3c3")).toBe("l2");
    expect(banco.changes).toHaveLength(2);
  });

  it("un oggetto che cambia livello tiene lo stile che gli dava il foglio del disegno; non va dove gliene darebbe uno che non si toglie", () => {
    const source = doc(
      `<style>#l2 rect{fill:#d55e00}</style>${LAYER}<rect id="oe5e5e5e5" width="10" height="10"/></g>`
        + `<g id="l2" fub:layer="Sopra"><rect id="oc3c3c3c3" width="10" height="10"/></g>`,
    );
    mount(source);
    button().click();
    expect(keys()).toEqual(["l2", "oc3c3c3c3", "l1", "oe5e5e5e5"]);
    inTree("Home");
    inTree("ArrowDown");
    expect(activeKey()).toBe("oc3c3c3c3");
    inTree("ArrowDown", { altKey: true });
    expect(parentOf("oc3c3c3c3")).toBe("l1");
    expect(banco.editor.engine.text).toContain('<rect id="oc3c3c3c3" width="10" height="10" fill="#d55e00"/>');
    expect(spoken()).toMatch(/ 1 elemento riscritto perché resti com’era\.$/);
    expect(banco.changes).toHaveLength(1);
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(source);

    inTree("End");
    expect(activeKey()).toBe("oe5e5e5e5");
    inTree("ArrowUp", { altKey: true });
    expect(spoken()).toBe("Lì non va: un elemento cambierebbe «fill», e Fub non sa riscriverlo com’era.");
    expect(banco.editor.engine.text).toBe(source);
  });

  it("un collegamento non entra in un altro collegamento: Alt lo porta oltre", () => {
    mount(
      doc(
        `${LAYER}<a id="ol1l1l1l1" href="Note/uno.md"><rect id="oa1a1a1a1" width="10" height="10"/></a>`
          + `<a id="ol2l2l2l2" href="Note/due.md"><rect id="ob2b2b2b2" width="10" height="10"/></a></g>`,
      ),
      {},
    );
    openAt("ol2l2l2l2");
    inTree("ArrowDown");
    inTree("ArrowRight");
    expect(activeKey()).toBe("ol1l1l1l1");
    expect(keys()).toEqual(["l1", "ol2l2l2l2", "ol1l1l1l1", "oa1a1a1a1"]);
    inTree("ArrowUp");
    expect(activeKey()).toBe("ol2l2l2l2");
    inTree("ArrowDown", { altKey: true });
    expect(parentOf("ol2l2l2l2")).toBe("l1");
    expect(order()).toEqual(["l1", "ol2l2l2l2", "ob2b2b2b2", "ol1l1l1l1", "oa1a1a1a1"]);
  });

  it("le righe hanno la miniatura di ciò che disegnano, e la rifanno quando cambia", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    // Le miniature si disegnano finché il fotogramma ha tempo, e le altre al
    // fotogramma dopo: su una macchina carica ne servono più d'uno.
    const frame = (): void => {
      for (let round = 0; round < 50 && frames.length > 0; round++) for (const callback of frames.splice(0)) callback(0);
    };
    mount(STACKED);
    openAt("oc3c3c3c3");
    frame();
    const thumb = (id: string): Element | null => banco.host.querySelector(`.draw-object[data-key="${id}"] .draw-object-thumb > svg`);
    // Un oggetto inquadrato su di sé, un livello sulla pagina.
    const viewBox = (id: string): number[] => thumb(id)!.getAttribute("viewBox")!.split(" ").map(Number);
    viewBox("oc3c3c3c3").forEach((value, at) => expect(value).toBeCloseTo([68.8, 8.8, 22.4, 22.4][at]!, 9));
    viewBox("l1").forEach((value, at) => expect(value).toBeCloseTo([-6, -6, 112, 112][at]!, 9));
    expect(thumb("oc3c3c3c3")!.querySelector("rect")!.getAttribute("fill")).toBe("#0072b2");
    expect(thumb("og1g1g1g1")!.querySelectorAll("rect")).toHaveLength(1);
    const before = thumb("og1g1g1g1");
    inTree("ArrowDown");
    inTree("ArrowRight");
    inTree("ArrowUp");
    inTree("ArrowDown", { altKey: true });
    frame();
    expect(thumb("og1g1g1g1")).not.toBe(before);
    expect(thumb("og1g1g1g1")!.querySelectorAll("rect")).toHaveLength(2);
    expect(banco.host.querySelector(".draw-object-thumb > svg [data-scene-id]")).toBeNull();
    expect(formatIssues(checkAccessibility(banco.host))).toBe("");
  });

  it("una miniatura porta le risorse che la riga usa, e si rifà quando una di loro cambia", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const frame = (): void => {
      for (let round = 0; round < 50 && frames.length > 0; round++) for (const callback of frames.splice(0)) callback(0);
    };
    const source = doc(
      '<defs id="fub-defs"><linearGradient id="r1a1a1a1a" x2="1"><stop offset="0" stop-color="#0072b2"/></linearGradient>'
        + '<filter id="r2b2b2b2b"><feDropShadow dx="1" dy="1" stdDeviation="1" flood-color="#000000"/></filter></defs>'
        + `${LAYER}<rect id="oa1a1a1a1" x="10" y="10" width="20" height="20" fill="url(#r1a1a1a1a) #0072b2"/>`
        + '<rect id="oc3c3c3c3" x="70" y="10" width="20" height="20" fill="#000000"/></g>',
    );
    mount(source);
    openAt("oa1a1a1a1");
    frame();
    const thumb = (id: string): Element | null => banco.host.querySelector(`.draw-object[data-key="${id}"] .draw-object-thumb > svg`);
    const shown = thumb("oa1a1a1a1")!;
    // Solo la sfumatura che usa, sotto un id della miniatura.
    const gradient = shown.querySelector("defs > linearGradient")!;
    expect(gradient.id).toMatch(/^fubthumb\d+-r1a1a1a1a$/);
    expect(shown.querySelectorAll("defs > *")).toHaveLength(1);
    expect(shown.querySelector("rect")!.getAttribute("fill")).toBe(`url(#${gradient.id}) #0072b2`);
    expect(thumb("oc3c3c3c3")!.querySelector("defs")).toBeNull();
    // Le risorse non sono righe dell'albero.
    expect(keys()).toEqual(["l1", "oc3c3c3c3", "oa1a1a1a1"]);
    banco.editor.setEngine(SceneEngine.open(source.replace('stop-color="#0072b2"', 'stop-color="#d55e00"')));
    frame();
    expect(thumb("oa1a1a1a1")).not.toBe(shown);
    expect(thumb("oa1a1a1a1")!.querySelector("stop")!.getAttribute("stop-color")).toBe("#d55e00");
  });

  it("nel Semplice l'albero non sposta e non ha miniature", () => {
    mount(STACKED, { workspace: "simple" });
    openAt("oc3c3c3c3");
    inTree("ArrowDown", { altKey: true });
    expect(banco.editor.engine.text).toBe(STACKED);
    expect(activeKey()).toBe("og1g1g1g1");
    expect([...banco.host.querySelectorAll<HTMLElement>(".draw-object-thumb")].every((holder) => holder.hidden)).toBe(true);
  });
});
