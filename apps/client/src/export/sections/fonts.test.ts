// @vitest-environment happy-dom
// La sezione Caratteri dello spazio «Esporta in PDF» (T72), nello spazio
// vero: i caratteri di Fub e del vault, il permesso d'incorporarli, un
// carattere senza corsivo, i cursori dal vivo, la sillabazione.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderedDocument } from "../../host/contract";
import { printBlocks } from "../paginate/measure";
import type { BlockSource, Scheduler } from "../paginate/slices";
import { defaultProfile, type ExportProfile } from "../profile";
import { openExportSpace, type ExportSpace } from "../space";
import { PRINT_FONTS, typeVariables } from "../themes";
import { faceRules, vaultFamilyName, type VaultFont, type VaultFontList, type VaultFontSource } from "./fonts";

const NOW: Scheduler = {
  now: () => 0,
  soon(task) {
    queueMicrotask(task);
    return () => {};
  },
  idle(task) {
    queueMicrotask(task);
    return () => {};
  },
};

function fakeMeasure(page: HTMLElement): BlockSource {
  const blocks = printBlocks(page);
  return {
    count: blocks.length,
    measure(index) {
      const top = index * 230;
      return { box: { kind: "paragraph", id: `blocco:${index}`, lines: Array.from({ length: 10 }, () => 22) }, top, bottom: top + 220, exact: true };
    },
  };
}

const NOTE = { html: "<h2>Uno</h2><p>Testo</p><h3>Due</h3><p>Altro</p>", parts: [] } as unknown as RenderedDocument;

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

const face = (file: string, corsivo: boolean, pesi: [number, number] = [100, 800], incorporabile = true) => ({ file, corsivo, pesi, incorporabile }) as const;

const APERTA: VaultFont = {
  famiglia: "Aperta",
  file: "Caratteri/Aperta.ttf",
  facce: [face("Caratteri/Aperta-Corsivo.ttf", true), face("Caratteri/Aperta.ttf", false)],
  corsivo: true,
  incorporabile: true,
};
const DIRITTA: VaultFont = { famiglia: "Diritta", file: "Caratteri/Diritta Nuova.woff2", facce: [face("Caratteri/Diritta Nuova.woff2", false, [400, 400])], corsivo: false, incorporabile: true };
const RISERVATA: VaultFont = { famiglia: "Riservata", file: "Caratteri/Riservata.otf", facce: [face("Caratteri/Riservata.otf", false, [400, 400], false)], corsivo: false, incorporabile: false };
const LIST: VaultFontList = { caratteri: [APERTA, DIRITTA, RISERVATA], illeggibili: ["Caratteri/Rotto.otf"], tralasciati: 0 };

class FakeFace {
  constructor(
    readonly family: string,
    readonly source: ArrayBuffer,
    readonly descriptors: FontFaceDescriptors,
  ) {}
  load() {
    return Promise.resolve(this);
  }
}

let app: HTMLElement;
let space: ExportSpace;
let added: Set<FakeFace>;
let reads: string[];

function source(list: () => Promise<VaultFontList> = () => Promise.resolve(LIST)): VaultFontSource {
  return {
    list,
    read: async (file) => {
      reads.push(file);
      return new Uint8Array([0, 1, 0, 0]);
    },
  };
}

async function open(options: { profile?: ExportProfile; vaultFonts?: VaultFontSource | null } = {}): Promise<void> {
  space = openExportSpace({
    doc: "nota.md",
    title: "Nota",
    render: async () => NOTE,
    container: app,
    behind: [],
    scheduler: NOW,
    measure: fakeMeasure,
    waitMs: 10,
    profile: options.profile,
    ...(options.vaultFonts === null ? {} : { vaultFonts: options.vaultFonts ?? source() }),
  });
  await settle();
  space.openSection("caratteri");
  await settle();
}

beforeEach(() => {
  app = document.createElement("div");
  app.id = "app";
  document.body.append(app);
  added = new Set();
  reads = [];
  vi.stubGlobal("FontFace", FakeFace);
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { add: (f: FakeFace) => added.add(f), delete: (f: FakeFace) => added.delete(f), check: () => true },
  });
});

afterEach(() => {
  space.close();
  app.remove();
  document.querySelectorAll(".print-host, .export-measure").forEach((node) => node.remove());
  vi.unstubAllGlobals();
  delete (document as { fonts?: unknown }).fonts;
  vi.restoreAllMocks();
});

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => space.element.querySelector<T>(selector)!;
const variable = (name: string) => $(".export-doc").style.getPropertyValue(name);
const summary = () => $('.export-section[data-section="caratteri"] .export-section-summary').textContent;
const labels = (role: string) => [...space.element.querySelectorAll<HTMLButtonElement>(`[id^="export-font-${role}-"]`)].map((b) => b.textContent);
const checked = (role: string) => [...space.element.querySelectorAll<HTMLButtonElement>(`[id^="export-font-${role}-"][aria-checked="true"]`)].map((b) => b.textContent);
const status = () => $("#export-fonts-status").textContent ?? "";

describe("i caratteri di Fub", () => {
  it("il testo e i titoli coi caratteri che Fub porta con sé, ognuno scritto nel suo; Plex solo per i titoli", async () => {
    await open();
    expect(labels("testo").slice(0, 4)).toEqual(["Newsreader", "Literata", "Hanken", "Inter"]);
    expect(labels("titoli").slice(0, 5)).toEqual(["Newsreader", "Literata", "Hanken", "Inter", "IBM"]);
    expect(checked("testo")).toEqual(["Newsreader"]);
    expect(checked("titoli")).toEqual(["Hanken"]);
    expect($("#export-font-testo-literata").style.fontFamily).toContain("Literata Variable");
    expect(summary()).toBe("Newsreader · 11 pt");
  });

  it("un clic sceglie il carattere: le pagine lo usano e la testa lo dice", async () => {
    await open();
    $("#export-font-testo-literata").click();
    expect(space.profile.testo.carattere_testo).toBe("literata");
    expect(variable("--font-reading")).toBe(PRINT_FONTS.literata.stack);
    expect(summary()).toBe("Literata · 11 pt");
    expect(document.activeElement?.id ?? "").not.toBe("export-font-testo-literata-x");
  });

  it("un profilo di prima con Georgia o Palatino si legge in Literata, che il PDF incorpora", () => {
    const old = { ...defaultProfile(), testo: { sillabazione: true, carattere_testo: "georgia", carattere_titoli: "palatino" } };
    expect(typeVariables(old)["--font-reading"]).toBe(PRINT_FONTS.literata.stack);
    expect(typeVariables(old)["--print-font-headings"]).toBe(PRINT_FONTS.literata.stack);
  });

  it("il corpo si trascina dal vivo: cambiano le pagine, non il pannello; al rilascio si ridisegna", async () => {
    await open();
    const input = $<HTMLInputElement>("#export-fonts-size");
    input.value = "12.5";
    input.dispatchEvent(new Event("input"));
    expect(variable("--text-reading")).toBe(`${Math.round(((12.5 * 96) / 72) * 1000) / 1000}px`);
    expect(input.isConnected).toBe(true);
    expect(input.parentElement?.querySelector("output")?.textContent).toBe("12,5 pt");
    input.dispatchEvent(new Event("change"));
    expect(summary()).toBe("Newsreader · 12,5 pt");
    expect(input.isConnected).toBe(false);
  });

  it("i paragrafi col rientro, i titoli al centro, il giustificato, i titoli numerati", async () => {
    await open();
    $("#export-fonts-paragraphs-rientro").click();
    $("#export-fonts-heading-align-centro").click();
    $("#export-fonts-justify").click();
    $("#export-fonts-numbered").click();
    expect(space.profile.testo).toMatchObject({ paragrafi: "rientro", allineamento_titoli: "centro", giustificato: true, titoli_numerati: true });
    expect(variable("--print-indent")).toBe("1.5em");
    expect(variable("--print-heading-align")).toBe("center");
    expect(variable("--print-text-align")).toBe("justify");
    expect(variable("--print-heading-numbers")).toBe("inline");
    expect($("#export-fonts-justify").getAttribute("aria-checked")).toBe("true");
  });

  it("la sillabazione si spegne e si riaccende, e non è del tema", async () => {
    await open();
    expect(variable("--print-hyphens")).toBe("auto");
    $("#export-fonts-hyphens").click();
    expect(space.profile.testo.sillabazione).toBe(false);
    expect(variable("--print-hyphens")).toBe("manual");
  });
});

describe("i caratteri del vault", () => {
  it("vengono dopo quelli di Fub, col file rotto detto sotto", async () => {
    await open();
    expect(labels("testo")).toEqual(["Newsreader", "Literata", "Hanken", "Inter", "Aperta", "Diritta", "Riservata"]);
    expect(status()).toContain("Un file di caratteri del vault non si legge: Caratteri/Rotto.otf.");
    const closed = $('[id^="export-font-testo-"][data-vault="Caratteri/Riservata.otf"]');
    expect(closed.classList.contains("is-closed")).toBe(true);
    expect(closed.getAttribute("aria-disabled")).toBe("true");
    // Quelli che si lasciano incorporare si caricano per mostrarsi nel loro
    // carattere; quello chiuso no.
    expect(reads).not.toContain("Caratteri/Riservata.otf");
    expect($('[id^="export-font-testo-"][data-vault="Caratteri/Aperta.ttf"]').style.fontFamily).toContain(vaultFamilyName("Caratteri/Aperta.ttf"));
  });

  it("uno che la licenza non lascia incorporare non si sceglie: l'avviso lo dice e il testo resta in quello di Fub", async () => {
    await open();
    const before = space.profile;
    $('[id^="export-font-testo-"][data-vault="Caratteri/Riservata.otf"]').click();
    await settle();
    expect(space.profile).toBe(before);
    expect(status()).toContain("«Riservata» non si lascia incorporare nel PDF, lo vieta la sua licenza: il testo resta in Newsreader.");
    expect(variable("--font-reading")).toBe(PRINT_FONTS.newsreader.stack);
  });

  it("un profilo che lo nomina già lo mostra col carattere del tema, e lo dice", async () => {
    await open({ profile: { ...defaultProfile(), testo: { sillabazione: true, carattere_testo: "Caratteri/Riservata.otf" } } });
    expect(variable("--font-reading")).toBe(PRINT_FONTS.newsreader.stack);
    expect(status()).toContain("«Riservata» non si lascia incorporare nel PDF");
  });

  it("uno scelto si carica, le pagine lo usano col carattere del tema dietro e la sonda ne riceve le facce", async () => {
    const write = vi.fn(async () => {});
    space = openExportSpace({ doc: "nota.md", title: "Nota", render: async () => NOTE, container: app, behind: [], scheduler: NOW, measure: fakeMeasure, waitMs: 10, vaultFonts: source(), exportPdf: write });
    await settle();
    space.openSection("caratteri");
    await settle();
    $('[id^="export-font-titoli-"][data-vault="Caratteri/Aperta.ttf"]').click();
    await settle();
    expect(space.profile.testo.carattere_titoli).toBe("Caratteri/Aperta.ttf");
    const family = vaultFamilyName("Caratteri/Aperta.ttf");
    expect(variable("--print-font-headings")).toBe(`"${family}", ${PRINT_FONTS.hanken.stack}`);
    expect(checked("titoli")).toEqual(["Aperta"]);
    expect([...added].filter((f) => f.family === family).map((f) => f.descriptors.style).sort()).toEqual(["italic", "normal"]);
    space.element.querySelector<HTMLButtonElement>(".export-go")?.click();
    await settle();
    const faces = (write.mock.calls[0] as unknown as [ExportProfile, { fontFaces: string[] }])[1].fontFaces;
    expect(faces.some((css) => css.includes(`font-family: "${family}"`) && css.includes('url("/Caratteri/Aperta-Corsivo.ttf")') && css.includes("font-style: italic"))).toBe(true);
    expect(faces.some((css) => css.includes('url("/Caratteri/Diritta%20Nuova.woff2")'))).toBe(true);
  });

  it("uno senza corsivo lo dice, e il suo tondo fa anche da corsivo: il browser non inventa un obliquo che il PDF non avrebbe", async () => {
    await open();
    $('[id^="export-font-testo-"][data-vault="Caratteri/Diritta Nuova.woff2"]').click();
    await settle();
    expect(space.profile.testo.carattere_testo).toBe("Caratteri/Diritta Nuova.woff2");
    expect(status()).toContain("«Diritta» non ha il corsivo: il corsivo esce diritto, sulle pagine e nel PDF.");
    const family = vaultFamilyName("Caratteri/Diritta Nuova.woff2");
    const styles = [...added].filter((f) => f.family === family).map((f) => [f.descriptors.style, f.descriptors.weight]);
    expect(styles).toEqual([["normal", "1 1000"], ["italic", "1 1000"]]);
  });

  it("uno che non c'è più: il testo resta nel carattere del tema, e la frase lo dice", async () => {
    await open({ profile: { ...defaultProfile(), testo: { sillabazione: true, carattere_testo: "Vecchi/Sparito.ttf" } } });
    expect(variable("--font-reading")).toBe(PRINT_FONTS.newsreader.stack);
    expect(status()).toContain("«Sparito» non c'è più nel vault: il testo resta in Newsreader.");
    expect(summary()).toBe("Sparito · 11 pt");
  });

  it("un elenco che non arriva lo dice, e restano quelli di Fub", async () => {
    await open({ vaultFonts: source(() => Promise.reject({ kind: "unknown_command", message: "pdf.vault_fonts" })) });
    expect(status()).toMatch(/^I caratteri del vault non si leggono \(.+\): restano quelli di Fub\.$/u);
    expect(labels("testo")).toEqual(["Newsreader", "Literata", "Hanken", "Inter"]);
  });

  it("un vault senza caratteri dice come aggiungerne uno", async () => {
    await open({ vaultFonts: source(() => Promise.resolve({ caratteri: [], illeggibili: [], tralasciati: 0 })) });
    expect(status()).toBe("Per usare un carattere tuo, metti nel vault un file .ttf, .otf, .woff o .woff2.");
  });

  it("chiuso lo spazio, le facce caricate se ne vanno", async () => {
    await open();
    expect(added.size).toBeGreaterThan(0);
    space.close();
    expect(added.size).toBe(0);
    space = openExportSpace({ doc: "nota.md", title: "Nota", render: async () => NOTE, container: app, behind: [], scheduler: NOW, measure: fakeMeasure, waitMs: 10 });
  });
});

describe("le facce di una famiglia", () => {
  it("dividono i pesi da 1 a 1000 attorno ai loro, per stile", () => {
    const font: VaultFont = {
      famiglia: "Statica",
      file: "S/Regular.otf",
      facce: [face("S/Bold.otf", false, [700, 700]), face("S/Regular.otf", false, [400, 400]), face("S/Light.otf", false, [300, 300]), face("S/Italic.otf", true, [400, 400])],
      corsivo: true,
      incorporabile: true,
    };
    expect(faceRules(font)).toEqual([
      { file: "S/Light.otf", style: "normal", weight: [1, 350] },
      { file: "S/Regular.otf", style: "normal", weight: [351, 550] },
      { file: "S/Bold.otf", style: "normal", weight: [551, 1000] },
      { file: "S/Italic.otf", style: "italic", weight: [1, 1000] },
    ]);
  });
});
