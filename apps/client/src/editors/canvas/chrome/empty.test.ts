// @vitest-environment happy-dom
// La lavagna vuota (T62): i tre pulsanti nell'ordine del DOM, quando spariscono
// e tornano, la sola lettura, la scheda che nasce in scrittura, gli appunti
// vuoti o negati dal sistema, e il selettore dei file che passa dal deposito.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n/strings";
import { openLifetime } from "../../../ui/lifetime";
import { notify } from "../../../ui/notify";
import { CanvasEngine, type CanvasAttachmentPort } from "../engine";
import { canvasCoreReady } from "../wasm/core";
import { createCanvasEmpty, isEmptyBoard, transferOf } from "./empty";
import type { CanvasDocument } from "../model";
import type { ClipboardEntry } from "../../../platform/clipboard";

// Gli appunti: la prova decide che cosa legge il clic su «Incolla».
const clipboard = vi.hoisted(() => ({
  read: (): Promise<readonly ClipboardEntry[]> => Promise.resolve([]),
}));

vi.mock("../../../platform/clipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/clipboard")>()),
  readClipboard: () => clipboard.read(),
}));

vi.mock("../../../ui/notify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ui/notify")>()),
  notify: vi.fn(),
}));

beforeAll(async () => {
  await canvasCoreReady();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(notify).mockClear();
  clipboard.read = () => Promise.resolve([]);
  document.body.replaceChildren();
});

const EMPTY = JSON.stringify({ nodes: [], edges: [] });

function mounted(source = EMPTY, attachments?: CanvasAttachmentPort) {
  const host = document.createElement("div");
  document.body.append(host);
  const engine = new CanvasEngine(host, {
    surfaceId: "empty",
    formatId: "canvas",
    revision: "rev-1",
    documentId: "lavagna.canvas",
    onChange: () => {},
    onSelectionChange: () => {},
    onPickFile: () => null,
    ...(attachments ? { attachments } : {}),
  });
  engine.setDoc(source);
  return { engine, host };
}

const blankOf = (host: HTMLElement) => host.querySelector<HTMLElement>(".canvas-blank")!;
const actionsOf = (host: HTMLElement) => host.querySelector<HTMLElement>(".canvas-blank-actions")!;
const buttonsOf = (host: HTMLElement) => [...actionsOf(host).querySelectorAll<HTMLButtonElement>("button")];
const buttonNamed = (host: HTMLElement, label: string) => buttonsOf(host).find((button) => button.textContent === label)!;
const linesOf = (host: HTMLElement) => [...blankOf(host).querySelectorAll(".canvas-blank-lines > span")].map((span) => span.textContent);

/// Un clic sul pulsante: il motore ascolta l'evento `click`.
function press(button: HTMLElement): void {
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

/// Il selettore dei file: il sistema non si apre in una prova, quindi si
/// cattura l'`<input>` che il pulsante prova ad aprire.
function captureFilePicker(): () => HTMLInputElement {
  const opened: HTMLInputElement[] = [];
  vi.spyOn(HTMLElement.prototype, "click").mockImplementation(function (this: HTMLElement) {
    opened.push(this as HTMLInputElement);
  });
  return () => {
    const input = opened[0];
    if (input === undefined) throw new Error("nessun selettore aperto");
    return input;
  };
}

/// Un testo degli appunti, come il sistema lo dà a `readClipboard`.
function clipboardText(text: string): ClipboardEntry {
  return {
    types: ["text/plain"],
    getType: async () => new Blob([text], { type: "text/plain" }),
  } as unknown as ClipboardEntry;
}

function cardsOf(engine: CanvasEngine): CanvasDocument["nodes"] {
  return (JSON.parse(engine.getDoc()) as CanvasDocument).nodes;
}

describe("la lavagna vuota: che cosa è vuoto", () => {
  it("vuota è senza schede, senza collegamenti e senza inchiostro", () => {
    expect(isEmptyBoard({ nodes: [], edges: [] })).toBe(true);
    expect(isEmptyBoard({ nodes: [], edges: [], "fub:ink": { v: 1, strokes: [] } })).toBe(true);
  });

  it("una scheda, un gruppo vuoto o un collegamento la riempiono", () => {
    const text = { id: "a", type: "text" as const, x: 0, y: 0, width: 200, height: 100, text: "" };
    const group = { id: "g", type: "group" as const, x: 0, y: 0, width: 480, height: 320, label: "" };
    expect(isEmptyBoard({ nodes: [text], edges: [] })).toBe(false);
    expect(isEmptyBoard({ nodes: [group], edges: [] })).toBe(false);
    expect(isEmptyBoard({ nodes: [], edges: [{ id: "e", fromNode: "a", toNode: "b" }] })).toBe(false);
  });

  it("l'inchiostro sulla lavagna si vede: non è vuota", () => {
    expect(isEmptyBoard({ nodes: [], edges: [], "fub:ink": { v: 1, strokes: [{ id: "s" }] } })).toBe(false);
  });
});

describe("i tre pulsanti", () => {
  it("su una lavagna vuota ci sono le tre righe e i tre pulsanti, nell'ordine del DOM", () => {
    const { host } = mounted(EMPTY, { deposit: vi.fn(async () => [] as string[]) });
    expect(blankOf(host).hidden).toBe(false);
    expect(linesOf(host)).toEqual([t("canvas.blank.1"), t("canvas.blank.2"), t("canvas.blank.3")]);
    expect(buttonsOf(host).map((button) => button.tagName)).toEqual(["BUTTON", "BUTTON", "BUTTON"]);
    expect(buttonsOf(host).map((button) => button.textContent)).toEqual([
      t("canvas.blank.write"),
      t("canvas.blank.add"),
      t("canvas.blank.paste"),
    ]);
  });

  it("«Aggiungi file…» c'è solo dove la lavagna può depositare i file", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const engine = new CanvasEngine(host, {
      surfaceId: "bare",
      formatId: "canvas",
      revision: "rev-1",
      documentId: "lavagna.canvas",
      onChange: () => {},
      onSelectionChange: () => {},
      onPickFile: () => null,
    });
    engine.setDoc(EMPTY);
    expect(buttonsOf(host).map((button) => button.textContent)).toEqual([t("canvas.blank.write"), t("canvas.blank.paste")]);
  });

  it("spariscono alla prima scheda, e tornano quando la lavagna torna vuota", async () => {
    clipboard.read = () => Promise.resolve([clipboardText("prima")]);
    const { engine, host } = mounted();
    press(buttonNamed(host, t("canvas.blank.paste")));
    await vi.waitFor(() => expect(cardsOf(engine)).toHaveLength(1));
    expect(blankOf(host).hidden).toBe(true);
    expect(engine.undo()).toBe(true);
    expect(cardsOf(engine)).toHaveLength(0);
    expect(blankOf(host).hidden).toBe(false);
  });

  it("un gruppo vuoto tolgono le tre righe", () => {
    const group = JSON.stringify({ nodes: [{ id: "g", type: "group", x: 0, y: 0, width: 480, height: 320, label: "" }], edges: [] });
    const { host } = mounted(group);
    expect(blankOf(host).hidden).toBe(true);
  });
});

describe("«Scrivi una scheda»", () => {
  it("mette una scheda di testo, già in scrittura, e le righe spariscono", () => {
    const { engine, host } = mounted();
    press(buttonNamed(host, t("canvas.blank.write")));
    const cards = cardsOf(engine);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ type: "text", text: "" });
    expect(host.querySelector(".canvas-text-editor")).not.toBeNull();
    expect(blankOf(host).hidden).toBe(true);
  });
});

describe("«Aggiungi file…»", () => {
  it("il selettore del sistema manda i file al deposito, come un rilascio", async () => {
    const deposit = vi.fn(async () => ["attachments/foto.png"]);
    const { engine, host } = mounted(EMPTY, { deposit });
    const picker = captureFilePicker();
    press(buttonNamed(host, t("canvas.blank.add")));
    const file = new File(["immagine"], "foto.png", { type: "image/png" });
    Object.defineProperty(picker(), "files", { value: [file] });
    picker().dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(deposit).toHaveBeenCalledWith([file], "lavagna.canvas", expect.objectContaining({ live: expect.any(Function) })));
    await vi.waitFor(() => expect(cardsOf(engine).some((node) => node.file === "attachments/foto.png")).toBe(true));
    expect(blankOf(host).hidden).toBe(true);
  });

  it("annullato il selettore non succede niente", () => {
    const deposit = vi.fn(async () => [] as string[]);
    const { host } = mounted(EMPTY, { deposit });
    const picker = captureFilePicker();
    press(buttonNamed(host, t("canvas.blank.add")));
    Object.defineProperty(picker(), "files", { value: [] });
    picker().dispatchEvent(new Event("change"));
    expect(deposit).not.toHaveBeenCalled();
    expect(blankOf(host).hidden).toBe(false);
  });
});

describe("«Incolla»", () => {
  it("il testo degli appunti diventa una scheda, come Ctrl+V", async () => {
    clipboard.read = () => Promise.resolve([clipboardText("ciao dagli appunti")]);
    const { engine, host } = mounted();
    press(buttonNamed(host, t("canvas.blank.paste")));
    await vi.waitFor(() => expect(cardsOf(engine)).toHaveLength(1));
    expect(cardsOf(engine)[0]).toMatchObject({ type: "text", text: "ciao dagli appunti" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("appunti vuoti: lo dice con un avviso normale, senza scheda", async () => {
    const { engine, host } = mounted();
    press(buttonNamed(host, t("canvas.blank.paste")));
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(t("canvas.blank.paste_none")));
    expect(cardsOf(engine)).toHaveLength(0);
    expect(blankOf(host).hidden).toBe(false);
  });

  it("appunti negati dal sistema: lo dice con un avviso normale, non un errore", async () => {
    clipboard.read = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
    const { engine, host } = mounted();
    press(buttonNamed(host, t("canvas.blank.paste")));
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(t("canvas.blank.paste_denied")));
    expect(cardsOf(engine)).toHaveLength(0);
  });
});

describe("la sola lettura", () => {
  it("resta solo il testo, senza pulsanti, e tornano quando si può scrivere", () => {
    const { engine, host } = mounted();
    engine.setReadOnly(true);
    expect(blankOf(host).hidden).toBe(false);
    expect(linesOf(host)).toHaveLength(3);
    expect(actionsOf(host).hidden).toBe(true);
    engine.setReadOnly(false);
    expect(actionsOf(host).hidden).toBe(false);
  });
});

describe("il pezzo da solo", () => {
  it("chiusa la sua vita, i pulsanti non fanno più niente", () => {
    const lifetime = openLifetime();
    const write = vi.fn();
    const empty = createCanvasEmpty({ lifetime, write, receive: vi.fn(), addFiles: false });
    document.body.append(empty.element);
    empty.sync({ empty: true, editable: true });
    lifetime.close();
    press(empty.element.querySelector<HTMLButtonElement>("button")!);
    expect(write).not.toHaveBeenCalled();
  });

  it("dà le tre righe, e in sola lettura solo quelle", () => {
    const lifetime = openLifetime();
    const empty = createCanvasEmpty({ lifetime, write: vi.fn(), receive: vi.fn(), addFiles: true });
    document.body.append(empty.element);
    empty.sync({ empty: true, editable: false });
    expect(empty.element.hidden).toBe(false);
    expect(empty.element.querySelectorAll("button")).toHaveLength(3);
    expect(empty.element.querySelector<HTMLElement>(".canvas-blank-actions")!.hidden).toBe(true);
    lifetime.close();
  });
});

describe("transferOf: che cosa diventa una scheda", () => {
  it("il testo entra come testo; niente testo né immagini vuol dire niente", async () => {
    const data = await transferOf([clipboardText("uno")]);
    expect(data?.getData("text/plain")).toBe("uno");
    expect(await transferOf([])).toBeNull();
    expect(await transferOf([{ types: ["text/plain"], getType: async () => new Blob([""]) } as unknown as ClipboardEntry])).toBeNull();
  });

  it("un'immagine diventa un file, con il nome image.<tipo>", async () => {
    const png = { types: ["image/png"], getType: async () => new Blob(["png"], { type: "image/png" }) } as unknown as ClipboardEntry;
    const data = await transferOf([png]);
    expect(data).not.toBeNull();
    expect(data!.files).toHaveLength(1);
    expect(data!.files[0]!.name).toBe("image.png");
    expect(data!.files[0]!.type).toBe("image/png");
  });
});
