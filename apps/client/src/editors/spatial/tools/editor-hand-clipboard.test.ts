// @vitest-environment happy-dom
// L'editor del disegno: la Mano e la Lente, il catalogo dei comandi, gli appunti.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { displayBinding } from "../../../ui/commands";
import { SHELL_KEYS } from "../../../ui/shell-keys.generated";
import { SceneEngine } from "../scene/engine";
import type { Op } from "../scene/ops";
import { readScene } from "../scene/read";
import { doc } from "../scene/test-support";
import { createDrawEditor, type DrawEditorOptions, type DrawPlace } from "./editor";
import { rasterize } from "./png";
import { LAYER } from "./test-support";
import { closeRadial } from "./radial";
import type { Workspace } from "./registry";
import { MOUSE, SOURCE, banco, dialog, drag, key, mount, pointer, size, spoken, surface } from "./editor-test-support";

// happy-dom non disegna: il PNG degli appunti è il testo che riceve.
vi.mock("./png", async (real) => ({
  ...(await real<typeof import("./png")>()),
  rasterize: vi.fn(async (svg: string) => new Blob([svg], { type: "image/png" })),
}));

/// Lo strato sopra con un contesto che registra ciò che disegna, e i
/// fotogrammi, che partono quando li si chiede. Va preparato prima di
/// montare l'editor.
function recording(): { readonly frame: () => void; readonly texts: () => string[]; readonly calls: () => Array<readonly [string, ...unknown[]]> } {
  const calls: Array<readonly [string, ...unknown[]]> = [];
  const context = new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, name) => {
      if (name in target) return target[name];
      if (name === "measureText") return () => ({ width: 10 });
      return (...args: unknown[]) => void calls.push([String(name), ...args]);
    },
    set: (target, name, value) => {
      target[name] = value;
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => frames.push(callback));
  // Ciò che ha fatto l'ultimo disegno, che comincia pulendo.
  const last = (): Array<readonly [string, ...unknown[]]> => calls.slice(calls.map(([name]) => name).lastIndexOf("clearRect"));
  return {
    frame: () => {
      for (const callback of frames.splice(0)) callback(0);
    },
    texts: () => last().filter(([name]) => name === "fillText").map(([, text]) => String(text)),
    calls: last,
  };
}

/// Le regole della vista dei contorni montate nel documento: un foglio
/// costruito (`adoptedStyleSheets`), non un `<style>`, per la CSP.
function outlineRules(): string {
  return document.adoptedStyleSheets
    .flatMap((sheet) => Array.from(sheet.cssRules, (rule) => rule.cssText))
    .filter((text) => text.includes("[data-outline]"))
    .join("\n");
}

describe("la Mano e la Lente", () => {
  const camera = (): string | null => banco.host.querySelector(".draw-preview g")!.getAttribute("transform");
  const keyUp = (key: string): void => {
    surface().dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
  };

  it("la Mano trascina la vista e non tocca il disegno", () => {
    mount();
    banco.editor.setTool("hand");
    expect(surface().dataset.tool).toBe("hand");
    drag([[10, 10], [25, 20], [40, 30]]);
    expect(camera()).toBe("matrix(1 0 0 1 30 20)");
    expect(banco.changes).toEqual([]);
  });

  it("Spazio tenuto col mouse sul foglio presta la Mano a ogni strumento, e lasciato lo rende", () => {
    mount();
    banco.editor.setTool("rect");
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, buttons: 0, clientX: 10, clientY: 10 }));
    expect(key(" ").defaultPrevented).toBe(true);
    expect(surface().dataset.view).toBe("grab");
    drag([[10, 10], [40, 30]]);
    expect(camera()).toBe("matrix(1 0 0 1 30 20)");
    expect(banco.changes).toEqual([]);
    keyUp(" ");
    expect(surface().dataset.view).toBeUndefined();
    drag([[10, 10], [40, 30]]);
    expect(banco.changes).toHaveLength(1);
  });

  it("Spazio senza il mouse sul foglio resta il «premi» del cursore", () => {
    mount();
    banco.editor.setTool("rect");
    expect(key(" ").defaultPrevented).toBe(true);
    expect(surface().dataset.view).toBeUndefined();
    expect(banco.host.querySelector<HTMLElement>(".draw-cursor")!.hasAttribute("data-pressed")).toBe(true);
  });

  it("la Lente ingrandisce al clic, rimpicciolisce con Alt, e inquadra il riquadro", () => {
    mount();
    size(200, 100);
    banco.editor.setTool("zoom");
    drag([[50, 50], [50, 50]]);
    expect(camera()).toBe("matrix(2 0 0 2 -50 -50)");
    drag([[50, 50], [50, 50]], { altKey: true });
    expect(camera()).toBe("matrix(1 0 0 1 0 0)");
    drag([[0, 0], [25, 10], [50, 25]]);
    const [scale] = camera()!.slice("matrix(".length).split(" ").map(Number);
    expect(scale).toBeGreaterThan(1);
    expect(banco.host.querySelector<HTMLElement>(".draw-zoom-box")!.hidden).toBe(true);
    expect(banco.changes).toEqual([]);
  });

  it("Ctrl+0 col foglio a fuoco è il 100%, Maiusc+2 inquadra la selezione", () => {
    mount();
    size(200, 100);
    surface().focus();
    key("+");
    expect(key("0", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(camera()!.startsWith("matrix(1 0 0 1 ")).toBe(true);
    // Fuori dal foglio Ctrl+0 resta dello Scrittoio.
    const outside = key("0", { ctrlKey: true }, banco.host.querySelector<HTMLElement>(".draw-rail button")!);
    expect(outside.defaultPrevented).toBe(false);
    key("@", { shiftKey: true, code: "Digit2" });
    expect(spoken()).toBe("Niente di scelto da mostrare.");
    banco.editor.select(["o1a2b3c4d"]);
    key("@", { shiftKey: true, code: "Digit2" });
    const [scale] = camera()!.slice("matrix(".length).split(" ").map(Number);
    expect(scale).toBeGreaterThan(2);
    expect(banco.changes).toEqual([]);
  });

  it("Ctrl+' accende e spegne la griglia; Ctrl+; e Ctrl+U non fanno più niente (ADR 0231)", () => {
    mount(SOURCE);
    surface().focus();
    const { shown } = banco.editor.grid;
    key("'", { ctrlKey: true });
    expect(banco.editor.grid.shown).toBe(!shown);
    const grid = banco.editor.grid;
    key(";", { ctrlKey: true, shiftKey: true });
    key("u", { ctrlKey: true });
    expect(banco.editor.grid).toEqual(grid);
  });

  it("Ctrl+. nasconde l'interfaccia del disegno e la riporta", () => {
    mount();
    const root = banco.host.querySelector<HTMLElement>(".draw-editor")!;
    banco.host.querySelector<HTMLElement>(".draw-rail button")!.focus();
    expect(key(".", { ctrlKey: true }, document.activeElement as HTMLElement).defaultPrevented).toBe(true);
    expect(root.hasAttribute("data-bare")).toBe(true);
    expect(document.activeElement).toBe(surface());
    expect(spoken()).toBe("Interfaccia nascosta: Ctrl+. la riporta.");
    key(".", { ctrlKey: true });
    expect(root.hasAttribute("data-bare")).toBe(false);
    expect(spoken()).toBe("Interfaccia di nuovo in vista.");
  });

  it("Ctrl+Y col foglio a fuoco mostra i contorni, la banda lo dice, e lo stesso tasto torna al disegno pieno", () => {
    mount();
    const painted = banco.host.querySelector<HTMLElement>(".spatial-painter")!;
    const band = (): string[] => banco.editor.status.items().map((item) => item.id);
    surface().focus();
    expect(key("y", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(painted.hasAttribute("data-outline")).toBe(true);
    expect(outlineRules()).toMatch(/fill:\s*none\s*!important/);
    expect(spoken()).toBe("Vista dei contorni: Ctrl+Y torna al disegno pieno.");
    expect(band()).toContain("outline");
    // Dalla banda si torna al disegno pieno.
    banco.editor.status.items().find((item) => item.id === "outline")!.open!();
    expect(painted.hasAttribute("data-outline")).toBe(false);
    expect(outlineRules()).toBe("");
    expect(band()).not.toContain("outline");
    key("y", { ctrlKey: true });
    key("y", { ctrlKey: true });
    expect(spoken()).toBe("Disegno pieno.");
    expect(banco.changes).toEqual([]);
  });

  it("Ctrl+/ cerca fra strumenti e menu, col posto e il tasto; uno spento dice perché; il comando usato torna in cima", async () => {
    mount();
    surface().focus();
    // Sulla tastiera italiana la barra è Maiusc+7.
    expect(key("/", { ctrlKey: true, shiftKey: true, code: "Digit7" }).defaultPrevented).toBe(true);
    const dialog = (): HTMLElement => document.querySelector<HTMLElement>(".draw-commands-dialog")!;
    const input = dialog().querySelector<HTMLInputElement>(".draw-commands-field input")!;
    expect(document.activeElement).toBe(input);
    const rows = (): HTMLElement[] => [...dialog().querySelectorAll<HTMLElement>(".draw-commands-row")];
    const labels = (): string[] => rows().map((row) => row.querySelector(".draw-commands-label")!.textContent!);
    const type = (text: string): void => {
      input.value = text;
      input.dispatchEvent(new Event("input"));
    };
    expect(labels()).toContain("Mano");
    type("contorni");
    expect(labels()[0]).toBe("Contorni");
    expect(rows()[0]!.querySelector(".draw-commands-path")!.textContent).toBe("Disegno › Vista");
    expect(rows()[0]!.querySelector(".draw-commands-key")!.textContent).toBe("Ctrl+Y");
    type("mostra la sel");
    expect(labels()[0]).toBe("Mostra la selezione");
    expect(rows()[0]!.getAttribute("aria-disabled")).toBe("true");
    expect(rows()[0]!.querySelector(".draw-commands-why")!.textContent).toBe("Scegli prima degli oggetti.");
    type("zzzz");
    expect(dialog().querySelector(".draw-commands-empty")!.textContent).toBe("Nessun comando per questa ricerca.");
    type("contorni");
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    key("Enter", {}, input);
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector(".draw-commands-dialog")).toBeNull();
    expect(banco.host.querySelector(".spatial-painter")!.hasAttribute("data-outline")).toBe(true);
    // Alla prossima apertura il comando usato sta in cima.
    key("/", { ctrlKey: true, shiftKey: true, code: "Digit7" });
    expect(labels()[0]).toBe("Contorni");
    key("Escape", {}, document.activeElement as HTMLElement);
    await Promise.resolve();
    expect(document.querySelector(".draw-commands-dialog")).toBeNull();
  });
  it("il navigatore, acceso da «Disegno › Vista», mostra il disegno e la vista; premere e trascinare spostano la vista", async () => {
    mount();
    size(200, 100);
    const nav = banco.host.querySelector<HTMLElement>(".draw-navigator")!;
    expect(nav.hidden).toBe(true);
    expect(nav.getAttribute("aria-hidden")).toBe("true");
    surface().focus();
    key("/", { ctrlKey: true, shiftKey: true, code: "Digit7" });
    const input = document.querySelector<HTMLInputElement>(".draw-commands-field input")!;
    input.value = "navigatore";
    input.dispatchEvent(new Event("input"));
    key("Enter", {}, input);
    await Promise.resolve();
    await Promise.resolve();
    expect(nav.hidden).toBe(false);
    expect(spoken()).toBe("Navigatore in vista, in basso a destra.");
    const map = nav.querySelector<SVGSVGElement>(".draw-navigator-map")!;
    expect(map.querySelectorAll(".draw-navigator-shapes rect").length).toBeGreaterThan(0);
    const box = map.getAttribute("viewBox")!.split(" ").map(Number);
    expect(box[2]).toBeGreaterThan(0);
    expect(nav.querySelector(".draw-navigator-view")!.getAttribute("points")).not.toBeNull();
    // La panoramica è larga 160 e alta 120, in alto a sinistra della pagina.
    map.getBoundingClientRect = () => ({ left: 0, top: 0, width: 160, height: 120, right: 160, bottom: 120, x: 0, y: 0, toJSON: () => ({}) });
    const before = camera();
    nav.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, clientX: 150, clientY: 110 }));
    const moved = camera();
    expect(moved).not.toBe(before);
    nav.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, clientX: 140, clientY: 100 }));
    expect(camera()).not.toBe(moved);
    nav.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, clientX: 140, clientY: 100 }));
    expect(banco.changes).toEqual([]);
  });

  it("i tasti del disegno non prendono quelli dello Scrittoio, tranne quelli dichiarati", async () => {
    mount(SOURCE);
    key("?", { shiftKey: true });
    const drawn = new Set([...dialog().querySelectorAll("th kbd")].map((kbd) => kbd.textContent!));
    // Col fuoco nel disegno il disegno tiene questi, e fuori restano dello
    // Scrittoio: sul foglio Ctrl+0 è il 100%, fra gli oggetti Ctrl+F li
    // filtra.
    const declared = new Set<string>(["Mod-0", "Mod-f"]);
    const shell = Object.values(SHELL_KEYS).flatMap((chord): string[] => (chord === null ? [] : [chord]));
    const clashes = shell.filter((chord) => !declared.has(chord) && drawn.has(displayBinding(chord)));
    expect(clashes).toEqual([]);
    for (const chord of declared) expect(drawn.has(displayBinding(chord)), chord).toBe(true);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("fuori da un gesto, sotto la selezione ci sono le sue misure", () => {
    const layer = recording();
    mount();
    banco.editor.setTool("select");
    banco.editor.select(["o1a2b3c4d"]);
    layer.frame();
    expect(layer.texts()).toHaveLength(1);
    expect(layer.texts()[0]).toMatch(/^\S+ × \S+$/);
  });
});

describe("il catalogo dei comandi", () => {
  /// Un oggetto di ogni specie che si sceglie: rettangolo, ellisse, linea,
  /// testo, tracciato, gruppo, immagine e collegamento.
  const KINDS = doc(
    `<title>Prova</title>${LAYER}<rect id="oc1c1c1c1" x="10" y="10" width="30" height="20" fill="#0072b2"/>` +
      `<ellipse id="oc2c2c2c2" cx="60" cy="20" rx="10" ry="8" fill="#e69f00"/>` +
      `<line id="oc3c3c3c3" x1="10" y1="50" x2="40" y2="60" stroke="#000000" stroke-width="2"/>` +
      `<text id="oc4c4c4c4" x="50" y="60"><tspan x="50" dy="0">Ciao</tspan></text>` +
      `<path id="oc5c5c5c5" d="M10 80 C20 70 30 90 40 80" fill="none" stroke="#000000"/>` +
      `<g id="oc6c6c6c6"><rect x="60" y="70" width="10" height="10"/><rect x="72" y="70" width="10" height="10"/></g>` +
      `<image id="oc7c7c7c7" x="100" y="10" width="40" height="20" href="data:image/png;base64,iVBORw0KGgo="/>` +
      `<a id="oc8c8c8c8" href="Note/a.md"><rect x="100" y="50" width="20" height="20" fill="#009e73"/></a></g>`,
  );
  const IDS = ["oc1c1c1c1", "oc2c2c2c2", "oc3c3c3c3", "oc4c4c4c4", "oc5c5c5c5", "oc6c6c6c6", "oc7c7c7c7", "oc8c8c8c8"];
  /// Chi ospita l'editor sa fare tutto: esportare, collegare, scegliere
  /// immagini nel vault.
  const HOST: DrawEditorOptions = {
    onExport: () => {},
    links: { choose: async () => null, open: () => {} },
    images: { url: async () => null, read: async () => null, choose: async () => null },
  };

  /// Ciò che si raggiunge nello spazio `workspace`: i comandi del catalogo,
  /// le sezioni e i campi delle proprietà che si vedono, senza selezione, con
  /// ogni oggetto da solo e con tutti insieme, con la selezione e con la penna.
  const reach = (workspace: Workspace): Set<string> => {
    banco.host.replaceChildren();
    mount(KINDS, { workspace, ...HOST });
    banco.editor.setTool("select");
    // Le proprietà aperte, se ci sono: le sezioni si leggono lì.
    banco.editor.commands().find((one) => one.id === "draw.button:properties")?.run();
    const found = new Set<string>();
    const look = (): void => {
      for (const command of banco.editor.commands()) found.add(`comando ${command.id}`);
      for (const section of banco.host.querySelectorAll<HTMLElement>("[data-section]")) {
        if (section.hidden || section.closest("[hidden]") !== null) continue;
        found.add(`sezione ${section.dataset.section}`);
        for (const field of section.querySelectorAll<HTMLElement>("[data-field]")) if (field.closest("[hidden]") === null) found.add(`campo ${field.dataset.field}`);
      }
    };
    look();
    for (const id of IDS) {
      banco.editor.select([id]);
      look();
    }
    banco.editor.select(IDS);
    look();
    banco.editor.select([]);
    banco.editor.setTool("pen");
    look();
    banco.editor.dispose();
    return found;
  };

  it("ha strumenti, Annulla, Ripeti, il menu «Disegno» e la barra della selezione, con id unici", () => {
    mount(KINDS);
    banco.editor.setTool("select");
    banco.editor.select(IDS.slice(0, 2));
    const all = banco.editor.commands();
    const ids = all.map((one) => one.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("draw.tool.pen");
    expect(ids).toContain("draw.undo");
    expect(ids).toContain("draw.group");
    expect(ids).toContain("draw.menu:vista/contorni");
    for (const one of all) expect(one.label, one.id).not.toBe("");
    // Un tasto fa una cosa sola: due comandi con lo stesso tasto hanno lo
    // stesso nome (lo stesso comando da due posti).
    const byKey = new Map<string, string>();
    for (const one of all) {
      if (one.hint === undefined || one.hint === "") continue;
      const before = byKey.get(`${one.context} ${one.hint}`);
      if (before !== undefined) expect(one.label, `${one.id} ${one.hint}`).toBe(before);
      else byKey.set(`${one.context} ${one.hint}`, one.label);
    }
  });

  it("il Completo raggiunge tutto ciò che raggiunge il Semplice, e in più le funzioni che il Semplice non ha", () => {
    const full = reach("full");
    const simple = reach("simple");
    expect([...simple].filter((what) => !full.has(what))).toEqual([]);
    const more = [...full].filter((what) => !simple.has(what));
    for (const what of ["comando draw.menu:selezione-avanzata/isola-il-gruppo", "comando draw.button:draw-layers", "comando draw.button:draw-history", "comando draw.button:draw-access", "comando draw.group", "campo grid", "comando draw.unlink"]) {
      expect(more, what).toContain(what);
    }
  });

  it("il menu radiale prende dal catalogo strumenti, Annulla e Ripeti, e si apre dal catalogo da tastiera", () => {
    mount(KINDS);
    banco.editor.setTool("pen");
    const radial = banco.editor.commands().find((one) => one.id === "draw.radial")!;
    radial.run();
    const items = [...document.querySelectorAll<HTMLElement>(".draw-radial-item")].map((item) => item.getAttribute("aria-label"));
    expect(items).toContain("Annulla");
    expect(items).toContain("Ripeti");
    closeRadial();
  });
});

describe("gli appunti", () => {
  const ID = "o1a2b3c4d";

  /// Gli appunti di sistema, che il `navigator` dei test non ha: ciò che vi
  /// si scrive si rilegge.
  let system: ClipboardItem[];
  let clipboard: { read: () => Promise<ClipboardItem[]>; write: (items: ClipboardItem[]) => Promise<void> };
  beforeEach(() => {
    system = [];
    clipboard = {
      read: async () => system,
      write: async (items) => {
        system = [...items];
      },
    };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
  });
  afterEach(() => {
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  /// Un evento degli appunti, sul foglio se non si dice dove.
  function clip(type: "copy" | "cut" | "paste", data = new DataTransfer(), target: EventTarget = surface()): ClipboardEvent {
    const event = new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData: data });
    target.dispatchEvent(event);
    return event;
  }

  /// Appunti che portano `text` come `type`.
  function holding(text: string, type = "text/plain"): DataTransfer {
    const data = new DataTransfer();
    data.setData(type, text);
    return data;
  }

  /// Copia la selezione col tasto, e rende il testo negli appunti.
  function copied(): string {
    const data = new DataTransfer();
    clip("copy", data);
    return data.getData("text/plain");
  }

  /// Un rilascio sul foglio: happy-dom non ha `DragEvent`.
  function drop(files: readonly File[], x: number, y: number): MouseEvent {
    const data = new DataTransfer();
    for (const one of files) data.items.add(one);
    const event = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperty(event, "dataTransfer", { value: data });
    surface().dispatchEvent(event);
    return event;
  }

  /// Aspetta che l'incolla finisca di entrare.
  async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const hover = (x: number, y: number): void => {
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: x, clientY: y }));
  };
  const rects = (): string[] => banco.editor.engine.text.match(/<rect [^>]*\/>/g) ?? [];
  const bar = (): HTMLElement => banco.host.querySelector<HTMLElement>(".draw-progress")!;

  /// Un SVG di `count` quadratini con un nome di 4 KiB ciascuno: pesa
  /// tanto e si disegna in fretta.
  function heavy(count: number): string {
    const name = "x".repeat(4096);
    const squares = Array.from({ length: count }, (_, i) => `<rect x="${i % 50}" y="${Math.floor(i / 50)}" width="1" height="1"><title>${name}</title></rect>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="60">${squares.join("")}</svg>`;
  }

  it("copiare scrive la selezione come SVG, anche in sola lettura; tagliare la toglie, in un passo", () => {
    mount();
    banco.editor.select([ID]);
    const data = new DataTransfer();
    expect(clip("copy", data).defaultPrevented).toBe(true);
    const svg = data.getData("text/plain");
    expect(data.getData("image/svg+xml")).toBe(svg);
    expect(svg).toMatch(/^<svg [^>]*viewBox="59 59 22 22"/);
    expect(svg).toContain('<rect id="o1a2b3c4d" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/>');
    expect(spoken()).toBe("1 oggetto copiato.");
    expect(banco.changes).toEqual([]);
    banco.editor.setReadOnly(true);
    expect(clip("copy").defaultPrevented).toBe(true);
    expect(clip("cut").defaultPrevented).toBe(false);
    expect(rects()).toHaveLength(1);
    banco.editor.setReadOnly(false);
    const cut = new DataTransfer();
    expect(clip("cut", cut).defaultPrevented).toBe(true);
    expect(cut.getData("text/plain")).toBe(svg);
    expect(rects()).toEqual([]);
    expect(banco.editor.selection).toEqual([]);
    expect(spoken()).toBe("1 oggetto tagliato. Il disegno ha 0 oggetti.");
    expect(banco.changes).toHaveLength(1);
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(SOURCE);
  });

  it("senza selezione lo si dice; un campo, e il resto della pagina, tengono i loro appunti", () => {
    mount();
    expect(clip("copy").defaultPrevented).toBe(false);
    expect(spoken()).toBe("Nessun oggetto scelto.");
    banco.editor.select([ID]);
    const title = banco.host.querySelector<HTMLInputElement>(".draw-title-input")!;
    title.focus();
    expect(clip("copy", new DataTransfer(), title).defaultPrevented).toBe(false);
    expect(clip("paste", holding(SOURCE), title).defaultPrevented).toBe(false);
    title.blur();
    const outside = document.createElement("p");
    document.body.append(outside);
    expect(clip("copy", new DataTransfer(), outside).defaultPrevented).toBe(false);
    outside.remove();
    expect(banco.changes).toEqual([]);
  });

  it("incollato torna com'era, con un id nuovo: al cursore, scelto, in un passo", async () => {
    mount();
    size(1000, 500);
    banco.editor.select([ID]);
    const svg = copied();
    hover(300, 300);
    banco.editor.setTool("rect");
    expect(clip("paste", holding(svg)).defaultPrevented).toBe(true);
    await settle();
    const [id] = banco.editor.selection;
    expect(id).not.toBe(ID);
    expect(rects()).toEqual([
      '<rect id="o1a2b3c4d" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/>',
      `<rect id="${id}" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2" transform="matrix(1 0 0 1 230 230)"/>`,
    ]);
    expect(banco.editor.tool).toBe("select");
    expect(spoken()).toBe("1 oggetto incollato. Strumento: Selezione. Il disegno ha 2 oggetti.");
    expect(banco.changes).toHaveLength(1);
    // Di nuovo allo stesso punto, un passo più in là, come una copia.
    clip("paste", holding(svg));
    await settle();
    expect(rects()[2]).toMatch(/ transform="matrix\(1 0 0 1 254 254\)"\/>$/);
    banco.editor.undo();
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(SOURCE);
  });

  it("senza il cursore va al centro della vista; Ctrl+Maiusc+V nello stesso punto", async () => {
    mount();
    size(1000, 500);
    banco.editor.setTool("select");
    banco.editor.select([ID]);
    const svg = copied();
    clip("paste", holding(svg));
    await settle();
    expect(rects()[1]).toMatch(/ transform="matrix\(1 0 0 1 430 180\)"\/>$/);
    expect(key("V", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    clip("paste", holding(svg));
    await settle();
    const [id] = banco.editor.selection;
    expect(rects()[2]).toBe(`<rect id="${id}" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/>`);
    // Il tasto vale per l'incolla che lo segue, non per i prossimi.
    clip("paste", holding(svg));
    await settle();
    expect(rects()[3]).toMatch(/ transform="matrix\(1 0 0 1 430 180\)"\/>$/);
  });

  it("un SVG di fuori entra in un gruppo, senza eseguire niente; uno che non si legge lo si dice", async () => {
    mount();
    size(1000, 500);
    const active =
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="globalThis.attivato = 1"><script>globalThis.attivato = 2</script>' +
      '<image href="nessuna.png" width="1" height="1" onerror="globalThis.attivato = 3"/><rect width="10" height="10" onclick="globalThis.attivato = 4"/></svg>';
    clip("paste", holding(active));
    await settle();
    expect(banco.editor.selection).toHaveLength(1);
    expect(readScene(banco.editor.engine.text).diagnostics.filter((d) => d.code === "S005").map((d) => d.detail)).toEqual(["onload", "script", "onerror", "onclick"]);
    surface().click();
    expect("attivato" in globalThis).toBe(false);
    expect(banco.host.querySelector("script, [onload], [onerror], [onclick]")).toBeNull();
    const before = banco.editor.engine.text;
    clip("paste", holding('<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>'));
    await settle();
    expect(spoken()).toBe("Non è un SVG ben formato: non si incolla.");
    // Un testo che non è un SVG resta a chi lo vuole.
    expect(clip("paste", holding("ciao")).defaultPrevented).toBe(false);
    expect(spoken()).toBe("Negli appunti non c’è niente che il disegno sappia incollare.");
    banco.editor.setReadOnly(true);
    clip("paste", holding(active));
    await settle();
    expect(banco.editor.engine.text).toBe(before);
  });

  it("ciò che Excalidraw e draw.io mettono negli appunti entra coi suoi oggetti, e il rapporto lo dice", async () => {
    mount();
    size(1000, 500);
    const shape = {
      type: "rectangle", id: "r", x: 0, y: 0, width: 100, height: 50, angle: 0, strokeColor: "#1e1e1e",
      backgroundColor: "transparent", fillStyle: "hachure", strokeWidth: 2, strokeStyle: "solid", roughness: 1,
      opacity: 100, groupIds: [], roundness: null, isDeleted: false, locked: false, link: null, boundElements: null,
    };
    const excalidraw = JSON.stringify({ type: "excalidraw/clipboard", elements: [shape], files: {} });
    const pasted = clip("paste", holding(excalidraw));
    expect(pasted.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(rects().length).toBeGreaterThan(1), { timeout: 4000 });
    expect(banco.editor.selection.length).toBeGreaterThan(0);
    // Il tratto a schizzo non entra uguale, e lo si dice.
    expect(spoken()).toMatch(/schizzo/);

    const drawio = encodeURIComponent(
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="" style="rounded=0;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="40" height="20" as="geometry"/></mxCell></root></mxGraphModel>',
    );
    const count = rects().length;
    expect(clip("paste", holding(drawio)).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(rects().length).toBeGreaterThan(count), { timeout: 4000 });
  });

  it("un file .svg lasciato sul foglio va dove cade, col suo nome; due sono un passo", async () => {
    mount();
    size(1000, 500);
    const svg = (fill: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="${fill}"/></svg>`;
    expect(drop([new File([svg("#336699")], "Logo.svg", { type: "image/svg+xml" })], 150, 120).defaultPrevented).toBe(true);
    await settle();
    const [logo] = banco.editor.selection;
    expect(spoken()).toBe("1 oggetto incollato. Strumento: Selezione. Il disegno ha 2 oggetti.");
    expect(banco.editor.engine.text).toContain(`<g id="${logo}" transform="matrix(1 0 0 1 130 110)">`);
    expect(banco.editor.engine.text).toContain("<title>Logo</title>");
    // Un file senza tipo vale per il suo nome.
    drop([new File([svg("#d55e00")], "uno.svg", { type: "image/svg+xml" }), new File([svg("#000000")], "DUE.SVG")], 400, 300);
    await settle();
    expect(banco.editor.selection).toHaveLength(2);
    expect(banco.changes).toHaveLength(2);
    expect(spoken()).toBe("2 oggetti incollati. Il disegno ha 4 oggetti.");
  });

  it("le immagini e i collegamenti del vault seguono il disegno in cui vanno; ciò che viene da fuori resta", async () => {
    /// I documenti di una cartella, come li trova e li nomina la shell.
    const placeIn = (folder: string): DrawPlace => ({ locate: (href) => `${folder}/${href.split("#")[0]}`, refer: (path) => `../${path}` });
    const linked = doc(
      `<title>Prova</title>${LAYER}<image id="oiiiiiiii" href="foto.png" x="0" y="0" width="10" height="10"/>` +
        '<a id="oaaaaaaaa" href="Note/Pioggia.md#Nuvole"><rect id="orrrrrrrr" x="20" y="0" width="5" height="5"/></a>' +
        '<image id="ojjjjjjjj" href="/Sfondi/mare.png" x="30" y="0" width="10" height="10"/></g>',
    );
    mount(linked, { place: placeIn("Disegni") });
    banco.editor.select(["oiiiiiiii", "oaaaaaaaa", "ojjjjjjjj"]);
    const svg = copied();
    banco.editor.dispose();
    mount(SOURCE, { place: placeIn("Altro") });
    clip("paste", holding(svg));
    await settle();
    expect(banco.editor.engine.text).toContain(' href="../Disegni/foto.png"');
    expect(banco.editor.engine.text).toContain(' href="../Disegni/Note/Pioggia.md#Nuvole"');
    expect(banco.editor.engine.text).toContain(' href="/Sfondi/mare.png"');
    banco.editor.undo();
    // Lo stesso testo scritto altrove non dice da dove viene.
    clip("paste", holding(svg.replace("<svg ", "<svg  ")));
    await settle();
    expect(banco.editor.engine.text).toContain(' href="foto.png"');
  });

  it("un incolla grande mostra la sua barra e resta un passo", async () => {
    mount();
    size(1000, 500);
    banco.editor.setTool("select");
    const svg = heavy(2560);
    expect(svg.length).toBeGreaterThan(10 * 1024 * 1024);
    clip("paste", holding(svg));
    expect(bar().hidden).toBe(false);
    expect(spoken()).toBe("Lettura dell’SVG…");
    expect(formatIssues(checkAccessibility(bar()))).toBe("");
    const labels: string[] = [];
    const values: number[] = [];
    while (!bar().hidden) {
      const label = bar().querySelector(".draw-progress-label")!.textContent!;
      if (labels[labels.length - 1] !== label) labels.push(label);
      const value = bar().querySelector("progress")!.getAttribute("value");
      if (value !== null) values.push(Number(value));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(labels).toEqual(["Lettura dell’SVG…", "Inserimento dell’SVG…", "Scrittura nel disegno…"]);
    expect(values.length).toBeGreaterThan(1);
    expect(values.every((value, i) => value > 0 && value <= 1 && (i === 0 || value >= values[i - 1]!))).toBe(true);
    expect(spoken()).toBe("1 oggetto incollato. Il disegno ha 2 oggetti.");
    expect(banco.changes).toHaveLength(1);
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(SOURCE);
  });

  it("Esc e «Interrompi» fermano l'incolla, e il disegno non cambia", async () => {
    mount(SOURCE, { workspace: "simple" });
    const svg = heavy(256);
    clip("paste", holding(svg));
    expect(key("Escape").defaultPrevented).toBe(true);
    await settle();
    expect(spoken()).toBe("Incolla interrotto: il disegno non è cambiato.");
    expect(bar().hidden).toBe(true);
    clip("paste", holding(svg));
    const stop = bar().querySelector<HTMLButtonElement>(".draw-progress-stop")!;
    expect(stop.textContent).toBe("Interrompi");
    expect(stop.getAttribute("aria-keyshortcuts")).toBe("Escape");
    stop.focus();
    stop.click();
    await settle();
    expect(spoken()).toBe("Incolla interrotto: il disegno non è cambiato.");
    // Il fuoco torna sul foglio, non resta su un pulsante nascosto.
    expect(document.activeElement).toBe(surface());
    expect(banco.changes).toEqual([]);
    expect(banco.editor.engine.text).toBe(SOURCE);
  });

  it("dal menu: copia col comando del browser, incolla dagli appunti che legge; dove non può lo dice", async () => {
    mount(SOURCE);
    size(1000, 500);
    banco.editor.setTool("select");
    banco.editor.select([ID]);
    const menu = (): HTMLButtonElement[] => {
      const open = document.querySelectorAll<HTMLElement>(".context-menu");
      return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    };
    const item = (label: string): HTMLButtonElement => {
      banco.host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Selezione avanzata"]')!.click();
      return menu().find((entry) => entry.querySelector(".menu-label")!.textContent === label)!;
    };
    // happy-dom non ha `execCommand`: come un browser che non lo lascia fare.
    item("Copia").click();
    expect(spoken()).toBe("Da qui il browser non lascia scrivere negli appunti: usa Ctrl+C.");
    const sent: DataTransfer[] = [];
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: (command: string) => {
        const data = new DataTransfer();
        sent.push(data);
        document.body.dispatchEvent(new ClipboardEvent(command, { bubbles: true, cancelable: true, clipboardData: data }));
        return true;
      },
    });
    try {
      item("Copia").click();
    } finally {
      delete (document as { execCommand?: unknown }).execCommand;
    }
    expect(spoken()).toBe("1 oggetto copiato.");
    const svg = sent[0]!.getData("text/plain");
    expect(svg).toContain('<rect id="o1a2b3c4d"');
    // Il PNG di una copia superata non arriva: l'SVG accanto sì.
    const late = Promise.reject(new Error("superato"));
    late.catch(() => undefined);
    await clipboard.write([new ClipboardItem({ "text/plain": new Blob([svg], { type: "text/plain" }), "image/png": late })]);
    item("Incolla nello stesso punto").click();
    await settle();
    const [id] = banco.editor.selection;
    expect(rects()[1]).toBe(`<rect id="${id}" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/>`);
    item("Incolla").click();
    await settle();
    expect(rects()[2]).toMatch(/ transform="matrix\(1 0 0 1 430 180\)"\/>$/);
    clipboard.read = async () => [new ClipboardItem({ "image/png": late })];
    item("Incolla").click();
    await settle();
    expect(spoken()).toBe("Negli appunti non c’è niente che il disegno sappia incollare.");
    clipboard.read = () => Promise.reject(new DOMException("negato", "NotAllowedError"));
    item("Incolla").click();
    await settle();
    expect(spoken()).toBe("Da qui il browser non lascia leggere gli appunti: incolla con Ctrl+V.");
    expect(banco.changes).toHaveLength(2);
  });

  it("dove il browser lo lascia fare, la copia scrive anche il PNG; quello di una copia superata no", async () => {
    mount();
    banco.editor.select([ID]);
    const written: ClipboardItem[][] = [];
    clipboard.write = async (items) => {
      written.push([...items]);
    };
    const svg = copied();
    await settle();
    expect(written[0]!.map((item) => item.types)).toEqual([["text/plain", "image/png"]]);
    expect(await (await written[0]![0]!.getType("text/plain")).text()).toBe(svg);
    const png = await written[0]![0]!.getType("image/png");
    expect(png.type).toBe("image/png");
    // Il disegno passa a chi disegna con le dimensioni dell'SVG copiato.
    expect(await png.text()).toContain('viewBox="59 59 22 22"');
    expect(vi.mocked(rasterize)).toHaveBeenCalled();
    // Dove si può, anche l'SVG va negli appunti di sistema.
    Object.defineProperty(ClipboardItem, "supports", { configurable: true, value: (type: string) => type === "image/svg+xml" });
    try {
      copied();
      copied();
    } finally {
      delete (ClipboardItem as { supports?: unknown }).supports;
    }
    expect(written[2]![0]!.types).toEqual(["text/plain", "image/png", "image/svg+xml"]);
    await expect(written[1]![0]!.getType("image/png")).rejects.toThrow();
    await expect(written[2]![0]!.getType("image/png")).resolves.toBeInstanceOf(Blob);
    // Una copia d'altro, nella pagina, supera quella del disegno; un altro
    // disegno che la sente passare no.
    const other = document.createElement("div");
    document.body.append(other);
    try {
      createDrawEditor(other, SceneEngine.open(SOURCE), banco.owner, {});
      copied();
      document.body.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() }));
      copied();
      await settle();
      await expect(written[3]![0]!.getType("image/png")).rejects.toThrow();
      await expect(written[4]![0]!.getType("image/png")).resolves.toBeInstanceOf(Blob);
    } finally {
      other.remove();
    }
  });

  it("lo stile si copia e si incolla con Ctrl+Alt+C e Ctrl+Alt+V, nel Completo, in un passo", () => {
    const A = "oa1a1a1a1";
    const B = "ob2b2b2b2";
    const PAIR = doc(
      `<title>Prova</title>${LAYER}<rect id="${A}" x="10" y="10" width="20" height="20" fill="#0072b2" stroke="#d55e00" stroke-width="4" stroke-dasharray="4 2" opacity="0.5"/>` +
        `<rect id="${B}" x="50" y="10" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/></g>`,
    );
    mount(PAIR, { workspace: "simple" });
    banco.editor.select([A]);
    expect(key("c", { ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
    banco.editor.dispose();
    mount(PAIR);
    banco.editor.select([B]);
    // Lo stile copiato è della pagina: finché nessuno lo copia, non c'è.
    expect(key("v", { ctrlKey: true, altKey: true }).defaultPrevented).toBe(true);
    expect(spoken()).toBe("Non c’è uno stile da incollare: prima copialo con Ctrl+Alt+C.");
    banco.editor.select([A]);
    // Su un Mac ⌥C scrive «ç»: vale il tasto.
    expect(key("ç", { metaKey: true, altKey: true, code: "KeyC" }).defaultPrevented).toBe(true);
    expect(spoken()).toBe("Stile copiato.");
    banco.editor.select([B]);
    key("v", { ctrlKey: true, altKey: true });
    expect(spoken()).toBe("Stile incollato su 1 oggetto.");
    expect(rects()[1]).toBe(`<rect id="${B}" x="50" y="10" width="20" height="20" fill="#0072b2" stroke="#d55e00" stroke-width="4" stroke-dasharray="4 2" opacity="0.5"/>`);
    expect(banco.changes).toHaveLength(1);
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(PAIR);
  });

  /// Il campione `name` di colore `color`, con l'id `id`.
  const swatch = (id: string, name: string, color: string): string =>
    `<linearGradient id="${id}" fub:role="swatch" fub:name="${name}" gradientUnits="userSpaceOnUse"><stop stop-color="${color}"/></linearGradient>`;

  it("lo stile incollato in un altro disegno usa il campione con lo stesso nome e colore, o il colore del campione", () => {
    const A = "oa1a1a1a1";
    const B = "ob2b2b2b2";
    mount(
      doc(
        `<defs id="fub-defs">${swatch("rs1s1s1s1", "Blu mare", "#0072b2")}${swatch("rs2s2s2s2", "Vermiglio", "#d55e00")}</defs>` +
          `${LAYER}<rect id="${A}" x="10" y="10" width="20" height="20" fill="url(#rs1s1s1s1) #0072b2" stroke="url(#rs2s2s2s2) #d55e00" stroke-width="4"/></g>`,
      ),
      {},
    );
    banco.editor.select([A]);
    key("c", { ctrlKey: true, altKey: true });
    banco.editor.dispose();
    // Qui «blu mare» ha lo stesso colore, e «Vermiglio» un altro.
    const OTHER = doc(
      `<defs id="fub-defs">${swatch("rt1t1t1t1", "blu mare", "#0072b2")}${swatch("rt2t2t2t2", "Vermiglio", "#e69f00")}</defs>` +
        `${LAYER}<rect id="${B}" x="50" y="10" width="20" height="20" fill="#000000"/></g>`,
    );
    mount(OTHER);
    banco.editor.select([B]);
    key("v", { ctrlKey: true, altKey: true });
    expect(spoken()).toBe("Stile incollato su 1 oggetto.");
    expect(rects()[0]).toBe(`<rect id="${B}" x="50" y="10" width="20" height="20" fill="url(#rt1t1t1t1) #0072b2" stroke="#d55e00" stroke-width="4"/>`);
    expect(banco.changes).toHaveLength(1);
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(OTHER);
  });

  it("lo stile incollato dopo che il campione ha cambiato colore lo usa col colore di adesso", () => {
    const A = "oa1a1a1a1";
    const B = "ob2b2b2b2";
    mount(
      doc(
        `<defs id="fub-defs">${swatch("rs1s1s1s1", "Blu mare", "#0072b2")}</defs>` +
          `${LAYER}<rect id="${A}" x="10" y="10" width="20" height="20" fill="url(#rs1s1s1s1) #0072b2"/>` +
          `<rect id="${B}" x="50" y="10" width="20" height="20" fill="#000000"/></g>`,
      ),
      {},
    );
    banco.editor.select([A]);
    key("c", { ctrlKey: true, altKey: true });
    const recolor: Op = {
      op: "batch",
      ops: [
        { op: "set", id: "rs1s1s1s1", part: [0], attrs: { "stop-color": "#56b4e9" } },
        { op: "set", id: A, attrs: { fill: "url(#rs1s1s1s1) #56b4e9" } },
      ],
    };
    expect(banco.editor.perform("draw.action.fill", recolor)).toBe(true);
    banco.editor.select([B]);
    key("v", { ctrlKey: true, altKey: true });
    expect(rects()[1]).toBe(`<rect id="${B}" x="50" y="10" width="20" height="20" fill="url(#rs1s1s1s1) #56b4e9"/>`);
  });
});

describe("la fine", () => {
  it("toglie l'editor dalla pagina e smette di ascoltare", () => {
    mount();
    const root = banco.host.querySelector(".draw-editor")!;
    const sheet = surface();
    banco.editor.dispose();
    expect(root.isConnected).toBe(false);
    banco.host.append(root);
    banco.editor.setTool("rect");
    sheet.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, clientX: 10, clientY: 10 }));
    sheet.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, clientX: 50, clientY: 40 }));
    expect(banco.changes).toEqual([]);
  });
});
