// @vitest-environment happy-dom
// La superficie del disegno nella shell: le modalità, il buffer allineato alla
// sessione, i documenti che non si modificano e le selezioni in byte del file.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorSurface } from "../core/registry";
import type { EditorChange } from "../core/text-operation";
import { doc, HEAD } from "./scene/test-support";
import { VECTOR_MODES } from "./modes";
import { mountVectorSurface } from "./surface";
import { LAYER } from "./tools/test-support";

const SOURCE = doc(
  `<title>Casa</title>${LAYER}<rect id="o1a2b3c4d" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/></g>`,
);
const FOREIGN = SOURCE.replace(' fub:version="1"', "");
const DOCTYPE = `<!DOCTYPE svg>${SOURCE}`;

const MOUSE = { pointerId: 1, pointerType: "mouse" } as const;

let parent: HTMLElement;
let mounted: { surface: EditorSurface; changes: EditorChange[]; selections: { count: number }; parent: HTMLElement }[];

function mount(text: string | null = SOURCE, at: HTMLElement = parent): { surface: EditorSurface; changes: EditorChange[]; selections: { count: number } } {
  const changes: EditorChange[] = [];
  const selections = { count: 0 };
  const surface = mountVectorSurface(
    { paneId: `p${mounted.length + 1}`, documentId: "disegni/casa.svg", parent: at },
    { onChange: (change) => changes.push(change), onSelectionChange: () => selections.count++ },
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
