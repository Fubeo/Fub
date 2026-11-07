// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DraftInfo, SettingEntry, WriteBase } from "../host/contract";
import type { CraftPreview, CraftPreviewSize, CraftRenderConsent } from "../host/craft";
import type { FakeHost } from "../host/fake";
import { rejoinDrafts, type DraftBufferStore } from "../state/drafts";
import { appendToTextEditor, mountedTextEditors } from "../editors/text/test-support";

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
  /// Il testo della versione che il ripristino della cronologia riscrive,
  /// per nota (#237 R02): `version.restore` sul finto.
  versions: new Map<string, string>(),
  restoring: false,
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
          // La cronologia sul finto: «Ripristina» chiede, «Sì» riscrive la
          // nota con la versione scelta, come `version.restore` fa sul disco.
          if (name === "viewAction" && args[0] === "history") {
            box.host!.calls.push({ gate: "viewAction", args });
            const [, , , action, payload] = args as [string, string, unknown, string, { doc: string }];
            if (action === "restore_confirm") {
              const text = box.versions.get(payload.doc);
              if (text === undefined) return Promise.reject(new Error(`nessuna versione di ${payload.doc}`));
              // Il kernel firma la riscrittura come il comando dell'utente
              // in un lotto, non come il watcher: il finto la consegna così.
              box.restoring = true;
              try {
                box.host!.writeFromOutside(payload.doc, text);
              } finally {
                box.restoring = false;
              }
            }
            return Promise.resolve({ kind: "none" as const });
          }
          return (now().api as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args);
        },
      },
    ),
    onKernelEvent: (handler: (n: { origin: unknown }) => void) =>
      now().onKernelEvent(((notice: { origin: unknown }) =>
        handler(box.restoring ? { ...notice, origin: { actor: { kind: "user" }, batch: "version.restore" } } : notice)) as never),
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
async function start(consent: CraftRenderConsent, app: string | null = "PdfCraft"): Promise<FakeHost> {
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
    file: { "Benvenuto.md": "# Benvenuto\n", "Altra.md": "# Altra\n", "Lettera.docx": rich("ciao") },
    resources: { [GUIDA]: { bytes: new TextEncoder().encode("test"), mime: "application/pdf" } },
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

// #237 R01 e R02: il testo non salvato davanti ai gesti che toccano la sua
// sessione senza passare dalla chiusura di una linguetta. Salvataggio e bozza
// falliscono; dopo il gesto la sessione è viva e sporca, la nota riaperta
// mostra il testo e la bozza parte appena il finto la lascia scrivere.
describe("il testo non salvato resta (#237)", () => {
  type Sessions = typeof import("../state/document-session").documentSessions;
  const BENVENUTO = "Benvenuto.md";
  const TYPED = "testo non salvato";
  let repairWrite: (() => void) | null = null;
  let repairDraft: (() => void) | null = null;

  beforeEach(() => {
    activeStop?.();
    activeStop = null;
    document.body.innerHTML = "";
    localStorage.clear();
    box.versions.clear();
  });

  afterEach(async () => {
    repairWrite?.();
    repairDraft?.();
    repairWrite = repairDraft = null;
    // Le sessioni sopravvivono alla shell smontata: nessun salvataggio del
    // giro resta a scrivere sull'host della prova dopo.
    (await import("../state/document-session")).documentSessions.closeAll();
  });

  const shows = (text: string) => mountedTextEditors().some((view) => view.state.doc.toString().includes(text));

  /// La shell con «Benvenuto.md» aperta, il testo battuto, e salvataggio e
  /// bozza guasti.
  async function unsavedNote(): Promise<{ host: FakeHost; sessions: Sessions }> {
    const host = await start("off");
    await open(BENVENUTO);
    const { documentSessions: sessions } = await import("../state/document-session");
    await waitFor("l'editor della nota", () => mountedTextEditors().length > 0);
    repairWrite = host.fault("writeDocument", "disco pieno");
    repairDraft = host.fault("saveDraft", "disco pieno");
    appendToTextEditor(`\n${TYPED}`);
    await waitFor("il testo nella sessione", () => sessions.isDirty(BENVENUTO));
    return { host, sessions };
  }

  /// La sessione è ancora l'unica copia: viva, sporca, col testo battuto.
  function expectAlive(sessions: Sessions): void {
    expect(sessions.inspect(BENVENUTO)).toMatchObject({ dirty: true });
    expect(sessions.text(BENVENUTO)).toContain(TYPED);
  }

  /// Riaperta, la nota mostra il testo; tolto il guasto, la bozza c'è.
  async function expectRecoverable(host: FakeHost, sessions: Sessions): Promise<void> {
    await open(BENVENUTO);
    await waitFor("l'editor della nota riaperta col testo", () => shows(TYPED));
    const before = host.atGate("saveDraft").length;
    repairDraft?.();
    repairDraft = null;
    await sessions.flushDraft(BENVENUTO);
    const drafts = host.atGate("saveDraft").slice(before).map((call) => call.args);
    expect(drafts.some(([doc, text]) => doc === BENVENUTO && String(text).includes(TYPED))).toBe(true);
  }

  it("R01 · un layout che toglie la nota (uno spazio di lavoro) lascia viva la sessione sporca", async () => {
    const { host, sessions } = await unsavedNote();
    const layouts = await import("../state/layout");
    const next = structuredClone(layouts.layout);
    layouts.openIn(next.focus, "Altra.md", next);
    layouts.removeEverywhere(BENVENUTO, next);
    const { applyShellLayout } = await import("../state/shell-layout");

    await applyShellLayout(next);
    await settle();

    expect(layouts.panesWithDoc(BENVENUTO)).toEqual([]);
    expectAlive(sessions);
    await expectRecoverable(host, sessions);
  });

  it("R01 · un'apertura che finisce con la linguetta già chiusa lascia viva la sessione sporca", async () => {
    const { host, sessions } = await unsavedNote();
    await open("Altra.md");
    const layouts = await import("../state/layout");
    const controller = await import("../state/document-controller");
    const contexts = host.atGate("setActiveContext").length;
    const unlock = host.throttle("setActiveContext");

    // L'apertura si ferma nel pubblicare il contesto, dentro il suo `try`, e
    // intanto la persona chiude la linguetta: il rilascio della linguetta
    // trova l'apertura in corso, e chi decide è il `finally` dell'apertura.
    const opening = controller.openDocument(BENVENUTO);
    await waitFor("l'apertura pubblica il contesto", () => host.atGate("setActiveContext").length > contexts);
    const paneId = layouts.layout.focus;
    const index = layouts.pane(paneId)!.tabs.findIndex((tab) => tab.k === "doc" && tab.doc === BENVENUTO);
    expect(index).toBeGreaterThanOrEqual(0);
    const closing = controller.closeTabAt(paneId, index);
    await settle();
    unlock();
    await Promise.all([opening, closing]);
    await settle();

    expect(layouts.panesWithDoc(BENVENUTO)).toEqual([]);
    expectAlive(sessions);
    await expectRecoverable(host, sessions);
  });

  it("R02 · un ripristino dalla cronologia tiene il testo e dice che il file è cambiato", async () => {
    const { host, sessions } = await unsavedNote();
    const restored = "# Benvenuto\nla versione di ieri\n";
    box.versions.set(BENVENUTO, restored);
    const { api } = await import("../host/ipc");

    await api.viewAction("history", "history-1", null, "restore", { doc: BENVENUTO, ts: 1 }, {});
    await api.viewAction("history", "history-1", null, "restore_confirm", { doc: BENVENUTO, ts: 1 }, {});
    await settle();

    expect(host.files()[BENVENUTO]).toBe(restored);
    expectAlive(sessions);
    await waitFor("l'avviso del file cambiato", () => visible('.sheet-notice[data-notice="changed_on_disk"]').length === 1);
    expect(shows(TYPED)).toBe(true);
    // Il salvataggio che segue non scrive alla cieca sopra la versione
    // ripristinata: la base è quella di prima, e il finto risponde conflitto.
    repairWrite?.();
    repairWrite = null;
    await sessions.flush(BENVENUTO);
    expect(sessions.inspect(BENVENUTO)).toMatchObject({ dirty: true, result: "conflitto" });
    expect(sessions.text(BENVENUTO)).toContain(TYPED);
    expect(host.files()[BENVENUTO]).toBe(restored);
  });
});
