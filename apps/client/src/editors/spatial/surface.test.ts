// @vitest-environment happy-dom
// La superficie del disegno nella shell: le modalità, il buffer allineato alla
// sessione, i documenti che non si modificano e le selezioni in byte del file.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../../host/contract";
import { createFakeHost, type FakeHost } from "../../host/fake";
import type { EditorSurface } from "../core/registry";
import type { EditorChange } from "../core/text-operation";
import { doc, HEAD } from "./scene/test-support";
import { VECTOR_MODES } from "./modes";
import { clearHistory, recentNotices } from "../../ui/notify";
import { imageInfo, svgSize } from "../media/image-view";
import { IMAGE_PLACEHOLDER } from "./painter/paint";
import { READ_IMAGE_BYTES } from "./read-images";
import { linkHref, mountVectorSurface, type VectorImages, type VectorSurfaceOptions } from "./surface";
import { LAYER } from "./tools/test-support";

// Il livello e la griglia la superficie li chiede all'host: qui risponde il
// finto, che non dichiara il livello finché un caso non glielo dà.
const box = vi.hoisted(() => ({ host: null as FakeHost | null }));

vi.mock("../../host/ipc", () => {
  const now = () => {
    if (!box.host) throw new Error("l'host finto non è stato montato");
    return box.host.module;
  };
  return {
    api: new Proxy(
      {},
      {
        get: (_t, name: string) => (...args: unknown[]) =>
          (now().api as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args),
      },
    ),
    onKernelEvent: (handler: (n: unknown) => void) => now().onKernelEvent(handler as never),
  };
});

const SOURCE = doc(
  `<title>Casa</title>${LAYER}<rect id="o1a2b3c4d" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/></g>`,
);
const FOREIGN = SOURCE.replace(' fub:version="1"', "");
const DOCTYPE = `<!DOCTYPE svg>${SOURCE}`;

const MOUSE = { pointerId: 1, pointerType: "mouse" } as const;

let parent: HTMLElement;
let mounted: { surface: EditorSurface; changes: EditorChange[]; selections: { count: number }; parent: HTMLElement }[];

function mount(
  text: string | null = SOURCE,
  at: HTMLElement = parent,
  shell: Pick<VectorSurfaceOptions, "onOpenPath" | "onPickLink" | "images" | "fonts"> = {},
): { surface: EditorSurface; changes: EditorChange[]; selections: { count: number } } {
  const changes: EditorChange[] = [];
  const selections = { count: 0 };
  const surface = mountVectorSurface(
    { paneId: `p${mounted.length + 1}`, documentId: "disegni/casa.svg", parent: at },
    { onChange: (change) => changes.push(change), onSelectionChange: () => selections.count++, ...shell },
  );
  if (text !== null) surface.buffer!.setDoc(text);
  const entry = { surface, changes, selections, parent: at };
  mounted.push(entry);
  return entry;
}

function pointer(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, isPrimary: true, ...init });
}

let clock = 100;

/// Un rettangolo disegnato col mouse sul foglio di `at`.
function drawRect(at: HTMLElement = parent): void {
  at.querySelector<HTMLButtonElement>('.draw-tool[data-tool="rect"]')!.click();
  const sheet = at.querySelector<HTMLElement>(".draw-surface")!;
  const event = (type: string, x: number, y: number, buttons: number): PointerEvent => {
    const e = pointer(type, { ...MOUSE, button: type === "pointermove" ? -1 : 0, buttons, pressure: buttons ? 0.5 : 0, clientX: x, clientY: y });
    Object.defineProperty(e, "timeStamp", { value: (clock += 8) });
    return e;
  };
  sheet.dispatchEvent(event("pointerdown", 10, 10, 1));
  sheet.dispatchEvent(event("pointermove", 30, 25, 1));
  sheet.dispatchEvent(event("pointerup", 30, 25, 0));
}

function key(at: HTMLElement, init: KeyboardEventInit): void {
  at.querySelector<HTMLElement>(".draw-surface")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

const undo = (at: HTMLElement = parent): void => key(at, { key: "z", ctrlKey: true });

const shown = (at: HTMLElement = parent): { notice: string | null; adopt: boolean; draw: boolean; read: boolean } => {
  const notice = at.querySelector<HTMLElement>(".vector-notice")!;
  return {
    notice: notice.hidden ? null : notice.querySelector(".vector-notice-text")!.textContent,
    adopt: !at.querySelector<HTMLElement>(".vector-notice-action")!.hidden,
    draw: !at.querySelector<HTMLElement>(".vector-draw")!.hidden,
    read: !at.querySelector<HTMLElement>(".vector-read")!.hidden,
  };
};

/// Le righe di `text` coi loro terminatori.
const lines = (text: string): string[] => text.split(/(?<=\n)/);

beforeEach(() => {
  box.host = createFakeHost();
  parent = document.createElement("div");
  document.body.append(parent);
  mounted = [];
});

afterEach(() => {
  for (const { surface } of mounted) surface.destroy();
  parent.remove();
  vi.restoreAllMocks();
});

describe("la superficie", () => {
  it("dichiara Disegno e Lettura, proiettate su live_preview e reading", () => {
    const { surface } = mount();
    expect(surface.family).toBe("canvas");
    expect(surface.profile).toBe("vector");
    expect(surface.defaultMode).toBe("draw");
    expect(VECTOR_MODES.map((mode) => [mode.id, mode.presentation, mode.contextMode, mode.label()])).toEqual([
      ["draw", "surface", "live_preview", "Disegno"],
      ["read", "rendered", "reading", "Lettura"],
    ]);
    expect(() => surface.setMode!("source")).toThrow(RangeError);
  });

  it("monta l'editor su un disegno di FubDraw, senza avvisi", () => {
    mount();
    expect(shown()).toEqual({ notice: null, adopt: false, draw: true, read: false });
    expect(parent.querySelector(".vector-surface")!.getAttribute("data-mode")).toBe("draw");
    expect(parent.querySelector(".draw-editor")).not.toBeNull();
  });

  it("un gesto esce come testo, operazione e origine, e il buffer lo tiene", () => {
    const { surface, changes } = mount();
    drawRect();
    expect(changes).toHaveLength(1);
    const [change] = changes;
    expect(change!.origin).toBe("input");
    expect(change!.text).not.toBe(SOURCE);
    expect(change!.operation.edits.length).toBeGreaterThan(0);
    expect(surface.buffer!.getDoc()).toBe(change!.text);
  });

  it("un file con CRLF, anche misti a LF, conserva i terminatori delle righe non toccate", () => {
    const original =
      `${HEAD}\r\n  <title>Casa</title>\r\n  ${LAYER}\n    <rect id="o1a2b3c4d" x="60" y="60" width="20" height="20"/>\r\n  </g>\r\n</svg>\r\n`;
    const { surface, changes } = mount(original);
    drawRect();
    expect(changes).toHaveLength(1);
    const after = lines(surface.buffer!.getDoc());
    // Le righe di prima ci sono tutte, uguali e nello stesso ordine: il
    // gesto ha soltanto aggiunto.
    const before = lines(original);
    let at = 0;
    for (const line of after) if (line === before[at]) at++;
    expect(at).toBe(before.length);
    expect(after.length).toBeGreaterThan(before.length);
  });

  it("un testo da fuori ricostruisce la scena e lascia la cronologia", () => {
    const { surface, changes } = mount();
    drawRect();
    const mine = surface.buffer!.getDoc();
    // Un'altra superficie aggiunge un'ellisse dopo il rettangolo.
    const theirs = mine.replace("</g>", '<ellipse id="o9e9e9e9e" cx="20" cy="80" rx="5" ry="5"/></g>');
    surface.buffer!.syncDoc({ text: theirs, operation: null });
    expect(surface.buffer!.getDoc()).toBe(theirs);
    undo();
    expect(changes).toHaveLength(2);
    expect(changes[1]!.origin).toBe("undo");
    // Esce il rettangolo, resta l'ellisse dell'altra.
    expect(surface.buffer!.getDoc()).toBe(SOURCE.replace("</g>", '<ellipse id="o9e9e9e9e" cx="20" cy="80" rx="5" ry="5"/></g>'));
  });

  it("lo stesso testo da fuori non ricostruisce niente", () => {
    const { surface } = mount();
    const editor = parent.querySelector(".draw-editor");
    surface.buffer!.syncDoc(SOURCE);
    expect(parent.querySelector(".draw-editor")).toBe(editor);
  });

  it("un altro documento azzera la cronologia", () => {
    const { surface, changes } = mount();
    drawRect();
    surface.buffer!.setDoc(SOURCE.replace("Casa", "Albero"));
    undo();
    expect(changes).toHaveLength(1);
    expect(surface.buffer!.getDoc()).toContain("Albero");
  });
});

describe("due superfici sullo stesso documento", () => {
  it("si allineano, e ciascuna annulla soltanto i suoi gesti", () => {
    const second = document.createElement("div");
    document.body.append(second);
    const a = mount(SOURCE);
    const b = mount(SOURCE, second);
    // La sessione porta il gesto di una all'altra.
    drawRect(parent);
    b.surface.buffer!.syncDoc({ text: a.changes[0]!.text, operation: a.changes[0]!.operation });
    expect(b.surface.buffer!.getDoc()).toBe(a.surface.buffer!.getDoc());
    // L'altra non ha niente da annullare.
    undo(second);
    expect(b.changes).toEqual([]);
    undo(parent);
    expect(a.changes).toHaveLength(2);
    b.surface.buffer!.syncDoc({ text: a.changes[1]!.text, operation: a.changes[1]!.operation });
    expect(b.surface.buffer!.getDoc()).toBe(SOURCE);
    second.remove();
  });
});

describe("un documento che non si modifica subito", () => {
  it("un SVG estraneo è l'immagine del documento intero, e «Modifica» lo adotta", () => {
    const { surface, changes } = mount(FOREIGN);
    expect(shown()).toEqual({
      notice: "Questo SVG non è stato fatto con FubDraw: si guarda, e si disegna dopo «Modifica». Il file riceve due attributi sulla radice; il resto resta com’è.",
      adopt: true,
      draw: false,
      read: true,
    });
    expect(parent.querySelector<HTMLImageElement>(".vector-read img")!.src).toMatch(/^blob:/);
    surface.focus!();
    expect(document.activeElement).toBe(parent.querySelector(".vector-notice-action"));
    parent.querySelector<HTMLButtonElement>(".vector-notice-action")!.click();
    expect(changes).toHaveLength(1);
    expect(surface.buffer!.getDoc()).toContain('fub:version="1"');
    expect(shown()).toEqual({ notice: null, adopt: false, draw: true, read: false });
    expect(document.activeElement).toBe(parent.querySelector(".draw-surface"));
  });

  it("l'adozione si annulla, e si torna all'immagine col fuoco su «Modifica»", () => {
    const { surface, changes } = mount(FOREIGN);
    parent.querySelector<HTMLButtonElement>(".vector-notice-action")!.click();
    undo();
    expect(changes.map((change) => change.origin)).toEqual(["input", "undo"]);
    expect(surface.buffer!.getDoc()).toBe(FOREIGN);
    expect(shown()).toMatchObject({ adopt: true, draw: false, read: true });
    expect(document.activeElement).toBe(parent.querySelector(".vector-notice-action"));
  });

  it("senza scrittura «Modifica» non c'è", () => {
    const { surface } = mount(FOREIGN);
    surface.setReadOnly!(true);
    expect(shown().adopt).toBe(false);
    surface.setReadOnly!(false);
    expect(shown().adopt).toBe(true);
  });

  it("un documento in sola lettura è l'immagine del documento intero, col motivo", () => {
    mount(DOCTYPE);
    expect(shown()).toEqual({
      notice: "Questo disegno si apre solo da guardare: il file ha una dichiarazione DOCTYPE. Il testo si cambia con «Apri come sorgente».",
      adopt: false,
      draw: false,
      read: true,
    });
    expect(parent.querySelector(".draw-editor")).toBeNull();
    const image = parent.querySelector<HTMLImageElement>(".vector-read img")!;
    expect(image.src).toMatch(/^blob:/);
    expect(image.alt).toBe("Il disegno «Casa»");
  });

  it("i limiti si dicono coi numeri", async () => {
    const { MAX_ELEMENTS } = await import("./scene/read");
    const many = doc(`${LAYER}${"<rect/>".repeat(MAX_ELEMENTS + 1)}</g>`);
    mount(many);
    expect(shown().notice).toBe(
      `Questo disegno si apre solo da guardare: il file ha più dei ${new Intl.NumberFormat("it").format(MAX_ELEMENTS)} elementi che l’editor apre. Il testo si cambia con «Apri come sorgente».`,
    );
  });

  it("un file che non è una scena dice perché, e nient'altro", () => {
    const { surface } = mount("<svg><g></svg>");
    expect(shown()).toMatchObject({ draw: false, read: false, adopt: false });
    expect(shown().notice).toMatch(/^Questo file non si legge come disegno: il testo non è XML ben formato, al byte \d+\. «Apri come sorgente» ne mostra il testo, per correggerlo\.$/);
    surface.buffer!.setDoc("<html/>");
    expect(shown().notice).toBe(
      "Questo file non si legge come disegno: la radice non è un elemento svg. «Apri come sorgente» ne mostra il testo, per correggerlo.",
    );
    // Un testo che torna a essere una scena rimonta l'editor.
    surface.buffer!.syncDoc(SOURCE);
    expect(shown()).toEqual({ notice: null, adopt: false, draw: true, read: false });
  });
});

describe("la Lettura", () => {
  it("mostra il documento intero come immagine, e torna al disegno", () => {
    const { surface } = mount();
    surface.setMode!("read");
    expect(parent.querySelector(".vector-surface")!.getAttribute("data-mode")).toBe("read");
    expect(shown()).toEqual({ notice: null, adopt: false, draw: false, read: true });
    expect(parent.querySelector(".vector-read img")!.getAttribute("src")).toMatch(/^blob:/);
    surface.setMode!("draw");
    expect(shown()).toEqual({ notice: null, adopt: false, draw: true, read: false });
  });

  it("anche di un SVG estraneo, senza avviso", () => {
    const { surface } = mount(FOREIGN);
    surface.setMode!("read");
    expect(shown()).toEqual({ notice: null, adopt: false, draw: false, read: true });
  });

  it("ridisegna l'immagine solo quando il testo cambia, e libera quella di prima", () => {
    const created = vi.spyOn(URL, "createObjectURL");
    const revoked = vi.spyOn(URL, "revokeObjectURL");
    const { surface } = mount();
    surface.setMode!("read");
    surface.setMode!("draw");
    surface.setMode!("read");
    expect(created).toHaveBeenCalledTimes(1);
    const first = created.mock.results[0]!.value as string;
    surface.buffer!.syncDoc(SOURCE.replace("Casa", "Albero"));
    expect(created).toHaveBeenCalledTimes(2);
    expect(revoked).toHaveBeenCalledWith(first);
    expect(parent.querySelector<HTMLImageElement>(".vector-read img")!.alt).toBe("Il disegno «Albero»");
  });

  it("senza titolo, l'immagine si chiama col nome del file", () => {
    const { surface } = mount(SOURCE.replace("<title>Casa</title>", ""));
    surface.setMode!("read");
    expect(parent.querySelector<HTMLImageElement>(".vector-read img")!.alt).toBe("Il disegno «casa.svg»");
  });

  it("dice a parole che cosa c'è: la descrizione, e gli oggetti quando li si apre", () => {
    const { surface } = mount(SOURCE.replace("<title>Casa</title>", "<title>Casa</title><desc>La pianta\ndel piano terra</desc>"));
    surface.setMode!("read");
    const desc = parent.querySelector<HTMLElement>(".vector-about-desc")!;
    expect(desc.hidden).toBe(false);
    expect(desc.textContent).toBe("La pianta\ndel piano terra");
    expect(parent.querySelector(".vector-read [aria-describedby]")!.getAttribute("aria-describedby")).toBe(desc.id);
    const details = parent.querySelector<HTMLDetailsElement>(".vector-about-objects")!;
    expect(details.querySelector("summary")!.textContent).toBe("Oggetti del disegno (1)");
    // Chiuso, l'elenco non c'è: un disegno grande non lo paga finché nessuno
    // lo apre.
    expect(details.querySelector("ul")).toBeNull();
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    const items = (): string[] => [...details.querySelectorAll("li")].map((item) => item.firstChild?.textContent ?? "");
    expect(items()).toEqual(["Livello «Livello 1»", "Rettangolo"]);
    expect(details.querySelector("li > ul > li")!.textContent).toBe("Rettangolo");
    // Aperto, segue il testo.
    surface.buffer!.syncDoc(SOURCE.replace("</g>", '<ellipse id="o5e6f7a8b" cx="5" cy="5" rx="2" ry="2"/></g>'));
    expect(items()).toEqual(["Livello «Livello 1»", "Rettangolo", "Ellisse"]);
    expect(details.querySelector("summary")!.textContent).toBe("Oggetti del disegno (2)");
  });

  it("senza descrizione né oggetti non aggiunge niente all'immagine", () => {
    const { surface } = mount(doc(""));
    surface.setMode!("read");
    expect(parent.querySelector<HTMLElement>(".vector-about-desc")!.hidden).toBe(true);
    expect(parent.querySelector<HTMLElement>(".vector-about-objects")!.hidden).toBe(true);
    expect(parent.querySelector(".vector-read [aria-describedby]")).toBeNull();
  });

  it("anche un documento che si guarda soltanto ha i suoi oggetti a parole", () => {
    mount(DOCTYPE);
    expect(parent.querySelector(".vector-about-objects summary")!.textContent).toBe("Oggetti del disegno (1)");
  });
});

describe("i collegamenti", () => {
  const NOTE = "../Note/Ciclo%20dell'acqua.md";
  const LINKED = doc(
    `<title>Casa</title>${LAYER}<a id="ol1l1l1l1" href="${NOTE}"><rect id="o1a2b3c4d" x="60" y="60" width="20" height="20"/></a>` +
      `<g id="og1g1g1g1"><a id="ol2l2l2l2" href="pianta.svg"><rect x="0" y="0" width="5" height="5"/></a><a href="${NOTE}"><rect x="10" y="0" width="5" height="5"/></a></g>` +
      '<a id="ol3l3l3l3" href="https://example.org"><rect x="20" y="0" width="5" height="5"/></a></g>',
  );
  /// Aspetta che la shell riceva la richiesta.
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it("portano a una nota con un href relativo al disegno, scritto come lo scrive il kernel", () => {
    expect(linkHref("disegni/casa.svg", "Note/Ciclo dell'acqua.md")).toBe(NOTE);
    expect(linkHref("disegni/casa.svg", "disegni/pianta.svg")).toBe("pianta.svg");
    expect(linkHref("disegni/casa.svg", "disegni/sotto/nota.md")).toBe("sotto/nota.md");
    expect(linkHref("casa.svg", "Perché è così.md")).toBe("Perché%20è%20così.md");
    expect(linkHref("casa.svg", "100% vero?.md")).toBe("100%25%20vero%3F.md");
    // Un primo segmento che si leggerebbe come uno schema prende `./`.
    expect(linkHref("casa.svg", "nota:1.md")).toBe("./nota:1.md");
    expect(linkHref("disegni/casa.svg", "disegni/nota:1.md")).toBe("./nota:1.md");
    expect(linkHref("disegni/casa.svg", "altro/nota:1.md")).toBe("../altro/nota:1.md");
  });

  it("in Lettura sono una riga di pulsanti, una nota ciascuno, che la shell apre", async () => {
    const opened: string[] = [];
    const { surface } = mount(LINKED, parent, { onOpenPath: async (path) => void opened.push(path) });
    surface.setMode!("read");
    const nav = parent.querySelector<HTMLElement>(".vector-about-links")!;
    expect(nav.hidden).toBe(false);
    expect(document.getElementById(nav.getAttribute("aria-labelledby")!)!.textContent).toBe("Collegamenti");
    // Anche quelli dentro un gruppo; un indirizzo del web non è una nota.
    const buttons = [...nav.querySelectorAll<HTMLButtonElement>("li > button")];
    expect(buttons.map((control) => [control.textContent, control.title])).toEqual([
      ["Ciclo dell'acqua", "Apri «Ciclo dell'acqua»"],
      ["pianta", "Apri «pianta»"],
    ]);
    buttons[1]!.click();
    await settle();
    expect(opened).toEqual(["pianta.svg"]);
    // L'elenco degli oggetti dice dove portano.
    const details = parent.querySelector<HTMLDetailsElement>(".vector-about-objects")!;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    expect(details.querySelector("li > ul > li")!.firstChild!.textContent).toBe("Collegamento a «Ciclo dell'acqua»");
    // Senza collegamenti, la riga non c'è.
    surface.buffer!.syncDoc(SOURCE);
    expect(nav.hidden).toBe(true);
  });

  it("una nota che non si apre lo dice", async () => {
    clearHistory();
    const { surface } = mount(LINKED, parent, { onOpenPath: () => Promise.reject(new Error("non c'è")) });
    surface.setMode!("read");
    parent.querySelector<HTMLButtonElement>(".vector-about-link")!.click();
    await settle();
    expect(recentNotices().map((notice) => notice.text)).toContain("Non riesco ad aprire «Ciclo dell'acqua»: non c'è");
  });

  it("nel Disegno i segni e Alt+Invio aprono la nota con la shell", async () => {
    const opened: string[] = [];
    mount(LINKED, parent, { onOpenPath: async (path) => void opened.push(path), onPickLink: async () => null });
    const marks = [...parent.querySelectorAll<HTMLButtonElement>(".draw-link-layer .draw-link-mark")];
    expect(marks.map((mark) => mark.getAttribute("aria-label"))).toEqual(["Apri «Ciclo dell'acqua»", "Apri «pianta»", "Apri «Ciclo dell'acqua»"]);
    marks[0]!.click();
    await settle();
    expect(opened).toEqual([NOTE]);
  });

  it("copiati in un disegno di un'altra cartella, portano dove portavano", async () => {
    mount(LINKED);
    const there = document.createElement("div");
    document.body.append(there);
    try {
      const changes: EditorChange[] = [];
      const surface = mountVectorSurface(
        { paneId: "p2", documentId: "altro/piano/pianta.svg", parent: there },
        { onChange: (change) => changes.push(change), onSelectionChange: () => undefined },
      );
      surface.buffer!.setDoc(SOURCE);
      mounted.push({ surface, changes, selections: { count: 0 }, parent: there });
      const clip = (at: HTMLElement, type: string, data: DataTransfer): void => {
        at.querySelector(".draw-surface")!.dispatchEvent(new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData: data }));
      };
      key(parent, { key: "a", ctrlKey: true });
      const data = new DataTransfer();
      clip(parent, "copy", data);
      clip(there, "paste", data);
      for (let i = 0; i < 6; i++) await settle();
      expect(changes).toHaveLength(1);
      const hrefs = [...surface.buffer!.getDoc().matchAll(/ href="([^"]*)"/g)].map((match) => match[1]);
      expect(hrefs).toEqual(["../../Note/Ciclo%20dell'acqua.md", "../../disegni/pianta.svg", "../../Note/Ciclo%20dell'acqua.md"]);
    } finally {
      there.remove();
    }
  });

  it("senza una shell che le apre, niente segni né riga", () => {
    const { surface } = mount(LINKED);
    expect(parent.querySelector<HTMLElement>(".draw-link-layer")!.hidden).toBe(true);
    surface.setMode!("read");
    expect(parent.querySelector<HTMLElement>(".vector-about-links")!.hidden).toBe(true);
  });
});

describe("le connessioni", () => {
  const rect = (id: string, title?: string): string =>
    `<rect id="${id}" x="0" y="0" width="20" height="10">${title === undefined ? "" : `<title>${title}</title>`}</rect>`;
  /// Un connettore dritto fra `ends`; un capo che manca è libero.
  const connector = (id: string, ends: { readonly from?: string; readonly to?: string }): string =>
    `<path id="${id}" fub:shape="connector" fub:geom="straight 10 10 90 10"` +
    (ends.from === undefined ? "" : ` fub:from="${ends.from} auto"`) +
    (ends.to === undefined ? "" : ` fub:to="${ends.to} auto"`) +
    ' d="M10 10 L90 10" fill="none" stroke="#000000"/>';
  const label = (id: string, along: string, words: string): string =>
    `<text id="${id}" fub:along="${along} 0.5 6" x="50" y="4"><tspan x="50" dy="0">${words}</tspan></text>`;
  const CONNECTED = doc(
    `<title>Flusso</title>${LAYER}` +
      rect("o1", "Ingresso") + rect("o2", "Verifica") + rect("o3") +
      connector("c1", { from: "o1", to: "o2" }) + label("t1", "c1", "sì") +
      connector("c2", { from: "o2", to: "o3" }) +
      connector("c3", { from: "o3" }) +
      "</g>",
  );

  const section = (): HTMLElement => parent.querySelector<HTMLElement>(".vector-about-connections")!;
  const title = (): string => document.getElementById(section().querySelector("ul")!.getAttribute("aria-labelledby")!)!.textContent!;
  /// Per ogni voce, ciò che si vede e ciò che si dice.
  const entries = (): { readonly shown: string; readonly spoken: string }[] =>
    [...section().querySelectorAll("li")].map((item) => ({
      shown: item.querySelector('[aria-hidden="true"]')!.textContent!,
      spoken: item.querySelector(".sr-only")!.textContent!,
    }));

  it("in Lettura sono un elenco, «da dove a dove», col nome che si dice per esteso", () => {
    const { surface } = mount(CONNECTED);
    surface.setMode!("read");
    expect(section().hidden).toBe(false);
    expect(title()).toBe("Connessioni (2)");
    // Un connettore con un capo libero non è una connessione; un oggetto senza
    // nome si dice col suo tipo.
    expect(entries()).toEqual([
      { shown: "Ingresso → Verifica: sì", spoken: "da Ingresso a Verifica, sì" },
      { shown: "Verifica → Rettangolo", spoken: "da Verifica a Rettangolo" },
    ]);
    // La freccia non si legge: il testo che si vede è nascosto a chi ascolta,
    // e quello che si dice non si vede.
    const first = section().querySelector("li")!;
    expect(first.querySelector('[aria-hidden="true"]')!.classList.contains("sr-only")).toBe(false);
    expect(first.querySelector(".sr-only")!.getAttribute("aria-hidden")).toBeNull();
    // Sta sotto i collegamenti e sopra l'elenco degli oggetti.
    const about = [...parent.querySelector(".vector-about")!.children];
    expect(about.indexOf(section())).toBeGreaterThan(about.indexOf(parent.querySelector(".vector-about-links")!));
    expect(about.indexOf(section())).toBeLessThan(about.indexOf(parent.querySelector(".vector-about-objects")!));
  });

  it("senza connessioni non c'è, e un connettore con un capo libero non lo è", () => {
    const { surface } = mount(SOURCE);
    surface.setMode!("read");
    expect(section().hidden).toBe(true);
    expect(entries()).toEqual([]);
    surface.buffer!.syncDoc(doc(`${LAYER}${rect("o1", "Ingresso")}${connector("c1", { from: "o1" })}${connector("c2", { to: "o1" })}${connector("c3", {})}</g>`));
    expect(section().hidden).toBe(true);
    expect(entries()).toEqual([]);
  });

  it("si aggiorna quando il testo cambia", () => {
    const { surface } = mount(CONNECTED);
    surface.setMode!("read");
    expect(title()).toBe("Connessioni (2)");
    surface.buffer!.syncDoc(CONNECTED.replace(">sì<", ">no<"));
    expect(entries()[0]).toEqual({ shown: "Ingresso → Verifica: no", spoken: "da Ingresso a Verifica, no" });
    // Un capo che si stacca toglie la connessione; uno che si attacca la dà.
    surface.buffer!.syncDoc(CONNECTED.replace(' fub:to="o2 auto"', "").replace('<path id="c3" fub:shape="connector" fub:geom="straight 10 10 90 10" fub:from="o3 auto"', '<path id="c3" fub:shape="connector" fub:geom="straight 10 10 90 10" fub:from="o3 auto" fub:to="o1 auto"'));
    expect(title()).toBe("Connessioni (2)");
    expect(entries().map((entry) => entry.shown)).toEqual(["Verifica → Rettangolo", "Rettangolo → Ingresso"]);
    surface.buffer!.syncDoc(SOURCE);
    expect(section().hidden).toBe(true);
    surface.buffer!.syncDoc(CONNECTED);
    expect(section().hidden).toBe(false);
    expect(title()).toBe("Connessioni (2)");
  });

  it("segue la lingua", () => {
    const { surface } = mount(CONNECTED);
    surface.setMode!("read");
    vi.stubGlobal("navigator", { language: "en-GB" });
    try {
      // La lingua cambia, il testo no: la superficie si ridisegna.
      surface.setReadOnly!(false);
      expect(title()).toBe("Connections (2)");
      expect(entries()).toEqual([
        { shown: "Ingresso → Verifica: sì", spoken: "from Ingresso to Verifica, sì" },
        { shown: "Verifica → Rectangle", spoken: "from Verifica to Rectangle" },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("anche un documento che si guarda soltanto ha le sue connessioni", () => {
    mount(`<!DOCTYPE svg>${CONNECTED}`);
    expect(title()).toBe("Connessioni (2)");
    expect(entries()[0]).toEqual({ shown: "Ingresso → Verifica: sì", spoken: "da Ingresso a Verifica, sì" });
  });
});

describe("le selezioni e `reveal`", () => {
  // Un titolo con lettere fuori dall'ASCII: i byte non sono più i caratteri.
  const ACCENTED = doc(
    `<title>Perché è così</title>${LAYER}<rect id="o1a2b3c4d" x="60" y="60" width="20" height="20"/><circle id="o5e6f7a8b" cx="10" cy="10" r="5"/></g>`,
  );
  const bytes = (text: string, at: number): number => new TextEncoder().encode(text.slice(0, at)).length;

  it("danno gli span in byte UTF-8 degli oggetti scelti, col loro testo", () => {
    const { surface, selections } = mount(ACCENTED);
    expect(surface.selections!()).toBeUndefined();
    expect(surface.selectedText!()).toBeNull();
    const start = ACCENTED.indexOf("<circle");
    const end = ACCENTED.indexOf("</g>");
    expect(surface.reveal!({ span: { start: bytes(ACCENTED, start) + 2, end: bytes(ACCENTED, start) + 2 } })).toBe(true);
    expect(selections.count).toBe(1);
    expect(surface.selections!()).toEqual({
      primary: { start: bytes(ACCENTED, start), end: bytes(ACCENTED, end), text: ACCENTED.slice(start, end) },
      secondary: [],
    });
    expect(surface.selectedText!()).toEqual({ primary: ACCENTED.slice(start, end), secondary: [] });
  });

  it("con più oggetti, il primo nel documento è il principale", () => {
    const { surface } = mount(ACCENTED);
    key(parent, { key: "a", ctrlKey: true });
    const texts = surface.selectedText!();
    expect(texts!.primary).toMatch(/^<rect /);
    expect(texts!.secondary).toHaveLength(1);
    expect(texts!.secondary[0]).toMatch(/^<circle /);
  });

  it("in Lettura non c'è selezione e `reveal` non porta da nessuna parte", () => {
    const { surface, selections } = mount(ACCENTED);
    key(parent, { key: "a", ctrlKey: true });
    const before = selections.count;
    surface.setMode!("read");
    expect(selections.count).toBe(before + 1);
    expect(surface.selections!()).toBeUndefined();
    expect(surface.selectedText!()).toBeNull();
    const at = bytes(ACCENTED, ACCENTED.indexOf("<rect")) + 1;
    expect(surface.reveal!({ span: { start: at, end: at } })).toBe(false);
  });

  it("`reveal` fuori dagli oggetti risponde di no", () => {
    const { surface } = mount(ACCENTED);
    const at = bytes(ACCENTED, ACCENTED.indexOf("<title>")) + 1;
    expect(surface.reveal!({ span: { start: at, end: at } })).toBe(false);
  });
});

describe("il fuoco", () => {
  it("va al foglio nel Disegno, al palco nella Lettura, a «Modifica» se è l'unica cosa", () => {
    const { surface } = mount();
    surface.focus!();
    expect(document.activeElement).toBe(parent.querySelector(".draw-surface"));
    surface.setMode!("read");
    surface.focus!();
    expect(document.activeElement).toBe(parent.querySelector(".zoom-stage"));
  });
});

describe("montare e smontare", () => {
  it("ripetuto, non lascia nodi, ascoltatori né URL", () => {
    const added: [EventTarget, string, unknown][] = [];
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    vi.spyOn(EventTarget.prototype, "addEventListener").mockImplementation(function (this: EventTarget, type, listener, options) {
      if (this === window || this === document) added.push([this, type, listener]);
      add.call(this, type, listener, options);
    });
    vi.spyOn(EventTarget.prototype, "removeEventListener").mockImplementation(function (this: EventTarget, type, listener, options) {
      const i = added.findIndex(([target, t, l]) => target === this && t === type && l === listener);
      if (i >= 0) added.splice(i, 1);
      remove.call(this, type, listener, options);
    });
    const created = vi.spyOn(URL, "createObjectURL");
    const revoked = vi.spyOn(URL, "revokeObjectURL");
    for (let i = 0; i < 20; i++) {
      const { surface } = mount(i % 3 === 0 ? DOCTYPE : i % 3 === 1 ? FOREIGN : SOURCE);
      if (i % 2 === 0) surface.setMode!("read");
      surface.destroy();
      mounted.pop();
    }
    expect(parent.childNodes).toHaveLength(0);
    expect(added).toEqual([]);
    expect(revoked.mock.calls.map(([url]) => url).sort()).toEqual(created.mock.results.map((r) => r.value as string).sort());
  });
});

/// Il livello dichiarato da `fub.draw`, col valore `value`.
const level = (value: string): SettingEntry => ({
  spec: {
    key: "draw.level",
    label: "Livello d'interfaccia",
    description: "",
    group: "Disegni",
    scope: "vault",
    kind: {
      kind: "choice",
      default: "essential",
      options: [
        { value: "essential", label: "Essenziale" },
        { value: "standard", label: "Standard" },
      ],
    },
    program_writable: false,
  },
  value,
  source: "vault",
});

/// Le parti del Personalizzato, col valore `value`.
const custom = (value: string[]): SettingEntry => ({
  spec: {
    key: "draw.custom",
    label: "Parti del Personalizzato",
    description: "",
    group: "Disegni",
    scope: "vault",
    kind: { kind: "list", default: ["pen", "eraser", "rect", "ellipse", "line", "arrow"] },
    program_writable: false,
  },
  value,
  source: "vault",
});

/// Moduli nuovi, perché il livello e la griglia letti restano in memoria,
/// e il router del kernel acceso: è lui che porta `setting_changed`.
async function fresh(host: FakeHost) {
  box.host = host;
  vi.resetModules();
  const { mountVectorSurface: mountFresh } = await import("./surface");
  await (await import("../../state/kernel")).startKernelRouter();
  return (at: HTMLElement, shell: Pick<VectorSurfaceOptions, "images"> = {}): EditorSurface => {
    const surface = mountFresh(
      { paneId: `p${mounted.length + 1}`, documentId: "disegni/casa.svg", parent: at },
      { onChange: () => {}, onSelectionChange: () => {}, ...shell },
    );
    surface.buffer!.setDoc(SOURCE);
    mounted.push({ surface, changes: [], selections: { count: 0 }, parent: at });
    return surface;
  };
}

describe("il livello e la griglia", () => {
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const tools = (at: HTMLElement): string[] =>
    [...at.querySelectorAll<HTMLElement>(".draw-tool")].filter((control) => control.closest("[hidden]") === null).map((control) => control.dataset.tool!);
  const gridShown = (at: HTMLElement): boolean => at.querySelector<HTMLElement>(".draw-grid")!.style.display !== "none";
  const reads = (host: FakeHost): number =>
    host.atGate("queryIndex").filter((call) => (call.args[0] as { kind: string }).kind === "settings").length;

  it("una superficie nuova parte dall'ultimo livello e dall'ultima griglia, senza aspettare la lettura", async () => {
    const mountFresh = await fresh(createFakeHost({ settings: [level("standard")] }));
    mountFresh(parent);
    expect(tools(parent), "prima della lettura").not.toContain("highlighter");
    await settle();
    expect(tools(parent)).toContain("highlighter");
    key(parent, { key: "#" });
    expect(gridShown(parent)).toBe(true);

    const other = document.createElement("div");
    document.body.append(other);
    try {
      mountFresh(other);
      expect(tools(other), "subito").toContain("highlighter");
      expect(gridShown(other), "subito").toBe(true);
    } finally {
      other.remove();
    }
  });

  it("segue il livello finché vive, e smette quando si distrugge", async () => {
    const host = createFakeHost({ settings: [level("essential")] });
    const mountFresh = await fresh(host);
    const surface = mountFresh(parent);
    await settle();
    expect(tools(parent)).not.toContain("highlighter");

    await host.module.api.setSetting("draw.level", "standard");
    await settle();
    expect(tools(parent)).toContain("highlighter");
    expect(reads(host)).toBe(2);

    surface.destroy();
    mounted = [];
    await host.module.api.setSetting("draw.level", "essential");
    await settle();
    expect(reads(host), "una superficie distrutta non rilegge").toBe(2);
  });

  it("i colori recenti vengono dallo stato di vista, si ricordano scelti, e una superficie nuova parte da lì", async () => {
    /// I recenti della sezione «Colori del documento», col pannello aperto.
    const recent = (at: HTMLElement): string[] => {
      const panel = at.querySelector<HTMLElement>(".draw-properties")!;
      if (panel.hidden) at.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Proprietà"]')!.click();
      return [...panel.querySelectorAll<HTMLElement>('.draw-swatches-group[data-group="recent"] .draw-swatches-chip')].map((chip) => chip.dataset.key!);
    };
    const host = createFakeHost({ settings: [level("standard")] });
    await host.module.api.setViewState("draw.colors", { colors: ["#cc79a7"] });
    const mountFresh = await fresh(host);
    mountFresh(parent);
    await settle();
    expect(recent(parent)).toEqual(["#cc79a7"]);
    parent.querySelector<HTMLButtonElement>('[role="toolbar"] .draw-color[aria-label="Vermiglio"]')!.click();
    expect(recent(parent)).toEqual(["#d55e00", "#000000", "#cc79a7"]);
    await settle();
    expect(await host.module.api.viewState("draw.colors")).toEqual({ colors: ["#d55e00", "#000000", "#cc79a7"] });

    const other = document.createElement("div");
    document.body.append(other);
    try {
      mountFresh(other);
      expect(recent(other), "subito").toEqual(["#d55e00", "#000000", "#cc79a7"]);
    } finally {
      other.remove();
    }
  });

  it("il Personalizzato ha le parti scelte, anche su una superficie nuova, e ne segue i cambi", async () => {
    const host = createFakeHost({ settings: [level("custom"), custom(["rect", "text"])] });
    const mountFresh = await fresh(host);
    mountFresh(parent);
    await settle();
    expect(tools(parent)).toEqual(["select", "rect", "text"]);

    await host.module.api.setSetting("draw.custom", ["ellipse", "highlighter"]);
    await settle();
    expect(tools(parent)).toEqual(["select", "highlighter", "ellipse"]);

    const other = document.createElement("div");
    document.body.append(other);
    try {
      mountFresh(other);
      expect(tools(other), "subito").toEqual(["select", "highlighter", "ellipse"]);
    } finally {
      other.remove();
    }
  });
});

describe("le immagini del vault", () => {
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
  const PNG_URI = "data:image/png;base64,iVBORw==";
  const image = (id: string, href: string): string => `<image id="${id}" x="0" y="0" width="10" height="10" href="${href}"/>`;
  const PICTURES = doc(
    `<title>Casa</title>${LAYER}${image("oi1i1i1i1", "foto.png")}${image("oi2i2i2i2", "manca.png")}${image("oi3i3i3i3", "https://example.org/a.png")}</g>`,
  );
  /// Le letture finiscono: la shell, poi i byte in data URI.
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  /// La shell: apre e legge i file di `files`, e tiene il conto di che cosa
  /// legge e con quale tetto. Il tetto lo lascia a chi la chiama.
  function shell(files: Record<string, Blob>): VectorImages & { reads: string[]; limits: (number | undefined)[] } {
    const reads: string[] = [];
    const limits: (number | undefined)[] = [];
    return {
      reads,
      limits,
      url: async (path) => `blob:vault/${path}`,
      read: async (path, limit) => {
        reads.push(path);
        limits.push(limit);
        return files[path] ?? null;
      },
    };
  }

  /// Il browser misura ogni immagine 40 × 20: happy-dom non sa farlo.
  function measure(): void {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 40, height: 20, close: () => {} }));
  }
  afterEach(() => vi.unstubAllGlobals());

  /// Il testo dell'immagine che la Lettura mostra per ultima.
  const lastShown = ({ mock: { calls } }: { mock: { calls: unknown[][] } }): Promise<string> => (calls[calls.length - 1]![0] as Blob).text();
  const info = (): string => parent.querySelector(".vector-read .zoom-info")!.textContent ?? "";

  it("il foglio le mostra con l'URL che apre la shell", async () => {
    mount(PICTURES, parent, { images: shell({}) });
    await settle();
    const hrefs = [...parent.querySelectorAll(".draw-surface image[data-scene-id]")].map((element) => element.getAttribute("href"));
    expect(hrefs).toEqual(["blob:vault/foto.png", "blob:vault/manca.png", IMAGE_PLACEHOLDER]);
  });

  it("in Lettura entrano coi loro byte, le altre restano segnaposti, e il peso detto è quello del file", async () => {
    const created = vi.spyOn(URL, "createObjectURL");
    const images = shell({ "foto.png": new Blob([PNG], { type: "image/png" }) });
    const { surface } = mount(PICTURES, parent, { images });
    surface.setMode!("read");
    const placeholders = PICTURES.replace('href="foto.png"', `href="${IMAGE_PLACEHOLDER}"`)
      .replace('href="manca.png"', `href="${IMAGE_PLACEHOLDER}"`)
      .replace('href="https://example.org/a.png"', `href="${IMAGE_PLACEHOLDER}"`);
    // Subito i segnaposti, poi le immagini lette.
    expect(await lastShown(created)).toBe(placeholders);
    const size = svgSize(PICTURES);
    const before = info();
    expect(before).toBe(imageInfo({ format: "SVG", blob: new Blob([PICTURES]) }, size?.width ?? null, size?.height ?? null));
    await settle();
    expect(images.reads).toEqual(["foto.png", "manca.png"]);
    // Una alla volta, col tetto che resta.
    expect(images.limits).toEqual([READ_IMAGE_BYTES, READ_IMAGE_BYTES - PNG.length]);
    expect(await lastShown(created)).toBe(placeholders.replace(`href="${IMAGE_PLACEHOLDER}"`, `href="${PNG_URI}"`));
    expect(info()).toBe(before);
    // Il file resta com'è.
    expect(surface.buffer!.getDoc()).toBe(PICTURES);
  });

  it("un testo nuovo mostra subito quelle già lette, e riprova soltanto quelle che non si sono aperte", async () => {
    const created = vi.spyOn(URL, "createObjectURL");
    const images = shell({ "foto.png": new Blob([PNG], { type: "image/png" }) });
    const { surface } = mount(PICTURES, parent, { images });
    surface.setMode!("read");
    await settle();
    const shown = created.mock.calls.length;
    surface.buffer!.syncDoc(PICTURES.replace("Casa", "Albero"));
    expect(created.mock.calls.length).toBe(shown + 1);
    expect(await lastShown(created)).toContain(`href="${PNG_URI}"`);
    await settle();
    expect(images.reads).toEqual(["foto.png", "manca.png", "manca.png"]);
    // Niente di nuovo, niente da mostrare di nuovo.
    expect(created.mock.calls.length).toBe(shown + 1);
    // Tolta dal testo, un'immagine si scorda: tornando, si rilegge.
    surface.buffer!.syncDoc(PICTURES.replace('href="foto.png"', 'href="altra.png"'));
    surface.buffer!.syncDoc(PICTURES);
    await settle();
    expect(images.reads.filter((path) => path === "foto.png")).toHaveLength(2);
  });

  it("una lettura che finisce dopo un testo nuovo non mostra il testo di prima", async () => {
    const created = vi.spyOn(URL, "createObjectURL");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const read = async (): Promise<Blob> => {
      await gate;
      return new Blob([PNG], { type: "image/png" });
    };
    const { surface } = mount(PICTURES, parent, { images: { url: async () => null, read } });
    surface.setMode!("read");
    // Il testo nuovo non ha immagini da leggere.
    surface.buffer!.syncDoc(SOURCE);
    release();
    await settle();
    expect(await lastShown(created)).toBe(SOURCE);
  });

  it("oltre il tetto della Lettura un'immagine resta un segnaposto", async () => {
    const created = vi.spyOn(URL, "createObjectURL");
    // Un file enorme che una shell dà lo stesso: conta solo quanto dice di
    // pesare.
    const huge = { size: READ_IMAGE_BYTES + 1, type: "image/png" } as Blob;
    const { surface } = mount(PICTURES, parent, { images: shell({ "foto.png": huge, "manca.png": new Blob([PNG], { type: "image/png" }) }) });
    surface.setMode!("read");
    await settle();
    const text = await lastShown(created);
    expect(text).toContain(`<image id="oi1i1i1i1" x="0" y="0" width="10" height="10" href="${IMAGE_PLACEHOLDER}"/>`);
    expect(text).toContain(`<image id="oi2i2i2i2" x="0" y="0" width="10" height="10" href="${PNG_URI}"/>`);
  });

  it("i caratteri dell'app entrano nella Lettura appena letti, prima delle immagini, e il file non cambia", async () => {
    const created = vi.spyOn(URL, "createObjectURL");
    const SHEET = '@font-face{font-family:"Inter";src:url(data:font/woff2;base64,SQ==)}';
    let ready = false;
    let arrive = (): void => {};
    const fonts = {
      now: (svg: string) => (!svg.includes("Inter") ? "" : ready ? SHEET : null),
      load: () => new Promise<string>((resolve) => {
        arrive = () => {
          ready = true;
          resolve(SHEET);
        };
      }),
    };
    const lettered = PICTURES.replace("</g>", '<text id="t" font-family="Inter" x="1" y="20">Casa</text></g>');
    const { surface } = mount(lettered, parent, { images: shell({ "foto.png": new Blob([PNG], { type: "image/png" }) }), fonts });
    surface.setMode!("read");
    // Subito, coi caratteri del sistema.
    expect(await lastShown(created)).not.toContain("@font-face");
    await settle();
    arrive();
    await settle();
    const text = await lastShown(created);
    expect(text).toMatch(new RegExp(`^<svg [^>]*><style>${SHEET.replace(/[(){}]/g, "\\$&")}</style><title>`));
    expect(text).toContain(`<image id="oi1i1i1i1" x="0" y="0" width="10" height="10" href="${PNG_URI}"/>`);
    expect(text).toContain(`<image id="oi2i2i2i2" x="0" y="0" width="10" height="10" href="${IMAGE_PLACEHOLDER}"/>`);
    expect(surface.buffer!.getDoc()).toBe(lettered);
    // Un testo nuovo li ha già dal primo disegno.
    const calls = created.mock.calls.length;
    surface.buffer!.syncDoc(lettered.replace("Casa</text>", "Casetta</text>"));
    expect(created.mock.calls.length).toBe(calls + 1);
    expect(await lastShown(created)).toContain(`<style>${SHEET}</style>`);
  });

  it("Ctrl+I sceglie con la shell, e l'immagine si scrive relativa al disegno", async () => {
    measure();
    const mountFresh = await fresh(createFakeHost({ settings: [level("standard")] }));
    const images = shell({ "foto/a%20b.png": new Blob([PNG], { type: "image/png" }) });
    const surface = mountFresh(parent, { images: { ...images, pick: async () => "disegni/foto/a b.png" } });
    await settle();
    key(parent, { key: "i", ctrlKey: true });
    await settle();
    // Il percorso si scrive come un collegamento, e si legge com'è scritto.
    expect(images.reads).toEqual(["foto/a%20b.png"]);
    expect(surface.buffer!.getDoc()).toMatch(/<image id="[^"]+" x="[^"]+" y="[^"]+" width="40" height="20" href="foto\/a%20b\.png"\/>/);
  });

  it("una scelta che fallisce lo dice, e non aggiunge niente", async () => {
    measure();
    const mountFresh = await fresh(createFakeHost({ settings: [level("standard")] }));
    // Gli avvisi di questa superficie sono quelli dei moduli nuovi.
    const notices = await import("../../ui/notify");
    notices.clearHistory();
    const surface = mountFresh(parent, { images: { ...shell({}), pick: () => Promise.reject(new Error("il vault non risponde")) } });
    await settle();
    key(parent, { key: "i", ctrlKey: true });
    await settle();
    expect(notices.recentNotices().map((notice) => notice.text)).toContain("il vault non risponde");
    expect(surface.buffer!.getDoc()).toBe(SOURCE);
  });
});

describe("la finestra «Esporta»", () => {
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const dialog = (): HTMLElement | null => {
    const all = document.querySelectorAll<HTMLElement>(".modale");
    return all[all.length - 1] ?? null;
  };
  const option = (label: string): HTMLInputElement =>
    [...dialog()!.querySelectorAll<HTMLLabelElement>("label.draw-export-option")].find((each) => each.textContent === label)!.querySelector("input")!;
  const choose = (label: string): void => {
    option(label).checked = true;
    option(label).dispatchEvent(new Event("change", { bubbles: true }));
  };
  const submit = (): void => dialog()!.querySelector("form")!.requestSubmit();
  const cancel = (): void => [...dialog()!.querySelectorAll("button")].find((each) => each.textContent === "Annulla")!.click();
  /// Una casa con il tetto senza id.
  const UNNAMED = doc(
    `<title>Casa</title>${LAYER}<rect id="o1a2b3c4d" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/><path d="M10 10 L30 10" stroke="#000000" stroke-width="2"/></g>`,
  );

  afterEach(() => {
    for (const modal of document.querySelectorAll(".modale")) modal.remove();
  });

  it("c'è dallo Standard, su un disegno che si legge", async () => {
    const host = createFakeHost({ settings: [level("essential")] });
    const mountFresh = await fresh(host);
    const surface = mountFresh(parent);
    await settle();
    expect(surface.exportWindow!.available()).toBe(false);
    await host.module.api.setSetting("draw.level", "standard");
    await settle();
    expect(surface.exportWindow!.available()).toBe(true);
    surface.buffer!.setDoc("<svg");
    expect(surface.exportWindow!.available(), "un file che non si legge").toBe(false);
  });

  it("apre la finestra sul disegno, torna la richiesta, e le scelte si ricordano", async () => {
    const host = createFakeHost({ settings: [level("standard")] });
    const mountFresh = await fresh(host);
    const surface = mountFresh(parent);
    await settle();
    const first = surface.exportWindow!.open();
    await settle();
    expect(dialog()!.querySelector("h2")!.textContent).toBe("Esporta «Casa»");
    choose("SVG");
    submit();
    const chosen = (await first)!;
    expect(chosen.target).toBe("draw.svg");
    expect(chosen.label()).toBe("SVG");
    expect(chosen.options!()).toEqual({ background: "paper", scope: "drawing", suffix: "esportato" });
    await settle();

    const second = surface.exportWindow!.open();
    await settle();
    expect(option("SVG").checked, "ricordato per questo disegno").toBe(true);
    cancel();
    expect(await second).toBeNull();
    expect(await host.module.api.viewState("draw.export")).toEqual({
      drawings: [{ doc: "disegni/casa.svg", memory: { what: "drawing", off: [], format: "svg", size: { scale: 2 }, background: "paper" } }],
    });
  });

  it("gli oggetti scelti senza id lo ricevono quando si esporta la selezione, in un passo che si annulla", async () => {
    const mountFresh = await fresh(createFakeHost({ settings: [level("standard")] }));
    const surface = mountFresh(parent);
    surface.buffer!.setDoc(UNNAMED);
    await settle();
    key(parent, { key: "a", ctrlKey: true });
    const answer = surface.exportWindow!.open();
    await settle();
    const selection = option("La selezione (2 oggetti)");
    expect(selection.disabled).toBe(false);
    expect(document.getElementById(selection.getAttribute("aria-describedby")!)!.textContent).toBe(
      "1 oggetto scelto non ha un id: lo riceve quando esporti, in un passo che si annulla.",
    );
    expect(surface.buffer!.getDoc(), "la finestra non scrive").toBe(UNNAMED);
    choose("La selezione (2 oggetti)");
    submit();
    const chosen = (await answer)!;
    const written = surface.buffer!.getDoc();
    const id = /<path id="(o[0-9a-z]{8})"/.exec(written)?.[1];
    expect(id).toBeDefined();
    expect(chosen.options!()).toEqual({
      background: "paper",
      scope: "selection",
      selection: { ids: ["o1a2b3c4d", id], box: [9, 9, 72, 72] },
      suffix: "selezione",
      scale: 2,
    });
    expect(chosen.label()).toBe("PNG della selezione");
    undo();
    expect(surface.buffer!.getDoc()).toBe(UNNAMED);
  });

  it("se il disegno cambia mentre si sceglie, la selezione non si esporta e lo dice", async () => {
    const mountFresh = await fresh(createFakeHost({ settings: [level("standard")] }));
    const notices = await import("../../ui/notify");
    notices.clearHistory();
    const surface = mountFresh(parent);
    surface.buffer!.setDoc(UNNAMED);
    await settle();
    key(parent, { key: "a", ctrlKey: true });
    const answer = surface.exportWindow!.open();
    await settle();
    choose("La selezione (2 oggetti)");
    const changed = UNNAMED.replace('x="60"', 'x="61"');
    surface.buffer!.setDoc(changed);
    submit();
    expect(await answer).toBeNull();
    expect(surface.buffer!.getDoc()).toBe(changed);
    expect(notices.recentNotices().map(({ text, tone }) => ({ text, tone }))).toContainEqual({
      text: "Il disegno è cambiato mentre sceglievi che cosa esportare: riapri «Esporta…» per vederlo com’è adesso.",
      tone: "guasto",
    });
  });

  it("in Lettura la selezione non si vede, e non si offre", async () => {
    const mountFresh = await fresh(createFakeHost({ settings: [level("standard")] }));
    const surface = mountFresh(parent);
    await settle();
    key(parent, { key: "a", ctrlKey: true });
    surface.setMode!("read");
    const answer = surface.exportWindow!.open();
    await settle();
    const labels = [...dialog()!.querySelectorAll("label.draw-export-option")].map((each) => each.textContent);
    expect(labels).toContain("Il disegno intero");
    expect(labels.some((label) => label!.startsWith("La selezione"))).toBe(false);
    cancel();
    expect(await answer).toBeNull();
  });
});
