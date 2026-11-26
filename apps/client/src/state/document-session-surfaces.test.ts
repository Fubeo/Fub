// Le prove di `DocumentSession`: le superfici sottoscritte, il file senza formato, la chiusura della finestra, il vault delle sessioni.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentSessionCollection, type DocumentSessionApi, type DocumentSurface, type DocumentSurfaceUpdate, type SurfaceEdit } from "./document-session";
import { operationFromText } from "../editors/core/text-operation";
import type { DocumentSource } from "../host/contract";
import { acceptText, fakeApi } from "./document-session-test-support";

describe("le superfici sottoscritte alla sessione", () => {
  let api: DocumentSessionApi;
  let nextTimer = 0;

  beforeEach(() => {
    api = fakeApi();
    nextTimer = 0;
    vi.stubGlobal("setTimeout", vi.fn(() => ++nextTimer));
    vi.stubGlobal("clearTimeout", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /// Una superficie di prova che registra ciò che la sessione le manda.
  function recordingSurface(
    id: string,
    log: { surface: string; update: DocumentSurfaceUpdate }[],
  ): DocumentSurface {
    return {
      id,
      sync: (update) => log.push({ surface: id, update }),
    };
  }

  function editFor(before: string, after: string): SurfaceEdit {
    return { text: after, operation: operationFromText(before, after) };
  }

  it("diffonde l'operazione accettata ai pari, mai alla sorgente, una volta sola", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    const log: { surface: string; update: DocumentSurfaceUpdate }[] = [];
    sessions.attachSurface("nota.md", recordingSurface("riquadro-a", log));
    sessions.attachSurface("nota.md", recordingSurface("riquadro-b", log));

    const before = "nota.md: disco";
    const outcome = sessions.acceptSurfaceChange(
      "nota.md",
      "riquadro-a",
      editFor(before, `${before} due`),
    );

    expect(outcome).toEqual({ kind: "accepted" });
    expect(sessions.inspect("nota.md")).toMatchObject({ text: `${before} due`, dirty: true });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ surface: "riquadro-b", update: { kind: "operation" } });
    // Salvataggio e bozza: i due ritardi sono della sessione, armati una volta.
    expect(nextTimer).toBe(2);
  });

  it("una superficie che lancia non toglie l'aggiornamento a quelle dopo", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    const log: { surface: string; update: DocumentSurfaceUpdate }[] = [];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    sessions.attachSurface("nota.md", recordingSurface("riquadro-a", log));
    sessions.attachSurface("nota.md", {
      id: "riquadro-rotto",
      sync: () => {
        throw new SyntaxError("sorgente non valido");
      },
    });
    sessions.attachSurface("nota.md", recordingSurface("riquadro-c", log));

    const before = "nota.md: disco";
    const outcome = sessions.acceptSurfaceChange("nota.md", "riquadro-a", editFor(before, `${before} due`));

    expect(outcome).toEqual({ kind: "accepted" });
    expect(log.map((entry) => entry.surface)).toEqual(["riquadro-c"]);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it("ristabilizza la sorgente su una preimmagine stantia senza mutare la sessione", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    const log: { surface: string; update: DocumentSurfaceUpdate }[] = [];
    sessions.attachSurface("nota.md", recordingSurface("riquadro-a", log));
    sessions.attachSurface("nota.md", recordingSurface("riquadro-b", log));

    // Forma corretta, preimmagine stantia: al posto 13 la sessione ha «o»,
    // l'operazione dichiara di togliere «z» — un'altra superficie ha battuto
    // nel frattempo, o il disco è cambiato sotto.
    const stale: SurfaceEdit = {
      text: "nota.md: discX",
      operation: {
        beforeLength: "nota.md: disco".length,
        afterLength: "nota.md: discX".length,
        edits: [{ from: 13, to: 14, deleted: "z", inserted: "X" }],
      },
    };
    const outcome = sessions.acceptSurfaceChange("nota.md", "riquadro-a", stale);

    expect(outcome).toEqual({ kind: "realigned", text: "nota.md: disco" });
    expect(sessions.inspect("nota.md")).toMatchObject({ text: "nota.md: disco", dirty: false });
    expect(log).toHaveLength(0);
  });

  it("ristabilizza la sorgente anche se l'operazione regge ma il risultato non è quello dichiarato", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    const authoritative = "nota.md: disco";
    // L'operazione, applicata al testo autorevole, produce «disc0»; la
    // sorgente dichiara di essere arrivata a «disc9»: il risultato non è
    // ciò che l'operazione costruisce, e la sessione non lo prende.
    const lies: SurfaceEdit = {
      text: "nota.md: disc9",
      operation: {
        beforeLength: authoritative.length,
        afterLength: "nota.md: disc0".length,
        edits: [{ from: 13, to: 14, deleted: "o", inserted: "0" }],
      },
    };

    const outcome = sessions.acceptSurfaceChange("nota.md", "riquadro-a", lies);

    expect(outcome).toEqual({ kind: "realigned", text: authoritative });
    expect(sessions.inspect("nota.md")?.text).toBe(authoritative);
    expect(nextTimer).toBe(0);
  });
  it("confronta preimmagine e atteso sulla stessa normalizzazione di terminatori", async () => {
    api.readDocument = vi.fn(async (): Promise<DocumentSource> => ({ text: "riga1\r\nriga2\n", revision: "rev-1", format_id: "markdown", source_kind: "text", text_kind: "source" }));
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    const log: { surface: string; update: DocumentSurfaceUpdate }[] = [];
    sessions.attachSurface("nota.md", recordingSurface("riquadro-a", log));

    const outcome = sessions.acceptSurfaceChange(
      "nota.md",
      "riquadro-a",
      editFor("riga1\nriga2\n", "riga1\nriga2\nX"),
    );

    expect(outcome).toEqual({ kind: "accepted" });
    expect(sessions.inspect("nota.md")?.text).toBe("riga1\nriga2\nX");
  });

  it("attacca due volte la stessa identità una volta sola, e il disposer è indempiente", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    const log: { surface: string; update: DocumentSurfaceUpdate }[] = [];
    const disposeFirst = sessions.attachSurface("nota.md", recordingSurface("riquadro-a", log));
    const disposeSecond = sessions.attachSurface("nota.md", recordingSurface("riquadro-a", log));

    sessions.acceptSurfaceChange("nota.md", "riquadro-b", editFor("nota.md: disco", "uno"));
    // La rimontata con la stessa identità rimpiazza: una registrazione, una
    // diffusione — non due superfici che ricevono la stessa cosa due volte.
    expect(log).toHaveLength(1);

    disposeFirst();
    sessions.acceptSurfaceChange("nota.md", "riquadro-b", editFor("uno", "due"));
    expect(log).toHaveLength(2);

    disposeSecond();
    disposeSecond();
    sessions.acceptSurfaceChange("nota.md", "riquadro-b", editFor("due", "tre"));
    expect(log).toHaveLength(2);
  });

  it("la rinomina tiene le superfici sullo stesso owner e il disposer segue la nuova chiave", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("a.md");
    const log: { surface: string; update: DocumentSurfaceUpdate }[] = [];
    const dispose = sessions.attachSurface("a.md", recordingSurface("riquadro-a", log));
    const owner = sessions.get("a.md");

    sessions.rename("a.md", "c.md");

    expect(sessions.get("c.md")).toBe(owner);
    const peer = recordingSurface("riquadro-b", log);
    sessions.attachSurface("c.md", peer);
    dispose();
    const outcome = sessions.acceptSurfaceChange(
      "c.md",
      "riquadro-b",
      editFor("a.md: disco", "spostato"),
    );
    expect(outcome).toEqual({ kind: "accepted" });
    expect(log).toHaveLength(0);
    expect(sessions.inspect("c.md")?.text).toBe("spostato");
  });

  it("la chiusura svuota le sottoscrizioni: nessuna superficie resta abbonata", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    const log: { surface: string; update: DocumentSurfaceUpdate }[] = [];
    const surface = recordingSurface("riquadro-a", log);
    sessions.attachSurface("nota.md", surface);
    const owner = sessions.get("nota.md");
    if (!owner) throw new Error("sessione non costruita");

    sessions.close("nota.md");

    // Attaccare a una sessione chiusa non mette niente in piedi...
    expect(owner.attachSurface(surface)()).toBeUndefined();
    // ...e portare una modifica a una sessione chiusa non tocca nessuno.
    const outcome = sessions.acceptSurfaceChange(
      "nota.md",
      "riquadro-a",
      editFor("nota.md: disco", "tarocco"),
    );
    expect(outcome).toEqual({ kind: "untracked" });
    expect(log).toHaveLength(0);
  });

  it("una cancellazione fallita riapre lo stesso owner con le superfici attaccate", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("a.md");
    const log: { surface: string; update: DocumentSurfaceUpdate }[] = [];
    sessions.attachSurface("a.md", recordingSurface("riquadro-a", log));
    const owner = sessions.get("a.md");

    const failing = sessions.delete("a.md", async () => {
      throw new Error("il disco rifiuta");
    });
    await expect(failing).rejects.toThrow("il disco rifiuta");

    // La chiusura era provvisoria: le superfici non sono state staccate, o
    // la seconda di due riquadri resterebbe orfana dopo un ripensamento.
    expect(sessions.get("a.md")).toBe(owner);
    const outcome = sessions.acceptSurfaceChange(
      "a.md",
      "riquadro-a",
      editFor("a.md: disco", "ancora vivo"),
    );
    expect(outcome).toEqual({ kind: "accepted" });
  });

  it("una cancellazione riuscita non lascia superfici sottoscritte", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("a.md");
    const log: { surface: string; update: DocumentSurfaceUpdate }[] = [];
    sessions.attachSurface("a.md", recordingSurface("riquadro-a", log));

    await sessions.delete("a.md", async () => {});

    expect(
      sessions.acceptSurfaceChange("a.md", "riquadro-a", editFor("a.md: disco", "fantasma")),
    ).toEqual({ kind: "untracked" });
    expect(sessions.attachSurface("a.md", recordingSurface("riquadro-a", log))()).toBeUndefined();
    expect(log).toHaveLength(0);
  });

  it("la sostituzione autorevole raggiunge ogni superficie una volta sola, in testo pieno", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    const log: { surface: string; update: DocumentSurfaceUpdate }[] = [];
    sessions.attachSurface("nota.md", recordingSurface("riquadro-a", log));
    sessions.attachSurface("nota.md", recordingSurface("riquadro-b", log));

    api.readDocument = vi.fn(async (): Promise<DocumentSource> => ({ text: "testo nuovo dal disco", revision: "rev-2", format_id: "markdown", source_kind: "text", text_kind: "source" }));
    const reloaded = await sessions.reloadIfClean("nota.md");
    expect(reloaded).toMatchObject({ kind: "reloaded", changed: true });
    expect(log.map((entry) => entry.surface).sort()).toEqual(["riquadro-a", "riquadro-b"]);
    expect(log.every((entry) => entry.update.kind === "text")).toBe(true);

    // Il disco non è cambiato davvero: nessuna superficie viene risincronizzata.
    log.length = 0;
    await sessions.reloadIfClean("nota.md");
    expect(log).toHaveLength(0);

    // La bozza rientrata è un'altra sostituzione autorevole: testo pieno a tutti.
    sessions.restore("nota.md", "testo della bozza", { kind: "descends_from", value: "rev-2" });
    expect(log.map((entry) => entry.surface).sort()).toEqual(["riquadro-a", "riquadro-b"]);
    expect(log[0]?.update).toEqual({ kind: "text", text: "testo della bozza" });
    expect(log[1]?.update).toEqual({ kind: "text", text: "testo della bozza" });
  });
});

describe("il salvataggio di un file senza formato", () => {
  let api: DocumentSessionApi;

  beforeEach(() => {
    api = fakeApi();
    vi.mocked(api.readDocument).mockImplementation(async (id): Promise<DocumentSource> => ({
      text: "<svg/>",
      revision: "rev-disco",
      format_id: id.endsWith(".md") ? "markdown" : null,
      source_kind: "text", text_kind: "source",
    }));
    vi.stubGlobal("setTimeout", vi.fn(() => 1));
    vi.stubGlobal("clearTimeout", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scrive i byte UTF-8 col CAS sulla revisione da cui il buffer discende", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("disegno.svg");
    acceptText(sessions, "disegno.svg", "<svg><title>però</title></svg>");
    await sessions.flush("disegno.svg");

    expect(api.writeDocument).not.toHaveBeenCalled();
    expect(api.resourceWrite).toHaveBeenCalledWith(
      "disegno.svg",
      new TextEncoder().encode("<svg><title>però</title></svg>"),
      "rev-disco",
    );
    expect(sessions.inspect("disegno.svg")).toMatchObject({
      dirty: false,
      result: "ok",
      base: { kind: "descends_from", value: "rev-byte" },
      echoes: 1,
    });
    // L'evento della scrittura (`entry_changed`) è l'eco: la consuma.
    await sessions.handleExternalChange("disegno.svg", { actor: { kind: "user" }, batch: null });
    expect(sessions.inspect("disegno.svg")?.echoes).toBe(0);
  });

  it("un file cambiato sotto è un conflitto, e l'eco non resta appesa", async () => {
    vi.mocked(api.resourceWrite).mockRejectedValueOnce({ kind: "conflict", message: "cambiato sotto" });
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("disegno.svg");
    acceptText(sessions, "disegno.svg", "<svg>mio</svg>");
    await sessions.flush("disegno.svg");

    expect(sessions.inspect("disegno.svg")).toMatchObject({ dirty: true, result: "conflitto", echoes: 0 });
    expect(sessions.text("disegno.svg")).toBe("<svg>mio</svg>");
  });

  it("«Mantieni il mio» rilegge la revisione del disco, e senza file lo crea", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("disegno.svg");
    // Una bozza senza base è un conflitto: la sola uscita che detta è la
    // scelta dell'utente, e la base dettata non ha una revisione da attendere.
    sessions.restore("disegno.svg", "<svg>bozza</svg>", null);
    await sessions.resolveConflict("disegno.svg", "mine");
    expect(api.resourceWrite).toHaveBeenLastCalledWith(
      "disegno.svg",
      new TextEncoder().encode("<svg>bozza</svg>"),
      "rev-disco",
    );

    vi.mocked(api.readDocument).mockRejectedValue(new Error("non c'è"));
    sessions.restore("disegno.svg", "<svg>ricreato</svg>", null);
    await sessions.resolveConflict("disegno.svg", "mine");
    expect(api.resourceWrite).toHaveBeenLastCalledWith(
      "disegno.svg",
      new TextEncoder().encode("<svg>ricreato</svg>"),
      null,
    );
  });

  it("una nota resta sulla porta del testo, e il ripiego senza lettura non indovina", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "# nota");
    await sessions.flush("nota.md");
    expect(api.writeDocument).toHaveBeenCalledTimes(1);

    // Una bozza ripristinata di un file che non c'è più: la superficie la
    // mostra come testo, ma chi non sa che file sia non passa ai byte —
    // scriverli a un formato vorrebbe dire saltarne il provider. Si ricrea
    // dalla porta dei documenti, come una nota nuova.
    sessions.restore("sparito.svg", "<svg/>", null);
    vi.mocked(api.readDocument).mockRejectedValue({ kind: "not_found", message: "non c'è" });
    await expect(sessions.readForSurface("sparito.svg")).resolves.toMatchObject({ formatId: null });
    await sessions.resolveConflict("sparito.svg", "mine");
    expect(api.writeDocument).toHaveBeenCalledTimes(2);
    expect(api.resourceWrite).not.toHaveBeenCalled();
  });

  it("una bozza di un file che c'è ma non si lascia leggere non si scrive alla cieca (#514)", async () => {
    const sessions = new DocumentSessionCollection(api);
    sessions.restore("rotto.svg", "<svg/>", null);
    vi.mocked(api.readDocument).mockRejectedValue({ kind: "io", message: "permesso negato" });
    await expect(sessions.readForSurface("rotto.svg")).resolves.toMatchObject({ formatId: null });
    await sessions.resolveConflict("rotto.svg", "mine");
    expect(api.writeDocument).not.toHaveBeenCalled();
    expect(api.resourceWrite).not.toHaveBeenCalled();
    expect(sessions.inspect("rotto.svg")).toMatchObject({ text: "<svg/>", dirty: true, result: "fallito" });
  });
});

describe("la chiusura della finestra protegge ogni buffer sporco", () => {
  let api: DocumentSessionApi;

  beforeEach(() => {
    api = fakeApi();
    vi.stubGlobal("setTimeout", vi.fn(() => 0));
    vi.stubGlobal("clearTimeout", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("senza salvataggio né bozza restituisce il documento, e il buffer resta", async () => {
    api.writeDocument = vi.fn(async () => {
      throw new Error("disco pieno");
    });
    api.saveDraft = vi.fn(async () => {
      throw new Error("disco pieno");
    });
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("Benvenuto.md");
    acceptText(sessions, "Benvenuto.md", "LAVORO NON PERSISTITO");

    await expect(sessions.flushBeforeClose()).resolves.toEqual(["Benvenuto.md"]);

    expect(api.writeDocument).toHaveBeenCalled();
    expect(api.saveDraft).toHaveBeenCalled();
    expect(sessions.inspect("Benvenuto.md")).toMatchObject({
      text: "LAVORO NON PERSISTITO",
      dirty: true,
      lifecycle: "open",
    });
  });

  it("una bozza scritta basta a proteggere un salvataggio fallito", async () => {
    api.writeDocument = vi.fn(async () => {
      throw new Error("disco pieno");
    });
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("Benvenuto.md");
    acceptText(sessions, "Benvenuto.md", "testo in bozza");

    await expect(sessions.flushBeforeClose()).resolves.toEqual([]);
    expect(api.saveDraft).toHaveBeenLastCalledWith("Benvenuto.md", "testo in bozza", "rev-1");
  });

  it("una bozza fallita prima della chiusura si riprova, e la riuscita la autorizza", async () => {
    api.writeDocument = vi.fn(async () => {
      throw new Error("disco pieno");
    });
    api.saveDraft = vi
      .fn()
      .mockRejectedValueOnce(new Error("disco pieno"))
      .mockResolvedValue(undefined);
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("Benvenuto.md");
    acceptText(sessions, "Benvenuto.md", "testo");

    await expect(sessions.flushBeforeClose()).resolves.toEqual([]);
    expect(api.saveDraft).toHaveBeenCalledTimes(2);
  });

  it("un buffer salvato non ha niente da proteggere", async () => {
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("Benvenuto.md");
    acceptText(sessions, "Benvenuto.md", "salvato");

    await expect(sessions.flushBeforeClose()).resolves.toEqual([]);
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it("segue la sessione rinominata mentre il flush aspetta, e ne mette in bozza il testo", async () => {
    let release: (revision: string) => void = () => {};
    api.writeDocument = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve; }))
      .mockResolvedValue("rev-3");
    const sessions = new DocumentSessionCollection(api);
    await sessions.read("Benvenuto.md");
    acceptText(sessions, "Benvenuto.md", "salvataggio vecchio");
    const inFlight = sessions.flush("Benvenuto.md");
    await Promise.resolve();
    acceptText(sessions, "Benvenuto.md", "ULTIMA BATTUTA");

    const closing = sessions.flushBeforeClose();
    await Promise.resolve();
    expect(sessions.rename("Benvenuto.md", "DopoFlush.md")).toMatchObject({ kind: "renamed" });
    release("rev-2");
    await inFlight;

    await expect(closing).resolves.toEqual([]);
    expect(api.saveDraft).toHaveBeenCalledWith("DopoFlush.md", "ULTIMA BATTUTA", "rev-1");
    // Il salvataggio successivo va al nome nuovo, non a quello vecchio.
    await expect(sessions.flushPendingSave()).resolves.toEqual([]);
    expect(api.writeDocument).toHaveBeenLastCalledWith(
      "DopoFlush.md",
      "ULTIMA BATTUTA",
      { kind: "descends_from", value: "rev-1" },
      null,
      expect.any(String),
    );
  });
});

describe("il vault delle sessioni (FUB-001)", () => {
  const A = "/vault/A";
  const B = "/vault/B";
  let current: string | null;
  let api: DocumentSessionApi;
  let sessions: DocumentSessionCollection;
  const base = { kind: "descends_from", value: "rev-1" } as const;

  beforeEach(() => {
    current = A;
    api = fakeApi();
    vi.stubGlobal("setTimeout", vi.fn(() => 1));
    vi.stubGlobal("clearTimeout", vi.fn());
    sessions = new DocumentSessionCollection(api, () => current);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("legge e scrive nel vault in cui il documento è stato aperto, anche se il corrente cambia", async () => {
    await sessions.read("nota.md");
    expect(api.openDocument).toHaveBeenCalledWith("nota.md", expect.any(String), A);
    acceptText(sessions, "nota.md", "testo mio");

    current = B; // l'host ha aperto il vault nuovo e la shell non lo sa ancora
    await sessions.flush("nota.md");

    expect(api.writeDocument).toHaveBeenCalledWith("nota.md", "testo mio", base, A, expect.any(String));
    expect(api.writeDocument).not.toHaveBeenCalledWith("nota.md", "testo mio", base, B, expect.any(String));
  });

  it("la bozza e il suo scarto nominano lo stesso vault della sessione", async () => {
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "testo mio");
    current = B;

    await sessions.flushDraft("nota.md");
    expect(api.saveDraft).toHaveBeenCalledWith("nota.md", "testo mio", "rev-1", A);

    // Salvato il testo, la bozza non serve più: anche il suo scarto va nel vault giusto.
    await sessions.flush("nota.md");
    await vi.waitFor(() => expect(api.discardDraft).toHaveBeenCalledWith("nota.md", A));
  });

  it("senza un vault noto le chiamate non nominano un vault", async () => {
    current = null;
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "testo mio");
    await sessions.flush("nota.md");

    expect(api.openDocument).toHaveBeenCalledWith("nota.md", expect.any(String));
    expect(api.writeDocument).toHaveBeenCalledWith("nota.md", "testo mio", base, null, expect.any(String));
  });

  it("una lettura in volo che finisce dopo il cambio di vault non crea una sessione", async () => {
    let finish!: (source: DocumentSource) => void;
    api.readDocument = vi.fn(
      () =>
        new Promise<DocumentSource>((resolve) => {
          finish = resolve;
        }),
    );
    const reading = sessions.read("nota.md");

    current = B; // mentre la lettura aspetta, la shell passa all'altro vault
    finish({ text: "dal vault A", revision: "rev-A", format_id: "markdown", source_kind: "text", text_kind: "source" });

    await expect(reading).resolves.toBe("dal vault A");
    expect(sessions.get("nota.md")).toBeUndefined();
  });

  it("dopo la chiusura delle sessioni lo stesso path riparte dal vault nuovo", async () => {
    await sessions.read("nota.md");
    current = B;
    sessions.closeAll();

    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "testo del vault B");
    await sessions.flush("nota.md");

    expect(api.writeDocument).toHaveBeenLastCalledWith("nota.md", "testo del vault B", base, B, expect.any(String));
  });

  it("un file senza formato si salva a byte nel vault della sua sessione", async () => {
    api.readDocument = vi.fn(
      async (): Promise<DocumentSource> => ({
        text: "<svg/>",
        revision: "rev-s",
        format_id: null,
        source_kind: "text", text_kind: "source",
      }),
    );
    await sessions.read("disegno.svg");
    acceptText(sessions, "disegno.svg", "<svg>nuovo</svg>");

    current = B;
    await sessions.flush("disegno.svg");

    expect(api.resourceWrite).toHaveBeenCalledWith("disegno.svg", expect.any(Uint8Array), "rev-s", A);
    expect(api.writeDocument).not.toHaveBeenCalled();
  });

  it("la bozza di un file sparito dal disco resta nel vault in cui è sparito", async () => {
    await sessions.read("nota.md");
    acceptText(sessions, "nota.md", "lavoro non salvato");
    current = B;

    const outcome = sessions.handleExternalRemoval("nota.md");

    expect(outcome).toMatchObject({ kind: "removed", dirty: true, text: "lavoro non salvato" });
    // La bozza passa dalla coda delle bozze della sessione (#485): parte al
    // giro dopo, dietro quelle già in volo.
    await vi.waitFor(() => {
      expect(api.saveDraft).toHaveBeenCalledWith("nota.md", "lavoro non salvato", "rev-1", A);
    });
  });

  it("una bozza recuperata appartiene al vault corrente del recupero", async () => {
    sessions.restore("bozza.md", "testo ritrovato", { kind: "dictated" });
    current = B;

    await sessions.flushDraft("bozza.md");

    expect(api.saveDraft).toHaveBeenCalledWith("bozza.md", "testo ritrovato", null, A);
  });

  it("`vaultFor` dice il vault di un buffer aperto e, per il resto, il corrente", async () => {
    await sessions.read("nota.md");
    current = B;

    expect(sessions.vaultFor("nota.md")).toBe(A);
    expect(sessions.vaultFor("altra.md")).toBe(B);
    current = null;
    expect(sessions.vaultFor("altra.md")).toBeUndefined();
  });
});
