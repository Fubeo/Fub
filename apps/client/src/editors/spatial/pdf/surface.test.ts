// @vitest-environment happy-dom
// La superficie delle annotazioni: il PDF sotto, una pagina alla volta, il
// legame con la versione del PDF scritto dal primo gesto, gli avvisi quando
// il PDF è cambiato o non c'è, e la Lettura con l'elenco.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorSurface } from "../../core/registry";
import type { EditorChange } from "../../core/text-operation";
import type { PdfEngine, PdfEngineLoader } from "../../media/pdf-view";
import type { ResourceTransport } from "../../media/resource-port";
import { PDF_MODES } from "../modes";
import { mountPdfSurface, type PdfPorts } from "./surface";

const bando = Object.values(
  import.meta.glob("../../../__fixtures__/annotations/bando.fubann", { query: "?raw", import: "default", eager: true }) as Record<string, string>,
)[0]!;

/// `sha256("test")`, l'impronta che `bando.fubann` porta.
const TEST_DIGEST = "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

const NEW = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" fub:annotates="Bando.pdf">\n  <title>Bando.pdf</title>\n</svg>\n';

const MOUSE = { pointerId: 1, pointerType: "mouse" } as const;

/// Il vault: i byte dei PDF per id.
function transportOf(files: Record<string, string>): ResourceTransport {
  const open = new Map<string, Uint8Array>();
  return {
    open: async (id) => {
      const text = files[id];
      if (text === undefined) throw { kind: "not_found", message: `«${id}» non c'è` };
      const bytes = new TextEncoder().encode(text);
      const handle = `h${open.size + 1}`;
      open.set(handle, bytes);
      return { handle, id, len: bytes.byteLength, mime: "application/pdf", kind: "pdf", revision: null } as never;
    },
    read_chunk: async (handle, offset, len) => {
      const bytes = open.get(handle)!.slice(offset, offset + len);
      return bytes.buffer;
    },
    close: async (handle) => {
      open.delete(handle);
    },
  };
}

/// pdf.js finto: tante pagine, tutte di 600 × 800 punti.
function loaderOf(pageCount: number, shown: number[] = []): PdfEngineLoader {
  return async () =>
    ({
      pageCount,
      search: async () => [],
      renderPage: async () => {},
      pageSize: async () => [600, 800],
      renderArea: async (index: number) => {
        shown.push(index);
        return true;
      },
      destroy: () => {},
    }) satisfies PdfEngine;
}

let parent: HTMLElement;
let mounted: EditorSurface[];

interface Mounted {
  readonly surface: EditorSurface;
  readonly changes: EditorChange[];
}

function mount(text: string, documentId: string, pdf?: PdfPorts): Mounted {
  const changes: EditorChange[] = [];
  const surface = mountPdfSurface({ paneId: "p1", documentId, parent }, { onChange: (change) => changes.push(change), onSelectionChange: () => {}, pdf });
  surface.buffer!.setDoc(text);
  mounted.push(surface);
  return { surface, changes };
}

const sheet = (): HTMLElement => parent.querySelector<HTMLElement>(".draw-surface")!;
const field = (): HTMLInputElement => parent.querySelector<HTMLInputElement>(".pdf-page-input")!;
const notices = (): string[] =>
  parent.querySelector<HTMLElement>(".vector-notice")!.hidden ? [] : [...parent.querySelectorAll(".pdf-notice-messages p")].map((p) => p.textContent ?? "");
const confirmButton = (): HTMLButtonElement =>
  [...parent.querySelectorAll<HTMLButtonElement>(".vector-notice-action")].find((button) => button.textContent === "Conferma questa versione")!;

/// Aspetta il PDF letto e la sua pagina disegnata, con `count` pagine.
async function loaded(count: string): Promise<void> {
  await vi.waitFor(() => expect(parent.querySelector(".pdf-canvas")).not.toBeNull());
  expect(parent.querySelector(".pdf-page-count")!.textContent).toBe(count);
}

let clock = 100;

function drag(points: readonly (readonly [number, number])[]): void {
  const target = sheet();
  const event = (type: string, [x, y]: readonly [number, number], buttons: number): PointerEvent => {
    const e = new PointerEvent(type, { ...MOUSE, bubbles: true, cancelable: true, isPrimary: true, button: type === "pointermove" ? -1 : 0, buttons, pressure: buttons ? 0.5 : 0, clientX: x, clientY: y });
    Object.defineProperty(e, "timeStamp", { value: (clock += 8) });
    return e;
  };
  target.dispatchEvent(event("pointerdown", points[0]!, 1));
  for (const point of points.slice(1)) target.dispatchEvent(event("pointermove", point, 1));
  target.dispatchEvent(event("pointerup", points[points.length - 1]!, 0));
}

function key(key: string, init: KeyboardEventInit = {}, target: HTMLElement = sheet()): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
}

beforeEach(() => {
  parent = document.createElement("div");
  document.body.append(parent);
  mounted = [];
});

afterEach(() => {
  for (const surface of mounted) surface.destroy();
  parent.remove();
  for (const dialog of document.querySelectorAll(".shell-dialog")) dialog.remove();
  vi.restoreAllMocks();
});

describe("la superficie", () => {
  it("dichiara Annota e Lettura, con gli id del disegno", () => {
    const { surface } = mount(NEW, "Bando.pdf.fubann");
    expect([surface.family, surface.profile, surface.defaultMode]).toEqual(["canvas", "pdf", "draw"]);
    expect(PDF_MODES.map((mode) => [mode.id, mode.presentation, mode.contextMode, mode.label()])).toEqual([
      ["draw", "surface", "live_preview", "Annota"],
      ["read", "rendered", "reading", "Lettura"],
    ]);
    expect(() => surface.setMode!("source")).toThrow(RangeError);
  });

  it("legge il PDF accanto e mostra la sua prima pagina, con la barra delle pagine", async () => {
    const shown: number[] = [];
    mount(NEW, "bandi/Bando.pdf.fubann", { transport: transportOf({ "bandi/Bando.pdf": "test" }), loader: loaderOf(3, shown) });
    await loaded("di 3");
    expect(field().value).toBe("1");
    expect(field().getAttribute("aria-label")).toBe("Pagina");
    expect(parent.querySelector(".pdf-pages")!.getAttribute("aria-label")).toBe("Pagine");
    expect(parent.querySelector<HTMLButtonElement>(".pdf-page-previous")!.disabled).toBe(true);
    expect(parent.querySelector<HTMLButtonElement>(".pdf-page-next")!.getAttribute("aria-label")).toBe("Pagina successiva");
    expect(sheet().getAttribute("aria-label")).toBe("Annotazioni di «Bando.pdf», pagina 1 di 3");
    expect(parent.querySelector(".draw-page .pdf-background")).not.toBeNull();
    await vi.waitFor(() => expect(shown).toContain(0));
    expect(notices()).toEqual([]);
    // L'evidenziatore è lo strumento di partenza, con le note e la copertura.
    const tools = [...parent.querySelectorAll<HTMLButtonElement>(".draw-tool")].map((button) => button.dataset.tool);
    expect(tools).toEqual(["select", "pen", "highlighter", "eraser", "note", "rect", "ellipse", "line", "arrow", "cover"]);
    expect(parent.querySelector('.draw-tool[aria-checked="true"]')!.getAttribute("data-tool")).toBe("highlighter");
  });

  it("aprire non scrive niente", async () => {
    const { changes } = mount(NEW, "Bando.pdf.fubann", { transport: transportOf({ "Bando.pdf": "test" }), loader: loaderOf(3) });
    await loaded("di 3");
    expect(changes).toEqual([]);
  });
});

describe("il primo gesto", () => {
  it("fa nascere il gruppo della pagina e scrive il legame col PDF, in un passo solo", async () => {
    const { surface, changes } = mount(NEW, "Bando.pdf.fubann", { transport: transportOf({ "Bando.pdf": "test" }), loader: loaderOf(3) });
    await loaded("di 3");
    key("PageDown");
    await vi.waitFor(() => expect(field().value).toBe("2"));
    expect(sheet().getAttribute("aria-label")).toBe("Annotazioni di «Bando.pdf», pagina 2 di 3");
    drag([[10, 10], [60, 10], [110, 12]]);
    expect(changes).toHaveLength(1);
    const text = surface.buffer!.getDoc();
    expect(text).toContain(`fub:digest="${TEST_DIGEST}" fub:pages="3"`);
    expect(text).toMatch(/<g id="p0002" fub:page="2" fub:page-size="600 800">\n {4}<path id="o[a-z0-9]{8}" fub:tool="highlighter" fub:at="[^"]+" fub:brush="pf1 size=16 thinning=0 [^"]*" d="[^"]+" fill="#f0e442" fill-opacity="0.4"/);
    // Annullare toglie tutto il passo: il gruppo e il legame.
    key("z", { ctrlKey: true });
    expect(surface.buffer!.getDoc()).toBe(NEW);
  });

  it("su un'altra pagina finisce nel suo gruppo, e la pagina di prima non si vede", async () => {
    const { surface } = mount(NEW, "Bando.pdf.fubann", { transport: transportOf({ "Bando.pdf": "test" }), loader: loaderOf(3) });
    await loaded("di 3");
    drag([[10, 10], [60, 10], [110, 12]]);
    key("PageDown");
    await vi.waitFor(() => expect(field().value).toBe("2"));
    expect(parent.querySelectorAll(".painter-root path, svg path[fub\\:tool]").length).toBe(0);
    drag([[10, 30], [60, 30], [110, 32]]);
    const text = surface.buffer!.getDoc();
    expect(text.indexOf('<g id="p0001"')).toBeLessThan(text.indexOf('<g id="p0002"'));
    expect(text.match(/fub:digest=/g)).toHaveLength(1);
  });

  it("scrive solo la parte del legame che manca", async () => {
    const half = NEW.replace('fub:annotates="Bando.pdf"', 'fub:annotates="Bando.pdf" fub:pages="3"');
    const { surface } = mount(half, "Bando.pdf.fubann", { transport: transportOf({ "Bando.pdf": "test" }), loader: loaderOf(3) });
    await loaded("di 3");
    expect(notices()).toEqual([]);
    drag([[10, 10], [60, 10], [110, 12]]);
    expect(surface.buffer!.getDoc()).toContain(`fub:annotates="Bando.pdf" fub:pages="3" fub:digest="${TEST_DIGEST}">`);
  });
});

describe("il PDF cambiato", () => {
  it("lo dice, non scrive il legame da sé, e «Conferma questa versione» lo scrive in un passo", async () => {
    const { surface, changes } = mount(bando, "bandi/Bando di gara.pdf.fubann", {
      transport: transportOf({ "bandi/Bando di gara.pdf": "un altro PDF" }),
      loader: loaderOf(10),
    });
    await vi.waitFor(() => expect(notices()).toHaveLength(1));
    expect(notices()[0]).toBe(
      "Il PDF è cambiato da quando è stato annotato: le annotazioni restano dove sono, controlla che corrispondano ancora. Aveva 12 pagine, ora 10.",
    );
    expect(confirmButton().hidden).toBe(false);
    // Le pagine sono quelle del PDF di adesso; le annotazioni restano.
    expect(parent.querySelector(".pdf-page-count")!.textContent).toBe("di 10");
    drag([[10, 10], [60, 10], [110, 12]]);
    expect(changes).toHaveLength(1);
    expect(surface.buffer!.getDoc()).toContain(`fub:digest="${TEST_DIGEST}" fub:pages="12"`);
    confirmButton().click();
    expect(changes).toHaveLength(2);
    const text = surface.buffer!.getDoc();
    expect(text).not.toContain(TEST_DIGEST);
    expect(text).toMatch(/fub:digest="sha256:[0-9a-f]{64}" fub:pages="10"/);
    expect(notices()).toEqual([]);
    expect(parent.querySelector(".pdf-surface > .sr-only")!.textContent!.trim()).toBe("Le annotazioni ora valgono per questa versione del PDF.");
    key("z", { ctrlKey: true });
    expect(surface.buffer!.getDoc()).toContain(TEST_DIGEST);
  });

  it("la stessa versione non dice niente", async () => {
    const { surface } = mount(bando, "bandi/Bando di gara.pdf.fubann", {
      transport: transportOf({ "bandi/Bando di gara.pdf": "test" }),
      loader: loaderOf(12),
    });
    await loaded("di 12");
    expect(notices()).toEqual([]);
    expect(confirmButton().hidden).toBe(true);
    expect(surface.buffer!.getDoc()).toBe(bando);
  });
});

describe("senza il PDF", () => {
  it("un PDF che non c'è: pagine bianche della misura scritta, e si annota senza legame", async () => {
    const { surface } = mount(bando, "bandi/Bando di gara.pdf.fubann", { transport: transportOf({}), loader: loaderOf(3) });
    await vi.waitFor(() => expect(notices()).toEqual(["Il PDF «Bando di gara.pdf» non c’è: le annotazioni si vedono su pagine bianche."]));
    // Senza PDF le pagine sono quelle che il file dice.
    expect(parent.querySelector(".pdf-page-count")!.textContent).toBe("di 12");
    drag([[10, 10], [60, 10], [110, 12]]);
    expect(surface.buffer!.getDoc()).toContain(`fub:digest="${TEST_DIGEST}" fub:pages="12"`);
  });

  it("senza pdf.js lo dice, e un file che non nomina un PDF anche", async () => {
    mount(NEW, "Bando.pdf.fubann", { transport: transportOf({ "Bando.pdf": "test" }) });
    await vi.waitFor(() => expect(notices()).toEqual(["Il PDF «Bando.pdf» non si legge (Motore PDF non caricato.): le annotazioni si vedono su pagine bianche."]));
    mounted.pop()!.destroy();
    mount(NEW.replace(' fub:annotates="Bando.pdf"', ' fub:annotates="https://example.org/a.pdf"'), "Bando.pdf.fubann");
    expect(notices()).toEqual(["Queste annotazioni non nominano un PDF del vault: si vedono su pagine bianche."]);
  });

  it("ciò che sta fuori dalle pagine si conta", () => {
    mount(NEW.replace("</svg>", '  <rect x="0" y="0" width="1" height="1"/>\n</svg>'), "x.fubann");
    expect(notices()).toContain("1 elemento sta fuori dalle pagine: qui non si vede, nella sorgente sì.");
  });
});

describe("le pagine", () => {
  it("il numero scritto porta alla pagina, e i suoi tasti non sono comandi dell'editor", async () => {
    mount(NEW, "Bando.pdf.fubann", { transport: transportOf({ "Bando.pdf": "test" }), loader: loaderOf(3) });
    await loaded("di 3");
    const zoom = parent.querySelector(".draw-zoom-level")!.textContent;
    field().focus();
    field().value = "3";
    key("0", {}, field());
    expect(parent.querySelector(".draw-zoom-level")!.textContent).toBe(zoom);
    key("Enter", {}, field());
    await vi.waitFor(() => expect(sheet().getAttribute("aria-label")).toBe("Annotazioni di «Bando.pdf», pagina 3 di 3"));
    expect(parent.querySelector<HTMLButtonElement>(".pdf-page-next")!.disabled).toBe(true);
    field().value = "abc";
    field().dispatchEvent(new Event("change"));
    expect(field().value).toBe("3");
  });
});

describe("le note", () => {
  it("Invio con lo strumento Nota la chiede in un dialogo e la mette al centro della vista, dentro la pagina", async () => {
    const { surface } = mount(NEW, "Bando.pdf.fubann", { transport: transportOf({ "Bando.pdf": "test" }), loader: loaderOf(3) });
    await loaded("di 3");
    key("n");
    key("Enter");
    const dialog = document.querySelector<HTMLElement>(".shell-dialog")!;
    dialog.querySelector("textarea")!.value = "Chiedere all'ufficio gare.";
    dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await vi.waitFor(() => expect(surface.buffer!.getDoc()).toContain('fub:note="Chiedere all\'ufficio gare."'));
    // La vista di prova è vuota: il suo centro sta nell'angolo, e la nota
    // comincia dentro la pagina, a mezza misura dai bordi.
    expect(surface.buffer!.getDoc()).toMatch(/<g id="p0001" fub:page="1" fub:page-size="600 800">\n {4}<text id="o[a-z0-9]{8}" x="48" y="60"/);
  });
});

describe("gli strumenti delle annotazioni", () => {
  it("la copertura è un rettangolo pieno del suo colore, e lo spessore non vale", async () => {
    const { surface } = mount(NEW, "Bando.pdf.fubann", { transport: transportOf({ "Bando.pdf": "test" }), loader: loaderOf(3) });
    await loaded("di 3");
    key("c");
    const widths = [...parent.querySelectorAll<HTMLButtonElement>(".draw-width")];
    expect(widths.every((button) => button.disabled)).toBe(true);
    expect(parent.querySelector('.draw-color[aria-checked="true"]')!.getAttribute("aria-label")).toBe("Nero");
    drag([[20, 20], [120, 40], [220, 60]]);
    expect(surface.buffer!.getDoc()).toMatch(/<rect id="o[a-z0-9]{8}" x="20" y="20" width="200" height="40" fill="#000000"\/>/);
    // Ogni famiglia ricorda il suo colore: l'evidenziatore resta giallo.
    key("h");
    expect(parent.querySelector('.draw-color[aria-checked="true"]')!.getAttribute("aria-label")).toBe("Giallo");
    expect(widths.some((button) => !button.disabled)).toBe(true);
  });

  it("Invio su una nota scelta la cambia, e l'etichetta che segue il corpo continua a seguirlo", async () => {
    const { surface } = mount(bando, "bandi/Bando di gara.pdf.fubann", {
      transport: transportOf({ "bandi/Bando di gara.pdf": "test" }),
      loader: loaderOf(12),
    });
    await loaded("di 12");
    key("v");
    const start = new TextEncoder().encode(bando.slice(0, bando.indexOf('<text id="o4d5e6f7g"'))).byteLength;
    expect(surface.reveal!({ span: { start, end: start + 1 } } as never)).toBe(true);
    await vi.waitFor(() => expect(surface.selectedText!()?.primary).toMatch(/^<text id="o4d5e6f7g"/));
    key("Enter");
    const dialog = document.querySelector<HTMLElement>(".shell-dialog")!;
    expect(dialog.querySelector("h2")!.textContent).toBe("Modifica la nota");
    const body = dialog.querySelector("textarea")!;
    expect(body.value).toBe("Manca la firma del RUP: vedi l'allegato B.");
    expect(dialog.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe("");
    body.value = "Firma arrivata.";
    dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await vi.waitFor(() => expect(surface.buffer!.getDoc()).toContain('fub:note="Firma arrivata."'));
    expect(surface.buffer!.getDoc()).toMatch(/<text id="o4d5e6f7g" [^>]*fub:note="Firma arrivata\.">\n\s*<tspan[^>]*>Firma arrivata\.<\/tspan>/);
  });
});

describe("la Lettura", () => {
  it("elenca le note pagina per pagina, porta alla pagina, e non si scrive", async () => {
    const { surface, changes } = mount(bando, "bandi/Bando di gara.pdf.fubann", {
      transport: transportOf({ "bandi/Bando di gara.pdf": "test" }),
      loader: loaderOf(12),
    });
    await loaded("di 12");
    const list = parent.querySelector<HTMLElement>(".pdf-list")!;
    expect(list.hidden).toBe(true);
    surface.setMode!("read");
    expect(parent.querySelector(".pdf-surface")!.getAttribute("data-mode")).toBe("read");
    expect(list.hidden).toBe(false);
    expect(list.querySelector("h2")!.textContent).toBe("Annotazioni");
    const pages = [...list.querySelectorAll<HTMLButtonElement>(".pdf-list-page")];
    expect(pages.map((button) => button.textContent)).toEqual(["Pagina 1", "Pagina 3"]);
    expect(pages[0]!.getAttribute("aria-current")).toBe("page");
    expect([...list.querySelectorAll(".pdf-list-note strong")].map((label) => label.textContent)).toEqual([
      "Importo da rivedere",
      "Manca la firma del RUP: vedi l'allegato B.",
    ]);
    expect([...list.querySelectorAll(".pdf-list-marks")].map((marks) => marks.textContent)).toEqual(["1 altro segno", "1 altro segno"]);
    pages[1]!.click();
    await vi.waitFor(() => expect(pages[1]!.getAttribute("aria-current")).toBe("page"));
    expect(field().value).toBe("3");
    drag([[10, 10], [60, 10], [110, 12]]);
    expect(changes).toEqual([]);
    expect(surface.selections!()).toBeUndefined();
  });
});

describe("i rimandi", () => {
  it("portano alla pagina dell'oggetto e lo scelgono", async () => {
    const { surface } = mount(bando, "bandi/Bando di gara.pdf.fubann", {
      transport: transportOf({ "bandi/Bando di gara.pdf": "test" }),
      loader: loaderOf(12),
    });
    await loaded("di 12");
    const start = new TextEncoder().encode(bando.slice(0, bando.indexOf('<rect id="o1a2b3c4d"'))).byteLength;
    expect(surface.reveal!({ span: { start, end: start + 1 } } as never)).toBe(true);
    await vi.waitFor(() => expect(field().value).toBe("3"));
    await vi.waitFor(() => expect(surface.selectedText!()?.primary).toMatch(/^<rect id="o1a2b3c4d"/));
    const outside = new TextEncoder().encode(bando.slice(0, bando.indexOf("<title>"))).byteLength;
    expect(surface.reveal!({ span: { start: outside, end: outside + 1 } } as never)).toBe(false);
  });
});
