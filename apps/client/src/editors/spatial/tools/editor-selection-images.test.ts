// @vitest-environment happy-dom
// L'editor del disegno: la selezione avanzata, le immagini incollate e quelle del vault.
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime } from "../../../ui/lifetime";
import { closeContextMenu } from "../../../ui/menu";
import { SceneEngine } from "../scene/engine";
import { doc } from "../scene/test-support";
import { type DrawImages } from "./editor";
import type { Decoded, EncodeType, ImageCodec } from "./images";
import { LAYER } from "./test-support";
import { DEFAULT_CURVE } from "../../../ink/input/pressure";
import { Init, MOUSE, SOURCE, banco, dialog, drag, key, mount, pointer, size, spoken, submit, surface } from "./editor-test-support";

// happy-dom non disegna: il PNG degli appunti è il testo che riceve.
vi.mock("./png", async (real) => ({
  ...(await real<typeof import("./png")>()),
  rasterize: vi.fn(async (svg: string) => new Blob([svg], { type: "image/png" })),
}));

describe("la selezione avanzata, nel Completo", () => {
  const A = "oa1a1a1a1";
  const B = "ob2b2b2b2";
  const C = "oc3c3c3c3";
  const D = "od4d4d4d4";
  const E = "oe5e5e5e5";
  const G = "og1g1g1g1";
  const H = "oh2h2h2h2";
  /// Due rettangoli blu in alto; sotto, un gruppo con un rettangolo arancione
  /// e un gruppo di due neri. I riempimenti si toccano, e la camera resta
  /// l'identità.
  const SET = doc(
    `<title>Prova</title>${LAYER}<rect id="${A}" x="10" y="10" width="20" height="20" fill="#0072b2"/>` +
      `<rect id="${B}" x="50" y="10" width="20" height="20" fill="#0072b2"/>` +
      `<g id="${G}"><rect id="${C}" x="10" y="60" width="20" height="20" fill="#d55e00"/>` +
      `<g id="${H}"><rect id="${D}" x="50" y="60" width="20" height="20" fill="#000000"/>` +
      `<rect id="${E}" x="90" y="60" width="20" height="20" fill="#000000"/></g></g></g>`,
  );

  const selectionButton = (): HTMLButtonElement => banco.host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Selezione avanzata"]')!;
  const menu = (): HTMLButtonElement[] => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    // Le voci, fuori dalla riga degli appunti.
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(.menu-quick)')];
  };
  const labelOf = (entry: HTMLElement): string => entry.querySelector(".menu-label")!.textContent ?? "";
  const item = (label: string): HTMLButtonElement => menu().find((entry) => labelOf(entry) === label)!;
  const rightClick = (x: number, y: number): MouseEvent => {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y });
    surface().dispatchEvent(event);
    return event;
  };
  const isolation = (): HTMLElement => banco.host.querySelector<HTMLElement>(".draw-isolation")!;
  const crumbs = (): string[] => [...isolation().querySelectorAll(".draw-isolation-crumb")].map((crumb) => crumb.textContent ?? "");
  const painted = (id: string): SVGElement => banco.host.querySelector<SVGElement>(`[data-scene-id="${id}"]`)!;
  /// Un tocco, lontano nel tempo dal precedente: non fa un doppio tocco.
  const tap = (x: number, y: number, init: Init = {}): void => {
    banco.clock += 1000;
    drag([[x, y]], init);
  };
  const doubleTap = (x: number, y: number): void => {
    banco.clock += 1000;
    drag([[x, y]]);
    drag([[x, y]]);
  };

  afterEach(() => {
    closeContextMenu();
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  });

  it("nel Semplice non c'è: niente Lazo, niente menu, e i tasti restano a chi li aveva", () => {
    mount(SET, { workspace: "simple" });
    banco.editor.setTool("select");
    expect(key("q").defaultPrevented).toBe(false);
    expect(banco.editor.tool).toBe("select");
    expect(selectionButton().hidden).toBe(true);
    banco.editor.select([A]);
    expect(key("L", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    banco.editor.select([G]);
    expect(key("Enter", { ctrlKey: true }).defaultPrevented).toBe(false);
    doubleTap(20, 70);
    expect(isolation().hidden).toBe(true);
    tap(20, 70, { ctrlKey: true });
    expect(banco.editor.selection).toEqual([G]);
    expect(rightClick(20, 70).defaultPrevented).toBe(false);
    expect(banco.editor.engine.text).toBe(SET);
  });

  it("con Ctrl o ⌘ un clic sceglie l'oggetto dentro il gruppo, Maiusc lo aggiunge, e lo si sposta da solo", () => {
    mount(SET);
    banco.editor.setTool("select");
    tap(20, 70);
    expect(banco.editor.selection).toEqual([G]);
    tap(20, 70, { ctrlKey: true });
    expect(banco.editor.selection).toEqual([C]);
    tap(60, 70, { ctrlKey: true, shiftKey: true });
    expect(banco.editor.selection).toEqual([C, D]);
    tap(150, 150);
    tap(20, 70, { ctrlKey: true });
    expect(banco.editor.selection).toEqual([C]);
    banco.clock += 1000;
    drag([[20, 70], [30, 70], [40, 70]]);
    expect(banco.editor.engine.text).toContain(`<rect id="${C}" x="10" y="60" width="20" height="20" fill="#d55e00" transform="matrix(1 0 0 1 20 0)"/>`);
    expect(banco.editor.engine.text).toContain(`<g id="${G}">`);
    expect(banco.editor.selection).toEqual([C]);
    // Maiusc su un oggetto scelto dentro il gruppo lo toglie.
    tap(40, 70, { shiftKey: true });
    expect(banco.editor.selection).toEqual([]);
  });

  it("due tocchi su un gruppo lo isolano: il resto si attenua e non si sceglie, la barra dice dove si è, Esc esce; il file non cambia", () => {
    mount(SET);
    banco.editor.setTool("select");
    expect(isolation().hidden).toBe(true);
    doubleTap(20, 70);
    expect(banco.editor.selection).toEqual([C]);
    expect(spoken()).toBe("Gruppo isolato: Gruppo, 2 oggetti. Si sceglie solo qui dentro; Esc esce. Rettangolo, Vermiglio, 1 di 2.");
    expect(isolation().hidden).toBe(false);
    expect(isolation().getAttribute("aria-label")).toBe("Gruppo isolato");
    expect(crumbs()).toEqual(["Livello «Livello 1»", "Gruppo, 2 oggetti"]);
    expect(painted(A).style.opacity).toBe("0.4");
    expect(painted(C).style.opacity).toBe("");
    expect(painted(D).style.opacity).toBe("");
    // Fuori dal gruppo non si sceglie niente; Ctrl+A sceglie ciò che c'è dentro.
    tap(20, 20);
    expect(banco.editor.selection).toEqual([]);
    key("a", { ctrlKey: true });
    expect(banco.editor.selection).toEqual([C, H]);
    expect(formatIssues(checkAccessibility(banco.host))).toBe("");
    key("Escape");
    expect(banco.editor.selection).toEqual([G]);
    expect(spoken()).toBe("Fuori dal gruppo: si sceglie in tutto il disegno.");
    expect(isolation().hidden).toBe(true);
    expect(painted(A).style.opacity).toBe("");
    key("Escape");
    expect(banco.editor.selection).toEqual([]);
    // Due tocchi sul vuoto escono anche loro.
    doubleTap(20, 70);
    expect(isolation().hidden).toBe(false);
    doubleTap(150, 150);
    expect(isolation().hidden).toBe(true);
    expect(banco.changes).toEqual([]);
    expect(banco.editor.engine.text).toBe(SET);
  });

  it("l'isolamento non sopravvive alla chiusura: riaperto il disegno, si sceglie in tutto, e il file non lo ricorda", () => {
    mount(SET);
    banco.editor.setTool("select");
    doubleTap(20, 70);
    expect(isolation().hidden).toBe(false);
    banco.editor.dispose();
    banco.host.replaceChildren();
    mount(SET);
    banco.editor.setTool("select");
    expect(isolation().hidden).toBe(true);
    expect(crumbs()).not.toContain("Gruppo, 2 oggetti");
    tap(20, 20);
    expect(banco.editor.selection).toEqual([A]);
    expect(banco.changes).toEqual([]);
    expect(banco.editor.engine.text).toBe(SET);
  });

  it("Ctrl+Invio isola il gruppo scelto; dentro, un gruppo si isola ancora, e la barra riporta a ogni gruppo del percorso", () => {
    mount(SET);
    banco.editor.setTool("select");
    banco.editor.select([A]);
    key("Enter", { ctrlKey: true });
    expect(spoken()).toBe("Scegli un gruppo solo, un collegamento o un’istanza di un simbolo, per isolarlo.");
    expect(isolation().hidden).toBe(true);
    banco.editor.select([G]);
    key("Enter", { ctrlKey: true });
    expect(banco.editor.selection).toEqual([C]);
    banco.editor.select([H]);
    key("Enter", { ctrlKey: true });
    expect(banco.editor.selection).toEqual([D]);
    expect(crumbs()).toEqual(["Livello «Livello 1»", "Gruppo, 2 oggetti", "Gruppo, 2 oggetti"]);
    expect(isolation().querySelector('[aria-current="location"]')!.textContent).toBe(crumbs()[2]);
    expect(painted(C).style.opacity).toBe("0.4");
    isolation().querySelector<HTMLButtonElement>('button.draw-isolation-crumb[data-depth="1"]')!.click();
    expect(banco.editor.selection).toEqual([H]);
    expect(document.activeElement).toBe(surface());
    expect(crumbs()).toHaveLength(2);
    // Esc in un gruppo dentro un altro torna a quello di fuori.
    banco.editor.select([H]);
    key("Enter", { ctrlKey: true });
    key("Escape");
    expect(banco.editor.selection).toEqual([H]);
    expect(crumbs()).toHaveLength(2);
    isolation().querySelector<HTMLButtonElement>("button.draw-isolation-crumb")!.click();
    expect(isolation().hidden).toBe(true);
    expect(banco.editor.selection).toEqual([G]);
    // Il pulsante della barra esce di un gruppo.
    key("Enter", { ctrlKey: true });
    isolation().querySelector<HTMLButtonElement>('button[aria-label="Esci dal gruppo"]')!.click();
    expect(isolation().hidden).toBe(true);
    expect(banco.editor.selection).toEqual([G]);
  });

  it("con un gruppo isolato ciò che si disegna entra nel gruppo, in cima, e il gruppo resta isolato", () => {
    mount(SET);
    banco.editor.select([G]);
    key("Enter", { ctrlKey: true });
    banco.editor.setTool("rect");
    drag([[120, 100], [140, 120]]);
    expect(banco.editor.engine.text).toMatch(new RegExp(`<rect id="${E}"[^>]*/>\\s*</g>\\s*<rect id="o[a-z0-9]{8}"[^>]*/>\\s*</g>\\s*</g>`));
    expect(isolation().hidden).toBe(false);
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(SET);
  });

  it("Ctrl+Maiusc+L blocca e Ctrl+Maiusc+H nasconde gli oggetti scelti, in un passo; «Sblocca tutto» e «Mostra tutto» li riportano", () => {
    mount(SET);
    banco.editor.setTool("select");
    banco.editor.select([A]);
    key("L", { ctrlKey: true, shiftKey: true });
    expect(banco.editor.engine.text).toContain(`<rect id="${A}" fub:locked="true" x="10" y="10" width="20" height="20" fill="#0072b2"/>`);
    expect(banco.editor.selection).toEqual([]);
    expect(spoken()).toBe("1 oggetto bloccato: non si sceglie finché non lo sblocchi.");
    tap(20, 20);
    expect(banco.editor.selection).toEqual([]);
    banco.editor.select([B, G]);
    key("H", { ctrlKey: true, shiftKey: true });
    expect(spoken()).toBe("2 oggetti nascosti: non si vedono finché non li mostri.");
    expect(banco.editor.engine.text).toContain(`<rect id="${B}" x="50" y="10" width="20" height="20" fill="#0072b2" display="none"/>`);
    expect(banco.editor.engine.text).toContain(`<g id="${G}" display="none">`);
    banco.editor.undo();
    expect(spoken()).toBe("Annullato: Oggetti nascosti.");
    banco.editor.redo();
    selectionButton().click();
    item("Sblocca tutto").click();
    expect(spoken()).toBe("1 oggetto sbloccato.");
    expect(banco.editor.selection).toEqual([A]);
    selectionButton().click();
    item("Mostra tutto").click();
    expect(spoken()).toBe("2 oggetti di nuovo visibili.");
    expect(banco.editor.selection).toEqual([B, G]);
    expect(banco.editor.engine.text).toBe(SET);
    selectionButton().click();
    expect(item("Sblocca tutto").getAttribute("aria-disabled")).toBe("true");
    expect(item("Sblocca tutto").querySelector(".menu-description")!.textContent).toBe("Non c’è niente da sbloccare.");
    expect(item("Mostra tutto").querySelector(".menu-description")!.textContent).toBe("Non c’è niente di nascosto.");
  });

  it("il menu sceglie i simili, a ogni profondità, e il resto; le voci che adesso non servono dicono perché", () => {
    mount(SET);
    banco.editor.setTool("select");
    selectionButton().click();
    expect(menu().map((entry) => [labelOf(entry), entry.getAttribute("aria-disabled")])).toEqual([
      ["Taglia", "true"],
      ["Copia", "true"],
      ["Incolla", null],
      ["Incolla nello stesso punto", null],
      ["Copia lo stile", "true"],
      ["Incolla lo stile", "true"],
      ["Seleziona tutto", null],
      ["Inverti la selezione", null],
      ["Stesso riempimento", "true"],
      ["Stesso colore del contorno", "true"],
      ["Stesso spessore del contorno", "true"],
      ["Stesso tipo di oggetto", "true"],
      ["Stesso strumento", "true"],
      ["Stesso livello", "true"],
      ["Rinomina", "true"],
      ["Blocca", "true"],
      ["Nascondi", "true"],
      ["Sblocca tutto", "true"],
      ["Mostra tutto", "true"],
      ["Isola il gruppo", "true"],
    ]);
    expect(item("Stesso riempimento").querySelector(".menu-description")!.textContent).toBe("Scegli prima degli oggetti.");
    expect(item("Rinomina").querySelector(".menu-description")!.textContent).toBe("Scegli un oggetto solo per cambiargli il nome.");
    item("Seleziona tutto").click();
    expect(banco.editor.selection).toEqual([A, B, G]);
    banco.editor.select([A]);
    selectionButton().click();
    item("Stesso riempimento").click();
    expect(banco.editor.selection).toEqual([A, B]);
    expect(spoken()).toBe("2 oggetti scelti.");
    selectionButton().click();
    item("Inverti la selezione").click();
    expect(banco.editor.selection).toEqual([G]);
    // Dentro un gruppo, il resto è anche ciò che sta fuori dal gruppo.
    tap(60, 70, { ctrlKey: true });
    expect(banco.editor.selection).toEqual([D]);
    selectionButton().click();
    item("Inverti la selezione").click();
    expect(banco.editor.selection).toEqual([A, B, C, E]);
    tap(150, 150);
    tap(60, 70, { ctrlKey: true });
    selectionButton().click();
    item("Stesso riempimento").click();
    expect(banco.editor.selection).toEqual([D, E]);
    banco.editor.select([A]);
    selectionButton().click();
    item("Stesso tipo di oggetto").click();
    expect(banco.editor.selection).toEqual([A, B, C, D, E]);
    selectionButton().click();
    expect(item("Stesso strumento").getAttribute("aria-disabled")).toBe("true");
    expect(item("Stesso strumento").querySelector(".menu-description")!.textContent).toBe(
      "Vale per i tratti a mano libera: la stessa penna, o lo stesso evidenziatore, con la stessa punta.",
    );
    expect(banco.changes).toEqual([]);
  });

  it("il tasto destro su un oggetto lo sceglie e apre il menu della selezione; Maiusc+F10 lo apre dalla tastiera", () => {
    mount(SET);
    banco.editor.setTool("select");
    expect(rightClick(60, 20).defaultPrevented).toBe(true);
    expect(banco.editor.selection).toEqual([B]);
    expect(document.querySelector(".context-menu")!.getAttribute("aria-labelledby")).toBe(selectionButton().id);
    closeContextMenu();
    // Su un oggetto già scelto la selezione resta com'è.
    banco.editor.select([A, B]);
    rightClick(60, 20);
    expect(banco.editor.selection).toEqual([A, B]);
    closeContextMenu();
    // Con la penna il tasto destro apre lo stesso menu, sulla selezione che
    // c'è, e in fondo il menu radiale.
    banco.editor.setTool("pen");
    banco.editor.select([A]);
    expect(rightClick(60, 20).defaultPrevented).toBe(true);
    expect(document.querySelector(".draw-radial")).toBeNull();
    expect(menu().map(labelOf)).toContain("Menu radiale");
    expect(banco.editor.selection).toEqual([A]);
    closeContextMenu();
    banco.editor.setTool("select");
    surface().focus();
    expect(key("F10", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(menu().map(labelOf)).toContain("Isola il gruppo");
    // L'evento che il tasto manda dietro non apre un secondo menu; il tasto
    // destro dopo sì.
    expect(rightClick(60, 20).defaultPrevented).toBe(true);
    expect(document.querySelectorAll(".context-menu")).toHaveLength(1);
    closeContextMenu();
    expect(key("ContextMenu").defaultPrevented).toBe(true);
    closeContextMenu();
  });

  it("il tasto destro sul foglio vuoto dà le sole voci che fanno qualcosa, e il piede invita a scrivere", () => {
    mount(SET);
    banco.editor.setTool("select");
    expect(rightClick(150, 150).defaultPrevented).toBe(true);
    expect(banco.editor.selection).toEqual([]);
    expect(document.querySelector("#context-menu .menu-clipboard")).toBeNull();
    expect(menu().map(labelOf)).toEqual(["Incolla", "Incolla nello stesso punto", "Seleziona tutto", "Mostra tutto il disegno", "Menu radiale"]);
    expect(menu().every((entry) => entry.getAttribute("aria-disabled") === null)).toBe(true);
    expect(document.querySelector("#context-menu .menu-foot")!.textContent).toContain("Scrivi per trovare altro");
    item("Seleziona tutto").click();
    expect(banco.editor.selection).toEqual([A, B, G]);
    // Il resto si trova scrivendo.
    banco.editor.select([]);
    rightClick(150, 150);
    for (const letter of "inverti") key(letter, {}, document.activeElement as HTMLElement);
    expect(menu().map(labelOf)).toEqual(["Inverti la selezione"]);
    closeContextMenu();
    // A chi legge soltanto non resta che vedere il disegno.
    banco.editor.setReadOnly(true);
    rightClick(150, 150);
    expect(menu().map(labelOf)).toEqual(["Seleziona tutto", "Mostra tutto il disegno"]);
    closeContextMenu();
  });

  it("con una selezione il tasto destro dà gli appunti in cima e le sue voci, sempre sotto nove", () => {
    mount(SET);
    banco.editor.setTool("select");
    rightClick(60, 20);
    expect(banco.editor.selection).toEqual([B]);
    const row = document.querySelector<HTMLElement>("#context-menu .menu-clipboard")!;
    expect([...row.querySelectorAll("[role=menuitem]")].map((b) => b.textContent)).toEqual(["Taglia", "Copia", "Incolla"]);
    const labels = menu().map(labelOf);
    expect(labels).toEqual(["Copia lo stile", "Incolla lo stile", "Seleziona simili", "Blocca", "Nascondi", "Isola il gruppo", "Menu radiale"]);
    expect(labels.length).toBeLessThan(9);
    closeContextMenu();
    // Dentro un gruppo, con l'uscita.
    doubleTap(20, 70);
    rightClick(20, 70);
    expect(menu().map(labelOf)).toContain("Esci dal gruppo");
    expect(menu().length).toBeLessThan(9);
    closeContextMenu();
  });

  it("l'albero mostra il blocco e la visibilità con un segno e a parole, e li cambia dal segno o coi tasti", () => {
    const flagged = SET.replace(`fill="#0072b2"/>`, `fill="#0072b2" fub:locked="true"/>`).replace(`<g id="${H}">`, `<g id="${H}" display="none">`);
    mount(flagged);
    banco.host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Oggetti"]')!.click();
    const row = (key: string): HTMLElement => banco.host.querySelector<HTMLElement>(`.draw-object[data-key="${key}"]`)!;
    const sign = (key: string, what: "lock" | "hide"): HTMLElement => row(key).querySelector<HTMLElement>(`.draw-object-sign[data-sign="${what}"]`)!;
    expect([...banco.host.querySelectorAll(".draw-object-label")].map((label) => label.textContent)).toEqual([
      "Livello 1",
      "Gruppo, 2 oggetti",
      "Rettangolo, Blu",
      "Rettangolo, bloccato, Blu",
    ]);
    expect(sign(A, "lock").hasAttribute("data-on")).toBe(true);
    expect(sign(A, "lock").title).toBe("Sblocca");
    expect(sign(B, "lock").hasAttribute("data-on")).toBe(false);
    expect(row(A).hasAttribute("data-toggles")).toBe(true);
    sign(A, "lock").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(banco.editor.engine.text).toContain(`<rect id="${A}" x="10" y="10" width="20" height="20" fill="#0072b2"/>`);
    expect(spoken()).toBe("Rettangolo, Blu: sbloccato.");
    // Ctrl+Maiusc+H sulla riga attiva la nasconde, e lo stesso tasto la mostra.
    const tree = banco.host.querySelector<HTMLElement>('[role="tree"]')!;
    tree.focus();
    tree.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
    tree.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    tree.dispatchEvent(new KeyboardEvent("keydown", { key: "H", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    expect(banco.editor.engine.text).toContain(`<g id="${G}" display="none">`);
    expect(spoken()).toBe("Gruppo, 2 oggetti: nascosto.");
    tree.dispatchEvent(new KeyboardEvent("keydown", { key: "H", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    expect(banco.editor.engine.text).toContain(`<g id="${G}">`);
    expect(formatIssues(checkAccessibility(banco.host))).toBe("");
  });

  it("«?» elenca i tasti della selezione avanzata", () => {
    mount(SET);
    key("?", { shiftKey: true });
    expect([...dialog().querySelectorAll(".keys-list > table caption")].map((caption) => caption.textContent)).toContain("Selezione avanzata");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});

describe("le immagini incollate", () => {
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const MIB = 1024 * 1024;

  /// Un codec finto: ogni immagine misura `width` × `height` pixel, e la sua
  /// ricodifica pesa quanto dice `full` per il tipo, meno se rimpicciolita.
  function codec(width: number, height: number, full: Partial<Record<EncodeType, number>> = {}, readable = true): ImageCodec & { calls: string[]; closed: number } {
    const fake = {
      calls: [] as string[],
      closed: 0,
      async decode(): Promise<Decoded | null> {
        if (!readable) return null;
        return {
          width,
          height,
          opaque: () => true,
          async encode(type: EncodeType, scale: number) {
            fake.calls.push(`${type} ${scale}`);
            const size = full[type];
            return size === undefined ? null : new Uint8Array(Math.round(size * scale * scale)).fill(7);
          },
          close() {
            fake.closed++;
          },
        };
      },
    };
    return fake;
  }

  const file = (bytes: Uint8Array<ArrayBuffer>, name = "shot.png", type = "image/png"): File => new File([bytes], name, { type });

  function paste(files: readonly File[], target: HTMLElement = surface()): ClipboardEvent {
    const data = new DataTransfer();
    for (const one of files) data.items.add(one);
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
    target.dispatchEvent(event);
    return event;
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

  /// Aspetta che l'immagine finisca di entrare.
  async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const images = (): string[] => banco.editor.engine.text.match(/<image [^>]*\/>/g) ?? [];
  const imageLine = (): string => images()[0] ?? "";
  const base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

  it("uno screenshot incollato entra nel file com'è, scelto, con la selezione come strumento", async () => {
    mount(SOURCE, { imageCodec: codec(200, 100) });
    size(1000, 500);
    banco.editor.setTool("pen");
    expect(paste([file(PNG)]).defaultPrevented).toBe(true);
    await settle();
    const [id] = banco.editor.selection;
    expect(imageLine()).toBe(`<image id="${id}" x="400" y="200" width="200" height="100" href="data:image/png;base64,${base64(PNG)}"/>`);
    expect(banco.editor.tool).toBe("select");
    expect(spoken()).toBe("Immagine aggiunta. Strumento: Selezione. Il disegno ha 2 oggetti.");
    // Un gesto solo, che annulla toglie intero.
    expect(banco.changes).toHaveLength(1);
    banco.editor.undo();
    expect(imageLine()).toBe("");
  });

  it("va dove è il cursore, e due immagini insieme sono un gesto, una sopra l'altra", async () => {
    mount(SOURCE, { workspace: "simple", imageCodec: codec(100, 50) });
    size(1000, 500);
    // Con la selezione già in mano, lo strumento non cambia e non si dice.
    banco.editor.setTool("select");
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: 300, clientY: 300 }));
    paste([file(PNG), file(PNG, "due.png")]);
    await settle();
    expect(images().map((line) => line.match(/ x="[^"]*" y="[^"]*"/)![0])).toEqual([' x="250" y="275"', ' x="274" y="299"']);
    expect(banco.editor.selection).toHaveLength(2);
    expect(banco.changes).toHaveLength(1);
    expect(spoken()).toBe("2 immagini aggiunte. Il disegno ha 3 oggetti.");
  });

  it("con l'aggancio, l'angolo in alto a sinistra va sull'incrocio più vicino, e le immagini si scostano di passi interi", async () => {
    mount(SOURCE, { imageCodec: codec(100, 50), grid: { shown: false, snap: true, step: 20, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE } });
    size(1000, 500);
    banco.editor.setTool("select");
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: 300, clientY: 300 }));
    paste([file(PNG), file(PNG, "due.png")]);
    await settle();
    // Da (250, 275) a (260, 280); la seconda parte 40 più in là, non 24.
    expect(images().map((line) => line.match(/ x="[^"]*" y="[^"]*"/)![0])).toEqual([' x="260" y="280"', ' x="300" y="320"']);
  });

  it("oltre i 5 MiB propone di ridurla: una foto diventa JPEG, con la stessa misura sul foglio", async () => {
    const fake = codec(4000, 3000, { "image/jpeg": 3 * MIB });
    mount(SOURCE, { imageCodec: fake });
    size(1000, 500);
    const big = new Uint8Array(6 * MIB);
    big.set(PNG);
    paste([file(big)]);
    await settle();
    expect(dialog().querySelector("h2")!.textContent).toBe("Immagine troppo pesante");
    expect(dialog().querySelector("p")!.textContent).toBe(
      "L’immagine pesa 6 MiB, e in un disegno un’immagine può pesare al più 5 MiB. Ridurla? Avrà meno pixel, ma la stessa misura sul foglio.",
    );
    expect(dialog().getAttribute("aria-describedby")).toBe(dialog().querySelector("p")!.id);
    expect(document.activeElement?.textContent).toBe("Riduci");
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    await submit();
    await settle();
    expect(fake.calls).toEqual(["image/jpeg 1"]);
    expect(imageLine()).toMatch(/^<image id="[^"]+" x="233.33" y="50" width="533.33" height="400" href="data:image\/jpeg;base64,BwcH/);
    expect(banco.changes).toHaveLength(1);
    expect(fake.closed).toBe(1);
  });

  it("annullare la riduzione non aggiunge niente", async () => {
    mount(SOURCE, { imageCodec: codec(4000, 3000, { "image/jpeg": 3 * MIB }) });
    const big = new Uint8Array(6 * MIB);
    big.set(PNG);
    paste([file(big)]);
    await settle();
    [...dialog().querySelectorAll("button")].find((button) => button.textContent === "Annulla")!.click();
    await settle();
    expect(banco.changes).toEqual([]);
    expect(imageLine()).toBe("");
  });

  it("un JPEG girato dall'EXIF si ricodifica diritto, e un BMP diventa PNG", async () => {
    const exif = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 42, 0, 8, 0, 0, 0,
      1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xda, 0, 2,
    ]);
    const fake = codec(30, 40, { "image/jpeg": 500, "image/png": 900 });
    mount(SOURCE, { workspace: "simple", imageCodec: fake });
    paste([file(exif, "foto.jpg", "image/jpeg")]);
    await settle();
    expect(fake.calls).toEqual(["image/jpeg 1"]);
    expect(imageLine()).toContain('width="30" height="40" href="data:image/jpeg;base64,');
    paste([file(Uint8Array.from([0x42, 0x4d, 0, 0]), "vecchia.bmp", "image/bmp")]);
    await settle();
    expect(fake.calls).toEqual(["image/jpeg 1", "image/png 1"]);
    expect(banco.editor.engine.text).toContain('href="data:image/png;base64,');
  });

  it("un file lasciato sul foglio va dove cade; uno che non è un'immagine lo si dice", async () => {
    mount(SOURCE, { imageCodec: codec(200, 100) });
    size(1000, 500);
    expect(drop([file(PNG)], 150, 120).defaultPrevented).toBe(true);
    await settle();
    expect(imageLine()).toMatch(/ x="50" y="70" width="200" height="100" /);
    const note = drop([file(Uint8Array.from([65]), "nota.txt", "text/plain")], 10, 10);
    expect(note.defaultPrevented).toBe(true);
    expect(spoken()).toBe("Non è un’immagine o un SVG che il disegno sa leggere.");
  });

  it("un'immagine che non si legge, un documento in sola lettura e il titolo non scrivono", async () => {
    mount(SOURCE, { imageCodec: codec(10, 10, {}, false) });
    paste([file(PNG)]);
    await settle();
    expect(spoken()).toBe("Non è un’immagine che il disegno sa leggere.");
    banco.editor.setReadOnly(true);
    paste([file(PNG)]);
    await settle();
    banco.editor.setReadOnly(false);
    // Nel campo del titolo un incolla resta del campo.
    const title = banco.host.querySelector<HTMLInputElement>(".draw-title-input")!;
    expect(paste([file(PNG)], title).defaultPrevented).toBe(false);
    // Un incolla di solo testo non è un'immagine.
    const words = new DataTransfer();
    words.setData("text/plain", "ciao");
    const plain = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: words });
    surface().dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    await settle();
    expect(banco.changes).toEqual([]);
  });

  it("un disegno al limite non riceve un'altra immagine", async () => {
    const full = doc(`<desc>${"a".repeat(20 * MIB - 1000)}</desc>${LAYER}</g>`);
    mount(full, { imageCodec: codec(10, 10) });
    paste([file(PNG)]);
    await settle();
    expect(spoken()).toBe("Il disegno è vicino al limite di 20 MiB: un’altra immagine non ci sta.");
    expect(banco.changes).toEqual([]);
  });

  describe("la descrizione, nel Completo", () => {
    const bar = (): HTMLElement => banco.host.querySelector<HTMLElement>(".draw-describe")!;
    const input = (): HTMLInputElement => bar().querySelector<HTMLInputElement>(".draw-describe-input")!;
    const label = (): string => bar().querySelector("label")!.textContent!;
    const act = (action: string): HTMLButtonElement => bar().querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
    const ids = (): string[] => [...banco.editor.engine.text.matchAll(/<image id="([^"]+)"/g)].map((found) => found[1]!);

    it("entrata un'immagine, la barra la chiede col fuoco nel campo; Invio la scrive in un passo suo", async () => {
      mount(SOURCE, { imageCodec: codec(200, 100) });
      size(1000, 500);
      expect(bar().hidden).toBe(true);
      paste([file(PNG)]);
      await settle();
      expect(bar().hidden).toBe(false);
      expect(label()).toBe("Descrivi l’immagine appena aggiunta");
      expect(document.activeElement).toBe(input());
      expect(input().placeholder).toBe("Che cosa mostra l’immagine?");
      expect(formatIssues(checkAccessibility(banco.host))).toBe("");
      // Nel campo le lettere si scrivono: non cambiano lo strumento.
      const tool = banco.editor.tool;
      expect(key("p", {}, input()).defaultPrevented).toBe(false);
      expect(banco.editor.tool).toBe(tool);
      const [id] = banco.editor.selection;
      input().value = "  Il molo   al tramonto ";
      key("Enter", {}, input());
      expect(banco.changes).toHaveLength(2);
      expect(banco.editor.engine.text).toContain("<title>Il molo al tramonto</title>");
      expect(spoken()).toBe("Descrizione scritta: «Il molo al tramonto».");
      expect(bar().hidden).toBe(true);
      expect(document.activeElement).toBe(surface());
      expect(banco.editor.selection).toEqual([id]);
      // Due passi: l'annulla toglie prima la descrizione, poi l'immagine.
      banco.editor.undo();
      expect(banco.editor.engine.text).not.toContain("<title>Il molo");
      expect(images()).toHaveLength(1);
      banco.editor.undo();
      expect(images()).toEqual([]);
    });

    it("più immagini, una alla volta e scelta; «Decorativa» e «Salta» passano alla prossima, e alla fine tornano scelte tutte", async () => {
      mount(SOURCE, { imageCodec: codec(100, 50) });
      size(1000, 500);
      paste([file(PNG), file(PNG, "due.png"), file(PNG, "tre.png")]);
      await settle();
      const [first, second, third] = ids();
      expect(label()).toBe("Descrivi l’immagine 1 delle 3 appena aggiunte");
      expect(banco.editor.selection).toEqual([first]);
      act("decorative").click();
      expect(banco.editor.engine.text).toMatch(new RegExp(`<image id="${first}"[^>]* aria-hidden="true"/>`));
      expect(label()).toBe("Descrivi l’immagine 2 delle 3 appena aggiunte");
      expect(banco.editor.selection).toEqual([second]);
      expect(document.activeElement).toBe(input());
      act("skip").click();
      expect(label()).toBe("Descrivi l’immagine 3 delle 3 appena aggiunte");
      expect(banco.editor.selection).toEqual([third]);
      input().value = "Barche";
      act("write").click();
      expect(bar().hidden).toBe(true);
      expect(banco.editor.selection).toEqual([first, second, third]);
      expect(document.activeElement).toBe(surface());
      // L'immagine, la decorativa e la descrizione: tre passi.
      expect(banco.changes).toHaveLength(3);
    });

    it("un campo vuoto non scrive niente e lo dice; Esc chiude, e la verifica elenca l'immagine", async () => {
      mount(SOURCE, { imageCodec: codec(100, 50) });
      size(1000, 500);
      paste([file(PNG)]);
      await settle();
      key("Enter", {}, input());
      expect(spoken()).toBe("Scrivi prima che cosa mostra l’immagine, oppure scegli «Decorativa» o «Salta».");
      expect(bar().hidden).toBe(false);
      expect(document.activeElement).toBe(input());
      key("Escape", {}, input());
      expect(bar().hidden).toBe(true);
      expect(document.activeElement).toBe(surface());
      expect(banco.changes).toHaveLength(1);
      banco.host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Accessibilità"]')!.click();
      expect([...banco.host.querySelectorAll(".draw-access-what")].map((what) => what.textContent)).toContain("Avviso: Un’immagine non ha una descrizione");
    });

    it("si chiude quando l'immagine se ne va, quando il disegno non si scrive più, e con un altro disegno", async () => {
      mount(SOURCE, { imageCodec: codec(100, 50) });
      size(1000, 500);
      paste([file(PNG)]);
      await settle();
      banco.editor.undo();
      expect(bar().hidden).toBe(true);
      expect(document.activeElement).toBe(surface());
      paste([file(PNG)]);
      await settle();
      banco.editor.setReadOnly(true);
      expect(bar().hidden).toBe(true);
      banco.editor.setReadOnly(false);
      paste([file(PNG)]);
      await settle();
      expect(bar().hidden).toBe(false);
      banco.editor.load(SceneEngine.open(SOURCE));
      expect(bar().hidden).toBe(true);
    });

    it("nel Semplice non c'è: l'immagine entra e il fuoco resta sul foglio", async () => {
      mount(SOURCE, { workspace: "simple", imageCodec: codec(100, 50) });
      size(1000, 500);
      surface().focus();
      paste([file(PNG)]);
      await settle();
      expect(bar().hidden).toBe(true);
      expect(document.activeElement).toBe(surface());
    });
  });
});

describe("le immagini del vault", () => {
  const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
  const HREF = "immagini/foto.png";

  /// Un codec che misura ogni immagine `width` × `height` pixel, o nessuna.
  function codec(width: number, height: number, readable = true): ImageCodec & { closed: number } {
    const fake = {
      closed: 0,
      async decode(): Promise<Decoded | null> {
        if (!readable) return null;
        return {
          width,
          height,
          opaque: () => true,
          encode: async () => null,
          close() {
            fake.closed++;
          },
        };
      },
    };
    return fake;
  }

  /// Chi monta l'editor: sceglie `choice`, e del vault legge `blob`.
  function vault(choice: string | null | Error, blob: Blob | null = PNG): DrawImages & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      async url(href) {
        calls.push(`url ${href}`);
        return `blob:vault/${href}`;
      },
      async read(href) {
        calls.push(`read ${href}`);
        return blob;
      },
      async choose() {
        calls.push("choose");
        if (choice instanceof Error) throw choice;
        return choice;
      },
    };
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const imageLine = (): string => banco.editor.engine.text.match(/<image [^>]*\/>/)?.[0] ?? "";
  const imageButton = (): HTMLButtonElement =>
    [...banco.host.querySelectorAll<HTMLButtonElement>(".draw-rail button")].find((control) => control.getAttribute("aria-label") === "Immagine dal vault…")!;
  const insertShown = (): boolean => imageButton().closest("[hidden]") === null;

  it("Ctrl+I mette l'immagine scelta per riferimento, dove è il cursore e con la sua misura, e il foglio la mostra", async () => {
    const images = vault(HREF);
    const fake = codec(200, 100);
    mount(SOURCE, { imageCodec: fake, images });
    size(1000, 500);
    banco.editor.setTool("pen");
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: 300, clientY: 300 }));
    expect(key("i", { ctrlKey: true }).defaultPrevented).toBe(true);
    await settle();
    const [id] = banco.editor.selection;
    expect(imageLine()).toBe(`<image id="${id}" x="200" y="250" width="200" height="100" href="${HREF}"/>`);
    expect(images.calls.slice(0, 2)).toEqual(["choose", `read ${HREF}`]);
    // I byte servono solo a misurarla: il decodificato si chiude.
    expect(fake.closed).toBe(1);
    expect(banco.editor.tool).toBe("select");
    expect(spoken()).toBe("Immagine aggiunta. Strumento: Selezione. Il disegno ha 2 oggetti.");
    // Il foglio chiede l'URL a chi monta l'editor.
    expect(images.calls).toContain(`url ${HREF}`);
    expect(surface().querySelector(`image[data-scene-id="${id}"]`)!.getAttribute("href")).toBe(`blob:vault/${HREF}`);
    // Un gesto solo, che annulla toglie intero.
    expect(banco.changes).toHaveLength(1);
    banco.editor.undo();
    expect(imageLine()).toBe("");
  });

  it("il pulsante «Immagine dal vault…» c'è nei due spazi, se chi monta l'editor sa scegliere", async () => {
    const images = vault(HREF);
    mount(SOURCE, { workspace: "simple", imageCodec: codec(20, 10), images });
    expect(insertShown()).toBe(true);
    banco.editor.setSpace("full");
    expect(insertShown()).toBe(true);
    const control = imageButton();
    expect(control.closest('[role="group"]')!.getAttribute("aria-label")).toBe("Inserisci");
    expect(control.title).toBe("Immagine dal vault… (Ctrl+I)");
    expect(control.getAttribute("aria-keyshortcuts")).toBe("Control+I");
    expect(control.getAttribute("aria-haspopup")).toBe("dialog");
    expect(formatIssues(checkAccessibility(banco.host))).toBe("");
    control.click();
    await settle();
    expect(imageLine()).toContain(`href="${HREF}"`);
    expect(banco.changes).toHaveLength(1);
    // Come ogni immagine che entra, chiede la sua descrizione.
    expect(banco.host.querySelector<HTMLElement>(".draw-describe")!.hidden).toBe(false);
    expect(document.activeElement).toBe(banco.host.querySelector(".draw-describe-input"));
    // In sola lettura il pulsante si spegne, e Ctrl+I non chiede niente.
    banco.editor.setReadOnly(true);
    expect(imageButton().disabled).toBe(true);
    key("i", { ctrlKey: true });
    await settle();
    expect(images.calls.filter((call) => call === "choose")).toHaveLength(1);
    banco.owner.close();
    banco.host.replaceChildren();
    banco.owner = openLifetime();
    // Chi non sa scegliere non ha il pulsante, né il tasto.
    mount(SOURCE, { imageCodec: codec(20, 10), images: { url: images.url, read: images.read } });
    expect(insertShown()).toBe(false);
    expect(key("i", { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it("«?» elenca Ctrl+I tra i tasti della modifica", () => {
    mount(SOURCE, { images: vault(HREF) });
    key("?", { shiftKey: true });
    const rows = [...dialog().querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]);
    expect(rows).toContainEqual(["Ctrl+I", "Immagine dal vault…"]);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });

  it("una scelta annullata o fallita non aggiunge niente; un'immagine sparita o illeggibile lo si dice", async () => {
    mount(SOURCE, { imageCodec: codec(20, 10), images: vault(null) });
    key("i", { ctrlKey: true });
    await settle();
    expect(spoken()).toBe("");
    banco.owner.close();
    banco.host.replaceChildren();
    banco.owner = openLifetime();
    // Chi sceglie dice da sé perché non ha potuto.
    mount(SOURCE, { imageCodec: codec(20, 10), images: vault(new Error("rotto")) });
    key("i", { ctrlKey: true });
    await settle();
    expect(spoken()).toBe("");
    banco.owner.close();
    banco.host.replaceChildren();
    banco.owner = openLifetime();
    mount(SOURCE, { imageCodec: codec(20, 10), images: vault(HREF, null) });
    key("i", { ctrlKey: true });
    await settle();
    expect(spoken()).toBe("L’immagine scelta non si apre: forse non è più nel vault.");
    banco.owner.close();
    banco.host.replaceChildren();
    banco.owner = openLifetime();
    mount(SOURCE, { imageCodec: codec(20, 10, false), images: vault(HREF) });
    key("i", { ctrlKey: true });
    await settle();
    expect(spoken()).toBe("Non è un’immagine che il disegno sa leggere.");
    expect(banco.changes).toEqual([]);
  });

  it("un documento che cambia mentre si sceglie non riceve l'immagine", async () => {
    let answer: (href: string | null) => void = () => {};
    let asked = 0;
    let read = 0;
    const images: DrawImages = {
      url: async () => null,
      read: async () => {
        read++;
        return PNG;
      },
      choose: () => {
        asked++;
        return new Promise((resolve) => (answer = resolve));
      },
    };
    mount(SOURCE, { imageCodec: codec(20, 10), images });
    key("i", { ctrlKey: true });
    await settle();
    // Un secondo Ctrl+I, mentre la scelta è aperta, non ne apre un'altra.
    key("i", { ctrlKey: true });
    expect(asked).toBe(1);
    banco.editor.load(SceneEngine.open(SOURCE));
    answer(HREF);
    await settle();
    // L'immagine non si legge nemmeno.
    expect(read).toBe(0);
    expect(imageLine()).toBe("");
    expect(banco.changes).toEqual([]);
  });
});
