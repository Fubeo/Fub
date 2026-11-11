// @vitest-environment happy-dom
// La porta per scrivere dentro le schede (N6 T40): la sessione vera sull'host
// finto, il registro vero delle superfici con una superficie finta che tiene
// il suo annulla come un editor (le battute sì, i cambi arrivati dalla
// sessione no).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CardEditorOptions, CardEditorState } from "../editors/canvas/cards";
import {
  DocumentSurfaceRegistry,
  type EditorSurface,
  type SurfaceActiveCell,
  type SurfaceMode,
  type SurfaceMountContext,
} from "../editors/core/registry";
import { operationFromText, type EditorChange } from "../editors/core/text-operation";
import { createFakeHost, type FakeHost } from "../host/fake";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { createCardEditorPort, headingOffset, type CardEditorHub } from "./card-editors";
import {
  DocumentSessionCollection,
  type DocumentSessionApi,
  type DocumentSurfaceUpdate,
} from "./document-session";

const VAULT = "/vault";

const MODES: readonly SurfaceMode[] = [
  { id: "source", label: () => "Sorgente", presentation: "surface", contextMode: "source", looks: ["tema"] },
  { id: "live_preview", label: () => "Live", presentation: "surface", contextMode: "live_preview", looks: ["tema"] },
];

/// Un editor finto: il testo, l'annulla locale e ciò che la porta gli ha fatto.
class FakeEditor {
  text = "";
  readonly undo: string[] = [];
  readonly syncs: string[] = [];
  mode: string | null = null;
  readOnly = false;
  destroyed = false;
  focused = 0;
  /// La cella attiva, come un foglio (T42): `undefined` se la superficie non
  /// ne ha una.
  cell: SurfaceActiveCell | null | undefined = undefined;
  readonly cellListeners = new Set<() => void>();
  constructor(
    readonly context: SurfaceMountContext,
    readonly onChange: (paneId: string, change: EditorChange) => void,
  ) {
    context.parent.textContent = "editor";
  }
  /// Una battuta dell'utente: entra nell'annulla e va alla sessione.
  type(next: string): void {
    const before = this.text;
    this.undo.push(before);
    this.text = next;
    this.onChange(this.context.paneId, { text: next, operation: operationFromText(before, next), origin: "input" });
  }
  surface(): EditorSurface {
    return {
      family: "text",
      profile: "markdown",
      surfaceId: this.context.paneId,
      modes: MODES,
      defaultMode: "live_preview",
      setMode: (mode) => {
        this.mode = mode;
      },
      buffer: {
        setDoc: (text) => {
          this.text = text;
        },
        syncDoc: (update) => {
          this.text = typeof update === "string" ? update : update.text;
          this.syncs.push(this.text);
        },
        getDoc: () => this.text,
      },
      focus: () => {
        this.focused++;
      },
      setReadOnly: (readOnly) => {
        this.readOnly = readOnly;
      },
      ...(this.cell === undefined ? {} : {
        activeCell: {
          read: () => this.cell ?? null,
          subscribe: (listener: () => void) => {
            this.cellListeners.add(listener);
            return () => {
              this.cellListeners.delete(listener);
            };
          },
        },
      }),
      destroy: () => {
        this.destroyed = true;
      },
    };
  }
  /// La griglia sceglie un'altra cella, o ne cambia il contenuto, e lo dice.
  moveTo(cell: SurfaceActiveCell | null): void {
    this.cell = cell;
    for (const listener of [...this.cellListeners]) listener();
  }
}

/// Un riquadro finto sulla stessa sessione: si attacca e scrive come
/// `document-controller.ts`, con il suo id.
class FakePane {
  text: string;
  readonly undo: string[] = [];
  readonly syncs: DocumentSurfaceUpdate[] = [];
  readonly detach: () => void;
  constructor(
    readonly sessions: DocumentSessionCollection,
    readonly doc: string,
    readonly id = "pane-1",
  ) {
    this.text = sessions.text(doc) ?? "";
    this.detach = sessions.attachSurface(doc, {
      id,
      sync: (update) => {
        this.text = update.text;
        this.syncs.push(update);
      },
    });
  }
  type(next: string): void {
    const before = this.text;
    this.undo.push(before);
    this.text = next;
    expect(this.sessions.acceptSurfaceChange(this.doc, this.id, { text: next, operation: operationFromText(before, next) }).kind).toBe("accepted");
  }
}

describe("la porta per scrivere dentro le schede", () => {
  let host: FakeHost;
  let api: DocumentSessionApi;
  let sessions: DocumentSessionCollection;
  let registry: DocumentSurfaceRegistry;
  let hub: CardEditorHub;
  let editors: FakeEditor[];
  let held: Set<string>;
  let panes: Set<string>;
  let life: Lifetime;
  let error: ReturnType<typeof vi.spyOn>;
  /// La cella attiva delle superfici che nascono (T42); `undefined`: nessuna.
  let nextCell: SurfaceActiveCell | null | undefined;

  function setup(files: Record<string, string> = { "Nota.md": "ciao" }): void {
    host = createFakeHost({ root: VAULT, file: files });
    api = { ...host.module.api };
    sessions = new DocumentSessionCollection(api, () => VAULT);
    registry = new DocumentSurfaceRegistry();
    editors = [];
    registry.register({
      owner: "test.text",
      family: "text",
      defaultProfile: "markdown",
      formats: { markdown: "markdown" },
      factory: {
        mount: (_profile, context) => {
          const editor = new FakeEditor(context, (paneId, change) => {
            if (!hub.written(paneId, change)) throw new Error(`modifica di un riquadro: ${paneId}`);
          });
          editor.cell = nextCell;
          editors.push(editor);
          return editor.surface();
        },
      },
    });
    // Il ripiego del registro per ciò che non sa mostrare.
    registry.register({
      owner: "test.error",
      family: "error",
      defaultProfile: "error",
      factory: {
        mount: (_profile, context) => ({
          family: "error",
          profile: "error",
          surfaceId: context.paneId,
          modes: [{ id: "error", label: () => "Errore", presentation: "rendered", contextMode: "reading", looks: ["tema"] }],
          setMode: () => {},
          destroy: () => {},
        }),
      },
    });
    held = new Set();
    panes = new Set();
    hub = createCardEditorPort({
      sessions,
      surfaces: () => registry,
      held: (path) => held.has(path),
      shownInPane: (path) => panes.has(path),
    });
    life = openLifetime();
  }

  const options = (overrides: Partial<CardEditorOptions> = {}): CardEditorOptions => ({
    compact: true,
    readOnly: false,
    lifetime: life,
    ...overrides,
  });

  /// Le attese della porta (la lettura, il rilascio) arrivate in fondo.
  const settled = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  /// Le chiavi di apertura date all'host e mai chiuse: una sessione rimasta.
  const unclosedKeys = (): unknown[] => {
    const closed = new Set(host.atGate("documentClosed").map((call) => call.args[0]));
    return host.atGate("openDocument").map((call) => call.args[1]).filter((key) => !closed.has(key));
  };

  beforeEach(() => {
    nextCell = undefined;
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    life?.close();
    error.mockRestore();
  });

  it("apre l'editor del file sulla sua sessione e, distrutto, non trattiene niente", async () => {
    setup();
    const card = document.createElement("div");
    const editor = await hub.open("Nota.md", card, options());

    expect(editor).not.toBeNull();
    expect(editors).toHaveLength(1);
    expect(editors[0]!.text).toBe("ciao");
    expect(editors[0]!.mode).toBe("live_preview");
    expect(card.dataset.cardEditor).toBe("compact");
    expect(hub.holds("Nota.md")).toBe(true);
    expect(editor!.state()).toBe("clean");
    expect(host.atGate("documentClosed")).toHaveLength(0);

    // Una sessione trattenuta non si chiuderebbe: la scheda la tiene.
    await expect(sessions.release("Nota.md")).resolves.toEqual({ kind: "active" });

    editor!.focus();
    expect(editors[0]!.focused).toBe(1);
    editor!.destroy();
    editor!.destroy();
    await settled();

    expect(editors[0]!.destroyed).toBe(true);
    expect(card.childNodes).toHaveLength(0);
    expect(card.dataset.cardEditor).toBeUndefined();
    expect(hub.holds("Nota.md")).toBe(false);
    expect(sessions.get("Nota.md")).toBeUndefined();
    expect(unclosedKeys()).toEqual([]);
    expect(editor!.state()).toBe("readonly");
  });

  it("si smonta da sé quando si chiude la vita della scheda", async () => {
    setup();
    const card = document.createElement("div");
    const editor = await hub.open("Nota.md", card, options());
    expect(editor).not.toBeNull();

    life.close();
    await settled();

    expect(editors[0]!.destroyed).toBe(true);
    expect(sessions.get("Nota.md")).toBeUndefined();
  });

  it("chiusa la scheda mentre `open` aspetta, non resta niente montato né trattenuto", async () => {
    setup();
    const letGo = host.throttle("openDocument");
    const card = document.createElement("div");
    const opening = hub.open("Nota.md", card, options());

    life.close();
    letGo();

    await expect(opening).resolves.toBeNull();
    await settled();
    expect(editors).toHaveLength(0);
    expect(card.childNodes).toHaveLength(0);
    expect(hub.holds("Nota.md")).toBe(false);
    expect(sessions.get("Nota.md")).toBeUndefined();
    expect(unclosedKeys()).toEqual([]);
  });

  it("lo stesso file in un riquadro e in una scheda: una sessione, due superfici, annulla separati", async () => {
    setup();
    await sessions.read("Nota.md");
    panes.add("Nota.md");
    const pane = new FakePane(sessions, "Nota.md");
    const editor = await hub.open("Nota.md", document.createElement("div"), options());
    const card = editors[0]!;

    // Dal riquadro alla scheda: arriva, e non entra nell'annulla della scheda.
    pane.type("ciao dal riquadro");
    expect(card.text).toBe("ciao dal riquadro");
    expect(card.syncs).toEqual(["ciao dal riquadro"]);
    expect(card.undo).toEqual([]);

    // Dalla scheda al riquadro: la stessa sessione, l'operazione ai pari.
    card.type("ciao dal riquadro e dalla scheda");
    expect(sessions.text("Nota.md")).toBe("ciao dal riquadro e dalla scheda");
    expect(pane.text).toBe("ciao dal riquadro e dalla scheda");
    expect(pane.syncs[pane.syncs.length - 1]?.kind).toBe("operation");
    expect(pane.undo).toEqual(["ciao"]);
    expect(card.undo).toEqual(["ciao dal riquadro"]);
    expect(editor!.state()).toBe("pending");

    // La scheda si chiude: la sessione resta del riquadro.
    editor!.destroy();
    await settled();
    expect(sessions.get("Nota.md")).toBeDefined();
    pane.detach();
  });

  it("due `open` sullo stesso file: due superfici, una sessione", async () => {
    setup();
    const first = await hub.open("Nota.md", document.createElement("div"), options());
    const second = await hub.open("Nota.md", document.createElement("div"), options());
    expect(editors).toHaveLength(2);

    editors[0]!.type("una");
    expect(editors[1]!.text).toBe("una");
    expect(editors[1]!.undo).toEqual([]);

    first!.destroy();
    await settled();
    expect(sessions.get("Nota.md")).toBeDefined();
    second!.destroy();
    await settled();
    expect(sessions.get("Nota.md")).toBeUndefined();
    expect(host.files()["Nota.md"]).toBe("una");
  });

  it("una battuta indietro si ribasa sul testo autorevole e resta della scheda", async () => {
    setup();
    await sessions.read("Nota.md");
    const editor = await hub.open("Nota.md", document.createElement("div"), options());
    const card = editors[0]!;
    // Un cambio della sessione che la scheda non ha ancora applicato.
    const pane = new FakePane(sessions, "Nota.md", "pane-x");
    pane.type("ciao!");
    card.text = "ciao";

    card.type(">ciao");
    expect(sessions.text("Nota.md")).toBe(">ciao!");
    expect(card.text).toBe(">ciao!");
    expect(card.undo).toEqual(["ciao"]);
    pane.detach();
    editor!.destroy();
  });

  it("un conflitto col disco si dice, e chiudendo la lavagna la bozza resta", async () => {
    setup();
    api.writeDocument = vi.fn(async () => {
      throw { kind: "conflict", message: "revisione superata" };
    });
    const saveDraft = vi.spyOn(api, "saveDraft");
    const editor = await hub.open("Nota.md", document.createElement("div"), options());
    const states: CardEditorState[] = [];
    editor!.onState((state) => states.push(state));

    editors[0]!.type("il mio testo");
    expect(editor!.state()).toBe("pending");
    await editor!.leave();
    expect(editor!.state()).toBe("conflict");
    expect(states).toEqual(["pending", "conflict"]);

    editor!.destroy();
    await settled();

    // Il lavoro non si perde: la bozza è scritta e la sessione resta aperta
    // con il testo, ma nessuno la trattiene più.
    expect(saveDraft).toHaveBeenCalledWith("Nota.md", "il mio testo", expect.anything(), VAULT);
    expect(sessions.inspect("Nota.md")).toMatchObject({ text: "il mio testo", dirty: true, result: "conflitto" });
    await expect(sessions.release("Nota.md")).resolves.toEqual({ kind: "unsaved" });
  });

  it("chiusa senza conflitti, ciò che si è scritto si salva e la sessione esce", async () => {
    setup();
    const editor = await hub.open("Nota.md", document.createElement("div"), options());
    editors[0]!.type("scritto in una scheda");
    editor!.destroy();
    await settled();
    expect(host.files()["Nota.md"]).toBe("scritto in una scheda");
    expect(sessions.get("Nota.md")).toBeUndefined();
  });

  it("un formato senza editor dà `null` e non trattiene la sessione", async () => {
    setup({ "dati.xyz": "1,2,3" });
    const card = document.createElement("div");
    await expect(hub.open("dati.xyz", card, options())).resolves.toBeNull();
    await settled();
    expect(editors).toHaveLength(0);
    expect(card.childNodes).toHaveLength(0);
    expect(card.dataset.cardEditor).toBeUndefined();
    expect(sessions.get("dati.xyz")).toBeUndefined();
  });

  it("una sessione che non si apre dà `null`", async () => {
    setup();
    await expect(hub.open("Manca.md", document.createElement("div"), options())).resolves.toBeNull();
    await settled();
    expect(editors).toHaveLength(0);
    expect(sessions.get("Manca.md")).toBeUndefined();
  });

  it("la sola lettura della policy e quella chiesta dalla scheda", async () => {
    setup();
    held.add("Nota.md");
    const editor = await hub.open("Nota.md", document.createElement("div"), options());
    const states: CardEditorState[] = [];
    editor!.onState((state) => states.push(state));
    expect(editors[0]!.readOnly).toBe(true);
    expect(editor!.state()).toBe("readonly");

    held.delete("Nota.md");
    hub.refreshReadOnly();
    expect(editors[0]!.readOnly).toBe(false);
    expect(states).toEqual(["clean"]);
    editor!.destroy();

    const reading = await hub.open("Nota.md", document.createElement("div"), options({ readOnly: true, compact: false }));
    expect(editors[1]!.readOnly).toBe(true);
    expect(reading!.state()).toBe("readonly");
    reading!.destroy();
  });

  it("il file tolto mentre si scrive: la scheda resta ferma in sola lettura", async () => {
    setup();
    const editor = await hub.open("Nota.md", document.createElement("div"), options());
    editors[0]!.type("prima di sparire");
    sessions.handleExternalRemoval("Nota.md");
    expect(editor!.state()).toBe("readonly");
    expect(editors[0]!.readOnly).toBe(true);
    // Una battuta rimasta appesa non finisce da nessuna parte e non lancia.
    expect(hub.written(editors[0]!.context.paneId, {
      text: "x",
      operation: operationFromText("prima di sparire", "x"),
      origin: "input",
    })).toBe(true);
    editor!.destroy();
  });

  it("il file rinominato: la scheda segue la sessione", async () => {
    setup();
    const editor = await hub.open("Nota.md", document.createElement("div"), options());
    expect(sessions.rename("Nota.md", "Altra.md").kind).toBe("renamed");
    editors[0]!.type("dopo il nome nuovo");
    expect(sessions.text("Altra.md")).toBe("dopo il nome nuovo");
    expect(hub.holds("Altra.md")).toBe(true);
    editor!.destroy();
    await settled();
    expect(sessions.get("Altra.md")).toBeUndefined();
  });

  it("il modo compatto arriva alla superficie, e una superficie compatta lo sa dal contesto", async () => {
    setup();
    const compact = await hub.open("Nota.md", document.createElement("div"), options());
    expect(editors[0]!.context.compact).toBe(true);
    compact!.destroy();
    const full = await hub.open("Nota.md", document.createElement("div"), options({ compact: false }));
    expect(editors[1]!.context.compact).toBeUndefined();
    full!.destroy();
  });

  it("la cella attiva della superficie arriva come contesto, e solo quando cambia davvero (T42)", async () => {
    setup({ "Conti.md": "x" });
    nextCell = { name: "B2", formula: "=A1*2" };
    const editor = await hub.open("Conti.md", document.createElement("div"), options());
    expect(editor!.context!()).toEqual({ cell: "B2", formula: "=A1*2" });

    const seen: unknown[] = [];
    const stop = editor!.onContext!((context) => seen.push(context));
    // Un avviso senza cambi (il catalogo, la vista) non arriva alla tela.
    editors[0]!.moveTo({ name: "B2", formula: "=A1*2" });
    editors[0]!.moveTo({ name: "C3", formula: "" });
    editors[0]!.moveTo({ name: "C3", formula: "12" });
    editors[0]!.moveTo(null);
    expect(seen).toEqual([{ cell: "C3", formula: "" }, { cell: "C3", formula: "12" }, null]);

    stop();
    editors[0]!.moveTo({ name: "D4", formula: "1" });
    expect(seen).toHaveLength(3);

    // Distrutto l'editor, la superficie non ha più chi ascolta.
    editor!.onContext!((context) => seen.push(context));
    expect(editors[0]!.cellListeners.size).toBe(1);
    editor!.destroy();
    expect(editors[0]!.cellListeners.size).toBe(0);
    expect(editor!.context!()).toBeNull();
    expect(editor!.onContext!(() => seen.push("tardi"))).toBeTypeOf("function");
    expect(editors[0]!.cellListeners.size).toBe(0);
  });

  it("una superficie senza cella attiva non ha contesto", async () => {
    setup();
    const editor = await hub.open("Nota.md", document.createElement("div"), options());
    expect(editor!.context!()).toBeNull();
    const seen: unknown[] = [];
    editor!.onContext!((context) => seen.push(context));
    expect(seen).toEqual([]);
    editor!.destroy();
  });

  it("le modifiche dei riquadri non sono della porta", () => {
    setup();
    expect(hub.written("pane-1", { text: "x", operation: operationFromText("", "x"), origin: "input" })).toBe(false);
    expect(hub.failed("pane-1", new Error("no"))).toBe(false);
  });
});

describe("dove comincia un titolo (T41, `Nota#Titolo`)", () => {
  it("dà il byte UTF-8 della riga del titolo, senza badare a maiuscole e cancelletti in coda", () => {
    const text = "# Perché\n\nUn paragrafo con è.\n\n## Più giù ##\nfine\n";
    expect(headingOffset(text, "Perché")).toBe(0);
    expect(headingOffset(text, "più giù")).toBe(new TextEncoder().encode("# Perché\n\nUn paragrafo con è.\n\n").length);
    expect(headingOffset(text, "Assente")).toBeNull();
    expect(headingOffset(text, "  ")).toBeNull();
  });

  it("salta i titoli dentro un blocco di codice e regge i fine riga CRLF", () => {
    const text = "```md\r\n# Finto\r\n```\r\n# Finto\r\n";
    expect(headingOffset(text, "Finto")).toBe("```md\r\n# Finto\r\n```\r\n".length);
    expect(headingOffset("~~~\n# Dentro\n", "Dentro")).toBeNull();
  });
});
