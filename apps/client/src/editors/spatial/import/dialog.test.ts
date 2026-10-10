// @vitest-environment happy-dom
//
// La finestra di «Importa disegno», sull'host finto: il file letto dal vault o
// dal disco, l'anteprima, il conto e il rapporto, il nome e la cartella, e il
// gesto che scrive — un nome occupato che prende il primo libero, il titolo
// del disegno, l'effetto che lo apre, gli errori che restano nella finestra.
// In happy-dom non c'è CSS né misura: si asserisce su *cosa* c'è.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeHost } from "../../../host/fake";
import type { ImportDialog } from "./dialog";

/// L'host finto, e il motivo con cui il disco rifiuta di scrivere; `null`
/// se scrive.
const box = vi.hoisted(() => ({ host: null as FakeHost | null, refuse: null as string | null }));

vi.mock("../../../host/ipc", () => ({
  api: new Proxy(
    {},
    {
      get: (_target, name: string) => (...args: unknown[]) => {
        if (!box.host) throw new Error("l'host finto non è stato montato");
        if (name === "resourceWrite" && box.refuse !== null) return Promise.reject(new Error(box.refuse));
        return (box.host.module.api as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!(...args);
      },
    },
  ),
}));

const { createFakeHost } = await import("../../../host/fake");
const { checkAccessibility, formatIssues } = await import("../../../ui/a11y-check");
const { setReducedMotionPreference } = await import("../../../theme/reduced-motion");
const { openImport } = await import("./dialog");

/// Un file di draw.io con una forma e un testo a mano.
const DRAWIO = [
  '<mxfile host="app.diagrams.net"><diagram name="Pagina" id="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>',
  '<mxCell id="a" value="Server" style="rounded=0;fontFamily=Comic Sans MS;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="120" height="60" as="geometry"/></mxCell>',
  '<mxCell id="b" value="" style="ellipse;" vertex="1" parent="1"><mxGeometry x="200" y="0" width="60" height="60" as="geometry"/></mxCell>',
  "</root></mxGraphModel></diagram></mxfile>",
].join("");

/// Una scena di Excalidraw con un rettangolo, senza niente che cambi.
const EXCALIDRAW = JSON.stringify({
  type: "excalidraw",
  version: 2,
  elements: [
    { type: "rectangle", id: "a", x: 0, y: 0, width: 100, height: 50, angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 0, opacity: 100, groupIds: [], roundness: null, isDeleted: false, locked: false, link: null, boundElements: null },
  ],
  appState: {},
  files: {},
});

/// Senza caratteri da incorporare: l'anteprima non aspetta i file dell'app.
const FONTS = { now: () => "", load: () => Promise.resolve("") };

const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>(".shell-dialog");
const nameInput = (): HTMLInputElement => document.querySelector<HTMLInputElement>(".draw-import-field input")!;
const folderInput = (): HTMLInputElement => document.querySelectorAll<HTMLInputElement>(".draw-import-field input")[1]!;
const alertBox = (): HTMLElement => document.querySelector<HTMLElement>(".draw-import-alert")!;
const submitButton = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>(".draw-import button[type=submit]")!;
const text = (selector: string): string | undefined => document.querySelector<HTMLElement>(selector)?.textContent ?? undefined;
const notes = (): string[] => [...document.querySelectorAll<HTMLElement>(".draw-import-note")].map((note) => note.textContent ?? "");

async function until(thing: string, cond: () => boolean, within = 4000): Promise<void> {
  const deadline = Date.now() + within;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`non è mai successo: ${thing}`);
}

function host() {
  return { onEffect: vi.fn(async () => {}), notify: vi.fn() };
}

let opened: ImportDialog | null = null;

function mount(file: Record<string, string> = {}): FakeHost {
  const fake = createFakeHost({ file });
  box.host = fake;
  return fake;
}

/// Apre la finestra su `from` e aspetta che il disegno sia pronto.
async function open(from: Parameters<typeof openImport>[0], shell = host()): Promise<ReturnType<typeof host>> {
  opened = openImport(from, shell, { fonts: FONTS, pictures: null });
  await opened.ready;
  return shell;
}

/// Importa, e aspetta che la finestra si chiuda o mostri un errore.
async function submit(): Promise<void> {
  document.querySelector<HTMLFormElement>(".draw-import-form")!.requestSubmit();
  await until("la finestra chiusa o un errore", () => dialog() === null || alertBox().textContent !== "");
}

/// Il titolo della radice di un disegno.
const titleOf = (svg: string | undefined): string | undefined => /<title>([^<]*)<\/title>/.exec(svg ?? "")?.[1];

/// Un file del disco, coi suoi byte.
const diskFile = (name: string, content: string): File => new File([content], name);

beforeEach(() => {
  document.body.innerHTML = "";
  vi.spyOn(navigator, "language", "get").mockReturnValue("it-IT");
  // Senza moto la finestra se ne va subito: i banchi non aspettano l'uscita.
  setReducedMotionPreference(true);
});

afterEach(async () => {
  opened?.close();
  opened = null;
  await until("la finestra chiusa", () => dialog() === null).catch(() => {});
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  setReducedMotionPreference(false);
  box.host = null;
  box.refuse = null;
});

describe("la finestra", () => {
  it("è un dialogo con nome, e il fuoco sta sul nome già scritto", async () => {
    mount({ "schemi/rete.drawio": DRAWIO });
    await open({ kind: "vault", path: "schemi/rete.drawio" });
    const root = dialog()!;
    expect(root.getAttribute("role")).toBe("dialog");
    expect(document.getElementById(root.getAttribute("aria-labelledby")!)?.textContent).toBe("Importa disegno");
    expect(document.activeElement).toBe(nameInput());
    expect(nameInput().value).toBe("rete");
    expect(folderInput().value).toBe("schemi");
  });

  it("mostra da dove viene, quanto c'è e che cosa cambia, con l'anteprima", async () => {
    mount({ "schemi/rete.drawio": DRAWIO });
    await open({ kind: "vault", path: "schemi/rete.drawio" });
    expect(text(".draw-import-from")).toBe("Da «schemi/rete.drawio», un disegno di draw.io.");
    expect(text(".draw-import-count")).toBe("2 forme");
    expect(notes()).toEqual(["Un testo scritto con un carattere a mano passa a Inter. Per esempio: «Comic Sans MS»."]);
    await until("l'anteprima", () => document.querySelector<HTMLImageElement>(".draw-import-image")?.src.startsWith("blob:") === true);
    expect(document.querySelector<HTMLImageElement>(".draw-import-image")!.alt).toBe("Anteprima del disegno importato");
    expect(submitButton().disabled).toBe(false);
  });

  it("dice che entra tutto quando non cambia niente", async () => {
    mount();
    await open({ kind: "file", file: diskFile("idea.excalidraw", EXCALIDRAW), folder: "" });
    expect(text(".draw-import-from")).toBe("Da «idea.excalidraw», un disegno di Excalidraw.");
    expect(text(".draw-import-report-none")).toBe("Entra tutto com’è.");
    expect(notes()).toEqual([]);
  });

  it("non ha niente che la tecnologia assistiva non possa nominare", async () => {
    mount({ "rete.drawio": DRAWIO });
    await open({ kind: "vault", path: "rete.drawio" });
    const issues = checkAccessibility(dialog()!);
    expect(issues, formatIssues(issues)).toEqual([]);
  });

  it("ce n'è una sola: un secondo gesto riporta il fuoco, e il nome scritto resta", async () => {
    mount({ "rete.drawio": DRAWIO });
    await open({ kind: "vault", path: "rete.drawio" });
    nameInput().value = "A metà";
    folderInput().focus();
    const again = openImport({ kind: "vault", path: "rete.drawio" }, host(), { fonts: FONTS, pictures: null });
    expect(again).toBe(opened);
    expect(document.querySelectorAll(".shell-dialog")).toHaveLength(1);
    expect(document.activeElement).toBe(nameInput());
    expect(nameInput().value).toBe("A metà");
  });
});

describe("l'importazione", () => {
  it("scrive il disegno accanto all'originale, che non cambia, e lo apre", async () => {
    const fake = mount({ "schemi/rete.drawio": DRAWIO });
    const shell = await open({ kind: "vault", path: "schemi/rete.drawio" });
    await submit();
    expect(dialog()).toBeNull();
    const files = fake.files();
    expect(files["schemi/rete.drawio"]).toBe(DRAWIO);
    expect(titleOf(files["schemi/rete.svg"])).toBe("rete");
    expect(files["schemi/rete.svg"]).toContain('fub:version="1"');
    expect(shell.onEffect).toHaveBeenCalledWith({ kind: "navigate", doc: "schemi/rete.svg" });
    expect(shell.notify).toHaveBeenCalledWith("Disegno importato in «schemi/rete.svg».", "info");
  });

  it("un nome occupato non si sovrascrive: il disegno prende il primo libero, e il titolo è quello", async () => {
    const fake = mount({ "rete.drawio": DRAWIO, "rete.svg": "<svg/>", "rete 1.svg": "<svg/>" });
    const shell = await open({ kind: "vault", path: "rete.drawio" });
    await submit();
    const files = fake.files();
    expect(files["rete.svg"]).toBe("<svg/>");
    expect(files["rete 1.svg"]).toBe("<svg/>");
    expect(titleOf(files["rete 2.svg"])).toBe("rete 2");
    expect(shell.onEffect).toHaveBeenCalledWith({ kind: "navigate", doc: "rete 2.svg" });
  });

  it("un file del disco va nella cartella da cui lo si è chiesto, col nome e la cartella scritti", async () => {
    const fake = mount();
    await open({ kind: "file", file: diskFile("idea.excalidraw.json", EXCALIDRAW), folder: "progetti" });
    expect(nameInput().value).toBe("idea");
    expect(folderInput().value).toBe("progetti");
    nameInput().value = " Lavagna.svg ";
    folderInput().value = "/progetti/2026/";
    await submit();
    expect(titleOf(fake.files()["progetti/2026/Lavagna.svg"])).toBe("Lavagna");
  });

  it("un nome con una barra è un percorso dalla radice; un nome vuoto è quello del file", async () => {
    const fake = mount({ "a.drawio": DRAWIO });
    await open({ kind: "vault", path: "a.drawio" });
    folderInput().value = "ignorata";
    nameInput().value = "altrove/Nuovo";
    await submit();
    expect(Object.keys(fake.files()).sort()).toEqual(["a.drawio", "altrove/Nuovo.svg"]);
    await open({ kind: "vault", path: "a.drawio" });
    nameInput().value = "  ";
    await submit();
    expect(fake.files()["a.svg"]).toBeDefined();
  });

  it("un nome che non va resta nella finestra, vicino al nome, e non scrive niente", async () => {
    const fake = mount({ "rete.drawio": DRAWIO });
    const shell = await open({ kind: "vault", path: "rete.drawio" });
    nameInput().value = "a:b";
    await submit();
    expect(dialog()).not.toBeNull();
    expect(alertBox().textContent).toBe("Il nome non va: contiene un carattere che un filesystem si riserva (< > : \" | ? * \\).");
    expect(nameInput().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(nameInput());
    expect(Object.keys(fake.files())).toEqual(["rete.drawio"]);
    expect(shell.onEffect).not.toHaveBeenCalled();
  });

  it("una scrittura che non riesce lo dice, e si può riprovare", async () => {
    const fake = mount({ "rete.drawio": DRAWIO });
    const shell = await open({ kind: "vault", path: "rete.drawio" });
    box.refuse = "disco pieno";
    await submit();
    expect(alertBox().textContent).toContain("Il disegno non si scrive:");
    expect(alertBox().textContent).toContain("disco pieno");
    expect(submitButton().disabled).toBe(false);
    expect(Object.keys(fake.files())).toEqual(["rete.drawio"]);
    box.refuse = null;
    alertBox().replaceChildren();
    await submit();
    expect(dialog()).toBeNull();
    expect(shell.onEffect).toHaveBeenCalledWith({ kind: "navigate", doc: "rete.svg" });
  });
});

describe("un file che non si importa", () => {
  it("lo dice, toglie il nome e «Importa», e lascia il fuoco su Annulla", async () => {
    mount({ "note.drawio": "non è un disegno" });
    await open({ kind: "vault", path: "note.drawio" });
    expect(alertBox().textContent).toBe("Questo file non è un disegno di Excalidraw né di draw.io.");
    expect(document.querySelector<HTMLElement>(".draw-import-fields")!.hidden).toBe(true);
    expect(submitButton().hidden).toBe(true);
    expect(document.activeElement?.textContent).toBe("Annulla");
  });

  it("un file vuoto, uno troppo grande, uno che il vault non dà", async () => {
    mount({ "vuoto.excalidraw": JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: {}, files: {} }) });
    await open({ kind: "vault", path: "vuoto.excalidraw" });
    expect(alertBox().textContent).toBe("Il file non ha niente da disegnare.");
    opened!.close();
    await until("la finestra chiusa", () => dialog() === null);

    const big = { name: "enorme.drawio", size: 64 * 1024 * 1024 + 1, arrayBuffer: () => Promise.reject(new Error("letto")) } as unknown as File;
    await open({ kind: "file", file: big, folder: "" });
    expect(alertBox().textContent).toBe("Il file è troppo grande da importare: il massimo è 64 MB.");
    opened!.close();
    await until("la finestra chiusa", () => dialog() === null);

    await open({ kind: "vault", path: "sparito.drawio" });
    expect(alertBox().textContent).toContain("Il file non si legge:");
  });
});
