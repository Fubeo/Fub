// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DraftInfo, SettingEntry, WriteBase } from "../host/contract";
import type { CraftPreview, CraftPreviewSize, CraftRenderConsent } from "../host/craft";
import type { FakeHost } from "../host/fake";
import { rejoinDrafts, type DraftBufferStore } from "../state/drafts";

vi.setConfig({ testTimeout: 20_000 });

/// L'host finto della shell, e ciò che `craft.preview` risponde per un PDF o
/// un documento: il fake conosce soltanto i file Craft, e la risposta di un
/// PdfCraft o di un WordCraft installati la scrive il test.
const box = vi.hoisted(() => ({
  host: null as FakeHost | null,
  consent: "ask" as "ask" | "on" | "off",
  /// L'app che farebbe l'anteprima, `null` se non è installata.
  app: "PdfCraft" as string | null,
  asks: [] as string[],
}));

vi.mock("../host/ipc", () => {
  const now = () => {
    if (!box.host) throw new Error("l'host finto non è stato montato");
    return box.host.module;
  };
  const appPreview = /\.(pdf|docx)$/i;
  return {
    api: new Proxy(
      {},
      {
        get: (_t, name: string) => (...args: unknown[]) => {
          if (name === "invokeCommand" && args[0] === "craft.preview") {
            const { doc, size } = args[1] as { doc: string; size: "small" | "large" };
            if (appPreview.test(doc)) {
              box.asks.push(doc);
              return Promise.resolve({
                notify: null,
                effect: { kind: "custom", ns: "fub.craft", payload: missingPreview(doc, size) },
                undo: null,
                partial: null,
              });
            }
          }
          return (now().api as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args);
        },
      },
    ),
    onKernelEvent: (handler: (n: unknown) => void) => now().onKernelEvent(handler as never),
    onClose: (first: () => Promise<boolean>, onFailure: (reason: unknown) => void) => now().onClose(first, onFailure),
    window: {
      minimize: async () => {},
      toggleMaximize: async () => {},
      close: async () => {},
      isMaximized: async () => false,
      setTitle: async () => {},
      onResize: async () => async () => {},
    },
  };

  /// Un'anteprima che manca, col consenso di adesso e l'app installata o no.
  function missingPreview(doc: string, size: "small" | "large") {
    const pdf = doc.toLowerCase().endsWith(".pdf");
    return {
      version: 2,
      doc,
      revision: "r1",
      size,
      origin: "none",
      queued: false,
      image: null,
      missing: "absent",
      limit_bytes: null,
      info: { app: pdf ? "pdf" : "document", editor: box.app, format_version: null, bytes: 4, photo: null, edits: [], xmp: null },
      render: box.app ? { app: box.app, consent: box.consent } : null,
    };
  }
});

vi.mock("../host/dialog", () => ({
  confirm: () => Promise.resolve(true),
  pickFolder: () => Promise.resolve("/vault"),
  pickFile: () => Promise.resolve(null),
}));

// pdf.js finto: una pagina che si rende senza disegnare niente.
vi.mock("pdfjs-dist/build/pdf.min.mjs", () => {
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    getTextContent: async () => ({ items: [] }),
  };
  return {
    version: "6.3.289",
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: () => ({
      promise: Promise.resolve({ numPages: 1, getPage: async () => page, destroy: async () => {} }),
      destroy: async () => {},
    }),
  };
});

// Il ricongiungimento è la parte pura del recupero: il contratto osservabile è
// quale testo diventa autorevole, con quale base e quante bozze rientrano.
describe("il ricongiungimento delle bozze orfane", () => {
  /// Una bozza come la manda il kernel: il documento, il testo, e la base da
  /// cui il buffer si era discostato — `null` quando chi l'ha scritto non la
  /// sapeva, che è il caso di una nota mai salvata.
  function draft(doc: string, text: string, base: string | null = null): DraftInfo {
    return { doc, at: 1, base, exists: true, current: base, text };
  }

  interface TestBuffer {
    dirty: boolean;
    text: string;
    base: WriteBase | null;
  }

  class TestStore implements DraftBufferStore {
    readonly buffers = new Map<string, TestBuffer>();

    constructor(entries: Array<[string, TestBuffer]> = []) {
      for (const [doc, buffer] of entries) this.buffers.set(doc, buffer);
    }

    get(doc: string): TestBuffer | undefined {
      return this.buffers.get(doc);
    }

    restore(doc: string, text: string, base: WriteBase | null): void {
      this.buffers.set(doc, { text, dirty: true, base });
    }
  }

  /// Un documento come lo lascia `read`: la copia sul disco, pulita.
  function clean(text: string): TestBuffer {
    return {
      text,
      dirty: false,
      base: { kind: "descends_from", value: "la revisione del disco" },
    };
  }

  it("fa rientrare la bozza sopra la copia pulita, e conta 1", () => {
    const buffer = new TestStore([["nota.md", clean("il testo sul disco")]]);

    const rejoined = rejoinDrafts(
      [draft("nota.md", "il testo non salvato", "la base della bozza")],
      buffer,
    );

    expect(rejoined, "una sola bozza in fila, una sola rientrata").toHaveLength(1);
    expect(rejoined[0].doc).toBe("nota.md");
    expect(buffer.buffers.get("nota.md")).toMatchObject({
      text: "il testo non salvato",
      dirty: true,
      base: { kind: "descends_from", value: "la base della bozza" },
    });
  });

  it("lascia intatto il buffer sporco, e conta 0", () => {
    const buffer = new TestStore([
      [
        "nota.md",
        {
          ...clean("il testo sul disco"),
          dirty: true,
          text: "scritto dopo, in questa sessione",
        },
      ],
    ]);

    const rejoined = rejoinDrafts(
      [draft("nota.md", "il testo non salvato", "la base della bozza")],
      buffer,
    );

    expect(rejoined).toHaveLength(0);
    expect(buffer.buffers.get("nota.md")).toMatchObject({
      text: "scritto dopo, in questa sessione",
      dirty: true,
    });
  });

  it("senza buffer la bozza di una nota mai salvata diventa il buffer, e detta", () => {
    const buffer = new TestStore();

    const rejoined = rejoinDrafts(
      [{ ...draft("nuova.md", "il testo non salvato"), exists: false }],
      buffer,
    );

    expect(rejoined).toHaveLength(1);
    expect(buffer.buffers.get("nuova.md")).toMatchObject({
      text: "il testo non salvato",
      dirty: true,
      base: { kind: "dictated" },
    });
  });

  it("una bozza incerta su un file che c'è non detta: rientra senza base", () => {
    const buffer = new TestStore([["nota.md", clean("il testo sul disco")]]);

    const rejoined = rejoinDrafts(
      [{ ...draft("nota.md", "il testo non salvato"), current: "la revisione del disco" }],
      buffer,
    );

    expect(rejoined).toHaveLength(1);
    expect(buffer.buffers.get("nota.md")).toMatchObject({
      text: "il testo non salvato",
      dirty: true,
      base: null,
    });
  });

  it("il rientro è uno solo per documento, anche se la fila lo nomina due volte", () => {
    const buffer = new TestStore();

    const rejoined = rejoinDrafts(
      [
        draft("nota.md", "il testo più recente", "base-2"),
        draft("nota.md", "il testo più vecchio", "base-1"),
      ],
      buffer,
    );

    expect(rejoined).toHaveLength(1);
    expect(buffer.buffers.get("nota.md")).toMatchObject({ text: "il testo più recente" });
  });
});

// La domanda sulle anteprime fatte dalle app nella riga d'avviso della scheda
// di un PDF o di un documento (T31), e il gesto che le fa fare: sulla shell
// vera, contro l'host finto.
const CONSENT = "craft.cli-previews";
const GUIDA = "Manuali/guida.pdf";
const FOTO = "Foto/mare.png";
/// Un PNG di un pixel: l'immagine ha una modalità sola.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="),
  (c) => c.charCodeAt(0),
);

const consentSetting = (value: CraftRenderConsent): SettingEntry => ({
  spec: {
    key: CONSENT,
    label: "Anteprime fatte dalle app",
    description: "",
    group: "App esterne",
    scope: "machine",
    kind: {
      kind: "choice",
      default: "ask",
      options: [
        { value: "ask", label: "Chiedi" },
        { value: "on", label: "Accese" },
        { value: "off", label: "Spente" },
      ],
    },
    program_writable: false,
  },
  value,
  source: value === "ask" ? "default" : "machine",
}) as SettingEntry;

function rich(text: string): string {
  return JSON.stringify({
    format: "fub-rich",
    version: 1,
    blocks: [{ t: "para", role: { kind: "body" }, c: [{ t: "text", x: text }] }],
  });
}

let activeStop: (() => void) | null = null;

async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

async function waitFor(thing: string, cond: () => boolean, within = 3000): Promise<void> {
  const deadline = Date.now() + within;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`non è mai successo: ${thing}`);
}

/// La shell vera col PDF e un Word nel vault, il consenso `consent`, e
/// `craft_render` che risponde «in coda» come il backend.
async function start(
  consent: CraftRenderConsent,
  app: string | null = "PdfCraft",
  more: Record<string, string> = {},
): Promise<FakeHost> {
  vi.resetModules();
  box.consent = consent;
  box.app = app;
  box.asks = [];
  const craftRender = async (doc: string, size: CraftPreviewSize): Promise<CraftPreview> => ({
    version: 2,
    doc,
    revision: "r1",
    size,
    origin: "none",
    queued: true,
    image: null,
    missing: "absent",
    limit_bytes: null,
    info: { app: "pdf", editor: "PdfCraft", format_version: null, bytes: 4, photo: null, edits: [], xmp: null },
    render: { app: "PdfCraft", consent: box.consent },
  });
  const host = createFakeHost({
    file: { "Benvenuto.md": "# Benvenuto\n", "Lettera.docx": rich("ciao"), ...more },
    resources: {
      [GUIDA]: { bytes: new TextEncoder().encode("test"), mime: "application/pdf" },
      [FOTO]: { bytes: PNG, mime: "image/png" },
    },
    craft: { docs: {} },
    craftRender,
    settings: [consentSetting(consent)],
  });
  const api = host.module.api as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const write = api.setSetting!;
  // L'host vero legge l'impostazione a ogni `craft.preview`: anche il finto.
  api.setSetting = (key: unknown, value: unknown) => {
    if (key === CONSENT) box.consent = value as CraftRenderConsent;
    return write(key, value);
  };
  box.host = host;
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(rawHtml);
  if (!body) throw new Error("index.html non ha un body");
  document.body.innerHTML = body[1].replace(/<script[\s\S]*?<\/script>/g, "");
  const main = await import("../main");
  activeStop = await main.startup;
  await settle();
  return host;
}

async function open(doc: string, gesture = false): Promise<void> {
  const { openDocument } = await import("./document");
  await openDocument(doc, gesture ? { gesture: true } : {});
  await settle();
}

const { createFakeHost } = await import("../host/fake");
const rawHtml = (await import("../../index.html?raw")).default;

const visible = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)].filter((row) => !row.closest("[hidden]"));
const consentRows = () => visible('.sheet-notice[data-notice="craft_consent"]');
const buttonsOf = (row: HTMLElement) => [...row.querySelectorAll<HTMLButtonElement>("button")];
const renders = (host: FakeHost) => host.atGate("craftRender").map((call) => call.args);
const saves = (host: FakeHost) => host.atGate("setSetting").map((call) => call.args);

describe("la domanda sulle anteprime nella riga d'avviso (T31)", () => {
  beforeEach(() => {
    activeStop?.();
    activeStop = null;
    document.body.innerHTML = "";
    localStorage.clear();
  });

  afterEach(async () => {
    const lend = await import("../state/lend");
    lend.forgetLends();
  });

  it("col consenso da chiedere: la riga informativa con due azioni, ognuna un pulsante", async () => {
    const host = await start("ask");
    await open(GUIDA);
    await waitFor("la riga della domanda", () => consentRows().length === 1);
    const row = consentRows()[0]!;
    expect(row.dataset.tone).toBe("info");
    expect(row.querySelector(".sheet-notice-text")!.textContent).toBe(
      "Fub può far fare l'anteprima di questo file a PdfCraft, che lavora su una copia. Accendo le anteprime fatte dalle app?",
    );
    const buttons = buttonsOf(row);
    expect(buttons.map((b) => b.textContent)).toEqual(["Sì, accendi", "No, lasciale spente"]);
    // Un pulsante vero: Invio e Spazio sono il suo clic, una volta ciascuno.
    expect(buttons.every((b) => b.tagName === "BUTTON" && b.type === "button" && b.classList.contains("link-button"))).toBe(true);
    expect(renders(host)).toEqual([]);
  });

  it("«Sì» salva il consenso acceso, chiede l'anteprima una volta, e la riga se ne va", async () => {
    const host = await start("ask");
    await open(GUIDA);
    await waitFor("la riga della domanda", () => consentRows().length === 1);
    const yes = buttonsOf(consentRows()[0]!)[0]!;
    yes.click();
    yes.click();
    await waitFor("l'anteprima chiesta", () => renders(host).length === 1);
    await waitFor("la riga se ne va", () => consentRows().length === 0);
    await settle();
    expect(saves(host)).toEqual([[CONSENT, "on"]]);
    expect(renders(host)).toEqual([[GUIDA, "small"]]);
  });

  it("«No» salva il consenso spento, non chiede niente, e la riga se ne va", async () => {
    const host = await start("ask");
    await open(GUIDA);
    await waitFor("la riga della domanda", () => consentRows().length === 1);
    buttonsOf(consentRows()[0]!)[1]!.click();
    await waitFor("la riga se ne va", () => consentRows().length === 0);
    await settle();
    expect(saves(host)).toEqual([[CONSENT, "off"]]);
    expect(renders(host)).toEqual([]);
  });

  it("in due riquadri: una domanda, la riga in tutti e due, e la risposta in uno la toglie dall'altro", async () => {
    const host = await start("ask");
    await open(GUIDA);
    const { openDocumentBeside } = await import("./document");
    await openDocumentBeside(GUIDA, "row");
    await settle();
    await waitFor("due righe della domanda", () => consentRows().length === 2);
    expect(box.asks.filter((doc) => doc === GUIDA)).toHaveLength(1);
    buttonsOf(consentRows()[1]!)[1]!.click();
    await waitFor("tutte e due le righe se ne vanno", () => consentRows().length === 0);
    expect(saves(host)).toEqual([[CONSENT, "off"]]);
  });

  it("il consenso cambiato altrove toglie la riga", async () => {
    const host = await start("ask");
    await open(GUIDA);
    await waitFor("la riga della domanda", () => consentRows().length === 1);
    box.consent = "on";
    host.emit({ type: "setting_changed", key: CONSENT, scope: "machine" });
    await waitFor("la riga se ne va", () => consentRows().length === 0);
    expect(renders(host)).toEqual([]);
  });

  it("senza l'app che la farebbe, o col consenso deciso: nessuna riga", async () => {
    await start("ask", null);
    await open(GUIDA);
    await waitFor("la domanda a craft.preview", () => box.asks.length > 0);
    await settle();
    await settle();
    expect(consentRows()).toHaveLength(0);

    await start("off");
    await open(GUIDA);
    await waitFor("la domanda a craft.preview", () => box.asks.length > 0);
    await settle();
    await settle();
    expect(consentRows()).toHaveLength(0);
  });

  it("le righe di sempre restano uguali: il prestito e la domanda fanno due righe, ognuna con le sue azioni", async () => {
    await start("ask", "WordCraft");
    await open("Lettera.docx");
    await waitFor("la riga della domanda", () => consentRows().length === 1);
    const lend = await import("../state/lend");
    lend.lend("Lettera.docx", "WordCraft");
    await waitFor("la riga del prestito", () => visible('.sheet-notice[data-notice="lent"]').length === 1);
    const lent = visible('.sheet-notice[data-notice="lent"]')[0]!;
    expect(buttonsOf(lent).map((b) => b.textContent)).toEqual(["Riprendi qui"]);
    const rows = visible(".sheet-notice").map((row) => row.dataset.notice);
    expect(rows).toEqual(["lent", "craft_consent"]);
    expect(buttonsOf(consentRows()[0]!).map((b) => b.textContent)).toEqual(["Sì, accendi", "No, lasciale spente"]);
    expect(consentRows()[0]!.querySelector(".sheet-notice-text")!.textContent).toContain("WordCraft");
    buttonsOf(lent)[0]!.click();
    await waitFor("il prestito finisce", () => visible('.sheet-notice[data-notice="lent"]').length === 0);
    expect(consentRows()).toHaveLength(1);
  });
});

describe("il gesto che apre un PDF fa fare l'anteprima (T31)", () => {
  beforeEach(() => {
    activeStop?.();
    activeStop = null;
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("aperto con il gesto e il consenso acceso: craft_render una volta, piccola", async () => {
    const host = await start("on");
    await open(GUIDA, true);
    await waitFor("l'anteprima chiesta", () => renders(host).length === 1);
    await settle();
    expect(renders(host)).toEqual([[GUIDA, "small"]]);
    expect(consentRows()).toHaveLength(0);
    // Lo stesso PDF riaperto col gesto, dove la scheda c'è già: niente.
    await open(GUIDA, true);
    await settle();
    expect(renders(host)).toHaveLength(1);
  });

  it("senza gesto, o da una scheda riaperta: zero", async () => {
    const host = await start("on");
    await open(GUIDA);
    await waitFor("la domanda a craft.preview", () => box.asks.length > 0);
    await open(GUIDA, true);
    await settle();
    await settle();
    expect(renders(host)).toEqual([]);
  });

  it("col consenso da chiedere il gesto non avvia l'app: c'è la riga", async () => {
    const host = await start("ask");
    await open(GUIDA, true);
    await waitFor("la riga della domanda", () => consentRows().length === 1);
    expect(renders(host)).toEqual([]);
  });
});

// Ciò che le fasi dopo spostano (la modalità, la testata) e non deve cambiare
// di significato: fissato qui prima di toccarlo (Scrittoio 2, T1).
describe("la testata del riquadro, prima di Scrittoio 2", () => {
  const NOTA = "Progetti/Fub/Diario.md";
  const panes = () => [...document.querySelectorAll<HTMLElement>(".pane")];
  const toolbarOf = (pane: HTMLElement) => pane.querySelector<HTMLElement>(".pane-toolbar")!;
  const currentOf = (pane: HTMLElement) => toolbarOf(pane).querySelector<HTMLButtonElement>(":scope > .pane-mode-current")!;
  const radios = () => [...document.querySelectorAll<HTMLElement>("#context-menu [role=menuitemradio]")];
  const labelOf = (item: Element) => item.querySelector(".menu-label")?.textContent ?? "";

  beforeEach(() => {
    activeStop?.();
    activeStop = null;
    document.body.innerHTML = "";
    localStorage.clear();
  });

  afterEach(async () => {
    const menu = await import("../ui/menu");
    menu.closeContextMenu();
  });

  it("il bottone della modalità elenca le modalità della superficie e ne segna una sola", async () => {
    await start("off", null, { [NOTA]: "# Diario\n\nUna riga.\n" });
    await open(NOTA);
    const { t } = await import("../i18n/strings");
    const pane = panes()[0]!;
    const current = currentOf(pane);
    expect(current.hidden).toBe(false);
    expect(current.getAttribute("aria-haspopup")).toBe("menu");
    current.click();
    await settle();
    expect(current.getAttribute("aria-expanded")).toBe("true");
    // L'ordine non si fissa: Scrittoio 2 (T2) lo cambia.
    expect(new Set(radios().map(labelOf))).toEqual(new Set(["Live", "Blocchi", "Sorgente", "Lettura"]));
    const checked = radios().filter((item) => item.getAttribute("aria-checked") === "true");
    expect(checked.map(labelOf)).toEqual(["Live"]);
    expect(current.getAttribute("aria-label")).toBe(t("document.toolbar.mode_current", { mode: "Live" }));
  });

  it("la voce scelta cambia la modalità del suo riquadro, non quella dell'altro", async () => {
    await start("off", null, { [NOTA]: "# Diario\n\nUna riga.\n" });
    await open(NOTA);
    const { openDocumentBeside } = await import("./document");
    await openDocumentBeside("Benvenuto.md", "row");
    await settle();
    await waitFor("due riquadri con la nota", () => panes().length === 2 && panes().every((p) => p.dataset.mode === "live_preview"));
    const [left, right] = panes();
    // Il menu del riquadro **senza** fuoco: il clic lo porta a fuoco e cambia lui.
    const layout = await import("../state/layout");
    expect(layout.layout.focus).toBe(right!.dataset.pane);
    // Come il clic vero in Chromium e WebKitGTK: il bottone prende il fuoco
    // prima del clic, e il menu, chiudendosi, glielo rende.
    currentOf(left!).focus();
    currentOf(left!).click();
    expect(layout.layout.focus).toBe(left!.dataset.pane);
    await settle();
    radios().find((item) => labelOf(item) === "Sorgente")!.click();
    await waitFor("il riquadro di sinistra in Sorgente", () => left!.dataset.mode === "source");
    expect(right!.dataset.mode).toBe("live_preview");
    expect(currentOf(left!).getAttribute("aria-expanded")).toBe("false");
    expect(currentOf(left!).textContent).toBe("Sorgente");
    expect(currentOf(right!).textContent).toBe("Live");
  });

  it("le briciole: le cartelle con `data-folder`, poi il nome", async () => {
    await start("off", null, { [NOTA]: "# Diario\n" });
    await open(NOTA);
    const crumbs = toolbarOf(panes()[0]!).querySelector<HTMLElement>(":scope > .muted")!;
    expect(crumbs.dataset.path).toBe(NOTA);
    expect([...crumbs.querySelectorAll<HTMLElement>("[data-folder]")].map((f) => [f.dataset.folder, f.textContent])).toEqual([
      ["Progetti", "Progetti"],
      ["Progetti/Fub", "Fub"],
    ]);
    expect(crumbs.lastChild?.textContent).toBe("Diario.md");
    expect(crumbs.textContent).toBe(NOTA);
    // Una nota alla radice non ha cartelle.
    await open("Benvenuto.md");
    expect(crumbs.querySelectorAll("[data-folder]")).toHaveLength(0);
    expect(crumbs.textContent).toBe("Benvenuto.md");
  });

  it("il menu «…» di una nota ha le voci di oggi", async () => {
    await start("off", null, { [NOTA]: "# Diario\n" });
    await open(NOTA);
    const { t } = await import("../i18n/strings");
    const menu = toolbarOf(panes()[0]!).querySelector<HTMLButtonElement>("[data-pane-menu]")!;
    expect(menu.textContent).toBe("…");
    expect(menu.getAttribute("aria-label")).toBe(t("document.pane.menu"));
    menu.click();
    await settle();
    expect([...document.querySelectorAll("#context-menu .menu-label")].map((l) => l.textContent)).toEqual([
      t("pane.menu.split_right"),
      t("pane.menu.split_down"),
      t("pane.print"),
      t("pane.slides"),
      t("pane.recorder.open"),
      t("pane.menu.close_tab"),
      t("pane.menu.close_pane"),
    ]);
  });

  it("una superficie con una modalità sola non ha il bottone, e un riquadro vuoto nemmeno", async () => {
    await start("off", null);
    await open(FOTO);
    const pane = panes()[0]!;
    await waitFor("l'immagine montata", () => pane.dataset.mode !== undefined && currentOf(pane).hidden);
    expect(toolbarOf(pane).querySelector<HTMLElement>(":scope > .segmented")!.hidden).toBe(true);
    const registry = await import("../ui/commands");
    // Si chiudono l'immagine e la nota di benvenuto: il riquadro resta vuoto.
    const close = registry.allCommands().find((entry) => entry.id === "shell.tab.close")!;
    for (let i = 0; i < 4 && toolbarOf(pane).querySelector(":scope > .muted")!.textContent !== ""; i += 1) {
      await close.run!();
      await settle();
    }
    expect(toolbarOf(pane).querySelector(":scope > .muted")!.textContent).toBe("");
    expect(currentOf(pane).hidden).toBe(true);
    expect(toolbarOf(pane).querySelector<HTMLElement>(":scope > .pane-nav")!.hidden).toBe(true);
  });
});
