// @vitest-environment happy-dom
// Il presidio di **un ordine**, dentro l'ascoltatore di `document_changed`.
//
// Il conto degli echoes (`state/salvataggio.ts`) ha due metà: una scrittura ne
// mette uno prima di partire, e l'evento con l'identità di una nostra
// scrittura — attore `user` fuori da un lotto — lo consuma — «anche se non
// c'è niente da dire», che è la frase scritto sul campo `Buffer.echoes`. Un eco
// che nessuno consuma **non si ripara più**: resta appeso, e il prossimo
// evento con quella stessa identità — la scrittura diretta di un'altra
// finestra — viene scambiato per il nostro. Cioè l'avviso che doveva comparire
// non compare, ed è il difetto che `consumaCambioSotto` esiste per non avere.
//
// Per un po' quella promessa è stata falsa, e per un motivo che nessuna delle
// due metà poteva vedere: nell'ascoltatore, **davanti** alla consumazione, c'era
// una guardia che chiedeva tutt'altro — se qualche riquadro stia mostrando quel
// documento. Le due domande non hanno niente in comune: il conto è del buffer,
// e un buffer esiste anche quando nessun riquadro lo mostra (fra la chiusura di
// una linguetta e il `flush` che la congeda, che è proprio il momento in cui una
// scrittura in volo produce il suo eco).
//
// # Perché questo presidio guarda il sorgente
//
// Perché è dove il difetto vive. Il conto `echoes-fuori-dal-padrone`
// (`.github/scripts/conteggi.mjs`) tiene ferme le due metà nel file che le
// possiede, e non vede un ordine; `salvataggio.test.ts` prova la funzione, che
// è giusta e lo era già. Ciò che è sbagliato è **quale riga viene prima**, e
// l'unico attore che lo vede senza montare l'intero modulo dei riquadri — DOM,
// editor, layout, IPC — è chi legge il file. È la forma del presidio di
// `hidden` (`ui/hidden.test.ts`): `?raw` di Vite e non `node:fs`, perché
// `tsconfig.json` dichiara i soli tipi di Vite e un presidio della shell non
// deve essere il primo a usare un'API che nella webview non esiste.
//
// Zona cieca dichiarata: si guarda il **corpo dell'ascoltatore**, ritagliato
// fra la sua apertura e la successiva `onEvent(`. Una guardia scritto dentro una
// funzione chiamata da qui, invece che qui, non la vedrebbe — ed è il verso
// giusto in cui sbagliare, perché quella guardia dovrebbe essere scritto apposta.
import { describe, expect, it, vi } from "vitest";

import source from "./document.ts?raw";
import sessionSource from "../state/document-session.ts?raw";
import explorer from "./explorer.ts?raw";
import {
  DocumentSurfaceRegistry,
  type EditorSurface,
  type SurfaceFactory,
  type SurfaceRegistration,
  type SurfaceRequest,
} from "../editors/core/registry";
import {
  createMarkdownSurfaceFactory,
  createPlainTextSurfaceFactory,
  type MarkdownEditorSurface,
  type PlainTextSurface,
} from "../editors/text/factories";

// Il presidio del ricongiungimento importa la decisione dal modulo puro
// `state/drafts.ts`, mentre l'owner costruisce e conserva le sessioni.
import type { DraftInfo, ViewContext, WriteBase } from "../host/contract";
import { rejoinDrafts, type DraftBufferStore } from "../state/drafts";


function declaredMode<Id>(
  surface: { readonly modes: readonly { readonly id: Id }[] },
  id: string,
): Id {
  const mode = surface.modes.find((candidate) => candidate.id === (id as Id));
  if (!mode) throw new Error(`modalità non dichiarata: ${id}`);
  return mode.id;
}
/// Il corpo dell'ascoltatore di `document_changed`, dalla sua apertura al
/// prossimo `onEvent(`.
function body(): string {
  const opens = source.indexOf('onEvent("document_changed"');
  expect(opens, "l'ascoltatore di `document_changed` non si chiama più così").toBeGreaterThan(-1);
  const after = source.indexOf("onEvent(", opens + 1);
  return source.slice(opens, after === -1 ? source.length : after);
}

describe("l'ascoltatore di document_changed", () => {
  it("delega echo e politica di ricarica alla sessione prima degli effetti UI", () => {
    const text = body();
    const sessionCall = text.indexOf("documentSessions.handleExternalChange(");
    const effectCall = text.indexOf("applyExternalChange(");
    expect(sessionCall, "la sessione non riceve il fatto esterno").toBeGreaterThan(-1);
    expect(effectCall, "il pannello non applica gli effetti del risultato").toBeGreaterThan(-1);
    expect(sessionCall).toBeLessThan(effectCall);
    expect(text).not.toContain("warnIfBufferCovers(");
    expect(text).not.toContain("documentSessions.isDirty(");
  });
});


function methodBodyOf(signature: string, text: string = sessionSource): string {
  const opens = text.indexOf(signature);
  expect(opens, `\`${signature}\` non si chiama più così`).toBeGreaterThan(-1);
  const closes = text.indexOf("\n  }\n", opens);
  return text.slice(opens, closes === -1 ? text.length : closes);
}

// **I due ritardi si fermano insieme** (difetto 0211).
//
// Chi chiede conferma di una cancellazione non ha deciso «non salvare»: ha
// deciso che quel testo non tocchi il disco finché non c'è una risposta. La
// domanda la disegna il sistema operativo e può restare aperta quanto vuole
// l'utente; il ritardo della bozza è di un secondo. Fermando il solo
// salvataggio, la rete si stendeva *dentro* la finestra in cui la shell aveva
// deciso che non si scrive — e sulla strada del sì quella bozza sopravviveva
// alla nota, per tornare al riavvio dopo come `orfana`.
//
// Il presidio guarda il sorgente per la ragione scritto in cima a questo file:
// `document.ts` non si monta in un test senza DOM, editor, layout e IPC, e ciò
// che è sbagliato qui è **quali righe ci sono**, non un valore che una
// funzione pura potrebbe rendere.
describe("sospendere e riprendere i ritardi", () => {
  it("ne ferma due, non uno", () => {
    const text = methodBodyOf("suspend(): boolean");
    expect(text).toContain("#clearSaveTimer()");
    expect(
      text,
      "`suspend` ferma il salvataggio e la bozza insieme: la rete non deve " +
        "scriversi durante la conferma di una cancellazione",
    ).toContain("#clearDraftTimer()");
  });

  it("ne rimette in coda due, non uno", () => {
    const text = methodBodyOf("resume(): void");
    expect(text).toContain("scheduleSave()");
    expect(
      text,
      "la ripresa riaccende il salvataggio e la bozza: dopo un ripensamento " +
        "il documento sporco torna ad avere la sua rete sotto",
    ).toContain("scheduleDraft()");
  });

  it("tiene un posto di sospensione privato a ogni sessione", () => {
    expect(sessionSource).toContain("suspended: boolean");
    expect(sessionSource).not.toContain("const suspended = new Set<string>()");
    expect(source).not.toContain("let sospeso: string | null");
  });
});
describe("la sola lettura della cancellazione", () => {
  it("propaga il pending a ogni superficie, anche a una montata dopo", () => {
    expect(sessionSource).toContain("pendingDeletion: boolean");
    expect(source).toContain("setReadOnlyForDocument(event.id, event.pending)");
    expect(source).toContain("r.surface?.setReadOnly(documentSessions.isDeletionPending(tab.doc))");
    expect(source).toContain("r.surface?.setReadOnly(documentSessions.isDeletionPending(doc))");
  });
});

/// Il corpo di un ascoltatore, dalla sua apertura al prossimo `onEvent(`.
/// Stesso ritaglio — e stessa zona cieca dichiarata — di `corpo()`.
function listenerBody(event: string): string {
  const opens = source.indexOf(`onEvent("${event}"`);
  expect(opens, `l'ascoltatore di \`${event}\` non si chiama più così`).toBeGreaterThan(-1);
  const after = source.indexOf("onEvent(", opens + 1);
  return source.slice(opens, after === -1 ? source.length : after);
}
describe("l'ascoltatore di document_removed", () => {
  it("chiede alla sessione la disposizione prima di invalidare e rimuovere le superfici", () => {
    const text = listenerBody("document_removed");
    const sessionCall = text.indexOf("documentSessions.handleExternalRemoval(");
    const invalidateCall = text.indexOf("invalidateLoads(");
    const layoutCall = text.indexOf("removeEverywhere(");
    expect(sessionCall).toBeGreaterThan(-1);
    expect(invalidateCall).toBeGreaterThan(-1);
    expect(layoutCall).toBeGreaterThan(-1);
    expect(sessionCall).toBeLessThan(invalidateCall);
    expect(invalidateCall).toBeLessThan(layoutCall);
    expect(text).not.toContain("documentSessions.isDirty(");
  });
});

// **La finestra di migrazione di una rinomina** (difetto 0210).
//
// Chi rinomina mette in salvo prima di chiedere, e quello basterebbe se fra la
// richiesta e l'evento che migra l'identità non ci fosse niente. C'è un giro
// IPC che riscrive i wikilink entranti di tutto il vault, e in quel tempo si
// batte: la battuta programmava un salvataggio col nome di prima, che scadeva
// mentre il file si era già mosso, e il kernel ricreava la nota al vecchio
// path — la stessa nota in due posti, con due contenuti diversi.
//
// Le tre righe che tengono la proprietà stanno in tre punti che non si vedono
// l'un l'altro: il cancello sui due ritardi (senza, si ferma solo ciò che era
// già armato e la finestra resta scoperta), lo scioglimento sull'evento (senza,
// il buffer resta fermo per sempre e il testo non raggiunge più il disco) e la
// porta unica da cui si rinomina (senza, il secondo chiamante non eredita
// niente).
describe("la finestra di migrazione di una rinomina", () => {
  it("il fermo copre anche i ritardi che nascono dopo", () => {
    for (const signature of ["scheduleSave(): void", "scheduleDraft(): void"]) {
      expect(
        methodBodyOf(signature),
        `\`${signature}\` non guarda il fermo: una battuta dentro la finestra ` +
          "di migrazione programma una scrittura col nome di prima",
      ).toContain("#state.suspended");
    }
  });

  it("chi rinomina tiene fermo prima di chiedere, e scioglie se la richiesta fallisce", () => {
    const text = methodBodyOf("async renameKeepingBuffer(from: string, to: string)");
    const stopButton = text.indexOf("session?.suspend()");
    const renameCall = text.indexOf("await renameNote(");
    expect(stopButton, "non tiene più fermo il documento").toBeGreaterThan(-1);
    expect(renameCall, "non chiede più la rinomina").toBeGreaterThan(-1);
    expect(stopButton, "chiede la rinomina prima di tenere fermo il documento").toBeLessThan(renameCall);
    expect(
      text,
      "una rinomina che fallisce non scioglie il fermo",
    ).toContain("session?.resume()");
  });

  it("il fermo si scioglie dove finisce la finestra", () => {
    expect(
      listenerBody("document_renamed"),
      "l'evento che migra l'identità non aggiorna la sessione",
    ).toContain("documentSessions.rename(e.from, e.to)");
  });

  it("si rinomina da una porta sola", () => {
    expect(
      explorer,
      "l'esploratore torna a chiamare `renameNote` da sé",
    ).not.toContain("renameNote(");
  });
});
//
// Il recupero corre DOPO che `sincronizza` ha disegnato le linguetta ripristinate dal
// layout, e disegnarle significa aver già letto il disco in un buffer **pulito**
// (`leggiBuffer`). La guardia «se un buffer c'è già, salta» scambiava quella
// copia del disco per il testo più recente della bozza: la bozza restava dov'era,
// la notifica la contava come ritrovata, e il primo salvataggio (`dropDraft`)
// la cancellava — il testo non salvato, l'unica copia, spariva senza che
// nessuno l'avesse mai visto. È il caso in cui una bozza esiste per definizione:
// un salvataggio rifiutato dal disco (pieno, sola lettura, share caduta) alla
// chiusura della finestra, con la linguetta ancora nel layout al riavvio.
//
// La condizione giusta è lo **sporco**, non l'esistenza: un buffer sporco porta
// un'identità diversa — un testo battuto dopo, in questa sessione — e la bozza
// resta orfana sul disco; un buffer pulito è solo il disco riletto, e la bozza
// rientra sopra di lui, sporcandolo, una volta sola (il buffer sporco che ne
// nasce ferma la voce che nomina lo stesso documento). E il conto restituito
// dice quante sono rientrate davvero: la notifica «è stato ritrovato» con
// dentro una bozza saltata sarebbe una bugia.
//
// # Perché qui si prova il comportamento, non il sorgente
//
// Gli altri presidi di questo file guardano il sorgente perché ciò che è
// sbagliato è l'**ordine delle righe** — una cosa che nessuna funzione pura
// potrebbe rendere. Il ricongiungimento no: la decisione sta in
// `rejoinDrafts` (`state/drafts.ts`), la metà di `recoverDrafts` che non
// tocca né DOM, né editor, né IPC — riceve la mappa dei buffer e la muta —
// ed è un
// comportamento osservabile: quale testo finisce nel buffer, con che stato, e
// quante bozze il conto dice rientrate. Si prova quello, come si deve.
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
    base: WriteBase;
  }

  class TestStore implements DraftBufferStore {
    readonly buffers = new Map<string, TestBuffer>();

    constructor(entries: Array<[string, TestBuffer]> = []) {
      for (const [doc, buffer] of entries) this.buffers.set(doc, buffer);
    }

    get(doc: string): TestBuffer | undefined {
      return this.buffers.get(doc);
    }

    restore(doc: string, text: string, base: WriteBase): void {
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

  it("senza buffer la bozza diventa il buffer, e chi non sapeva la base detta", () => {
    const buffer = new TestStore();

    const rejoined = rejoinDrafts([draft("nuova.md", "il testo non salvato")], buffer);

    expect(rejoined).toHaveLength(1);
    expect(buffer.buffers.get("nuova.md")).toMatchObject({
      text: "il testo non salvato",
      dirty: true,
      base: { kind: "dictated" },
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

/// Il corpo di una funzione a colonna zero, dalla sua firma alla chiusura.
/// Stessa zona cieca dichiarata di `corpo()`: guarda quali righe ci sono,
/// perché ciò che è sbagliato qui è un giro che non deve più esistere.
function functionBody(signature: string): string {
  const opens = source.indexOf(signature);
  expect(opens, `\`${signature}\` non si chiama più così`).toBeGreaterThan(-1);
  const closes = source.indexOf("\n}\n", opens);
  return source.slice(opens, closes === -1 ? source.length : closes);
}

// **La validazione e la sincronia fra superfici appartengono alla sessione.**
//
// Finché il pannello misurava l'operazione sul testo autorevole e poi
// girava i riquadri per sincronizzarli, la regola del buffer unico viveva in
// due posti che nessun tipo legava fra loro. Ora il pannello porta
// l'operazione alla sessione e applica al proprio editor ciò che la sessione
// diffonde; i presidi guardano il sorgente per la ragione scritta in cima a
// questo file — ciò che è sbagliato sarebbe una riga di giro in più.
describe("il pannello non possiede più la validazione né la sincronia fra superfici", () => {
  it("la battuta porta l'operazione alla sessione, e basta", () => {
    const text = functionBody("function written(");
    expect(text).toContain("documentSessions.acceptSurfaceChange(");
    expect(text).not.toContain("tryApplyOperation(");
    expect(text).not.toContain("panesWithDoc(");
    expect(text).not.toContain("syncDoc({");
  });

  it("non resta un giro di sync autorevole nel pannello", () => {
    expect(source).not.toContain("function syncDocument(");
  });

  it("il recupero delle bozze non sincronizza più gli editor a mano", () => {
    const text = functionBody("export async function recoverDrafts(");
    expect(text).not.toContain("editor.syncDoc(");
    expect(text).not.toContain("panesWithDoc(");
  });

  it("mostrare un documento attacca la superficie, e cambiare linguetta stacca prima", () => {
    const text = functionBody("async function show(");
    const detach = text.indexOf("detachSurface(r)");
    const attach = text.indexOf("attachSurface(r, tab.doc)");
    expect(detach, "cambiando ciò che il riquadro mostra, la registrazione vecchia resta appesa").toBeGreaterThan(-1);
    expect(attach, "il documento mostrato non arriva alla sessione come superficie").toBeGreaterThan(-1);
    expect(detach).toBeLessThan(attach);
  });

  it("prenota l'apertura prima del flush e non trattiene un owner su errore", () => {
    const text = functionBody("export async function openDocument(");
    const retain = text.indexOf("documentSessions.retain(id)");
    const queue = text.indexOf("openQueue.enqueue(");
    expect(retain, "l'apertura non prenota l'owner prima dell'attesa").toBeGreaterThan(-1);
    expect(queue, "l'apertura non passa dalla coda").toBeGreaterThan(-1);
    expect(retain).toBeLessThan(queue);
    expect(text).toContain("releaseIntent();");
    expect(text).toContain("if (!isOpen(id)) await documentSessions.release(id);");
  });

  it("chiudere un riquadro stacca la registrazione prima di buttare l'editor", () => {
    const text = functionBody("function buildStructure(");
    const detach = text.indexOf("detachSurface(r)");
    const destroy = text.indexOf("destroySurface(r)");
    expect(detach).toBeGreaterThan(-1);
    expect(destroy).toBeGreaterThan(detach);
  });
});

describe("il pannello monta le superfici dal registro", () => {
  it("non costruisce più editor locali", () => {
    expect(source).not.toContain("createEditor(");
  });

  it("monta qualunque factory selezionata dal registro", () => {
    const text = functionBody("async function show(");
    expect(text).toContain("surfaceRequestForDocument(tab.doc)");
    expect(text).toContain("ensureSurface(r, tab.doc, request)");
    expect(source).toContain("deps.surfaceRegistry.mount(request");
    expect(source).not.toContain("createMarkdownSurfaceFactory(");
  });

  it("passa al registro soltanto dati generici della superficie testuale", () => {
    const context = functionBody("function surfaceMountContext(");
    expect(context).not.toContain("markdownCallbacks");
    expect(context).not.toContain("completions");
    expect(context).not.toContain("searchTag");
    expect(context).not.toContain("notesByName");
    expect(context).not.toContain("vaultTags");
  });

  it("deriva la richiesta dal documento, non dalle estensioni gestite", () => {
    const text = functionBody("async function show(");
    expect(text).toContain("surfaceRequestForDocument(tab.doc)");
    expect(text).not.toContain("state.handledExtensions");
    expect(text).not.toContain("handledExtensions");
    expect(text).not.toContain('formatKey: "md"');
  });

  it("applica il riallineamento solo alle superfici testuali", () => {
    const text = functionBody("function written(");
    expect(text).toContain("documentSessions.acceptSurfaceChange(");
    expect(text).toContain("isTextSurface(source.surface)");
    expect(text).not.toContain("tryApplyOperation(");
  });

  it("stacca una sessione prima di distruggere la superficie", () => {
    const text = functionBody("function buildStructure(");
    expect(text.indexOf("detachSurface(r)")).toBeLessThan(text.indexOf("destroySurface(r)"));
  });
  it("riusa solo il documento e la key della superficie effettivamente montata", () => {
    const text = functionBody("function ensureSurface(");
    expect(text).toContain("deps.surfaceRegistry.select(request)");
    expect(text).toContain("r.selectionKey === selected.key");
    expect(text).toContain("r.surfaceDocumentId === doc");
    expect(text).toContain("mounted = deps.surfaceRegistry.mount(");
    expect(text).toContain("r.surface = mounted.surface");
    expect(text).toContain("r.selectionKey = mounted.key");
    expect(text).not.toContain("r.selectionKey = selected.key");
    expect(text).not.toContain("surfaceFamily");
    expect(text).not.toContain("surfaceProfile");
  });
  it("cancella insieme le identità della superficie prima del suo destroy", () => {
    const text = functionBody("function destroySurface(");
    const destroy = text.indexOf("surface?.destroy()");
    expect(text.indexOf("r.surface = null")).toBeLessThan(destroy);
    expect(text.indexOf("r.selectionKey = null")).toBeLessThan(destroy);
    expect(text.indexOf("r.surfaceDocumentId = null")).toBeLessThan(destroy);
  });
  it("riconosce una superficie testuale generica senza API Markdown", () => {
    const text = functionBody("function isTextSurface(");
    expect(text).toContain('"setDoc"');
    expect(text).toContain('"syncDoc"');
    expect(text).toContain('"selections"');
    expect(text).toContain('"revealByteOffset"');
    expect(text).not.toContain("setSyntaxForms");
    expect(text).not.toContain("setLivePreview");
  });

});
type RequestBox = {
  value: SurfaceRequest;
  byDocument?: Readonly<Record<string, SurfaceRequest>>;
};

function mockPanelModules(request: RequestBox) {
  const shellState = { currentDoc: null as string | null, handledExtensions: [] as string[] };
  const contexts: ViewContext[] = [];
  let languageListener: (() => void) | undefined;
  let language = "initial";
  const flush = vi.fn(async (_doc: string) => {});
  const previews = vi.fn(async (_preview: HTMLElement, _doc: string) => {});
  const setActiveContext = vi.fn(async (context: ViewContext) => {
    contexts.push(context);
    return [];
  });
  const session = {
    subscribe: () => () => {},
    isDirty: () => false,
    isDeletionPending: () => false,
    saveState: () => null,
    attachSurface: () => () => {},
    read: async () => "# Titolo",
    flush,
    flushPendingSave: async () => {},
  };

  vi.doMock("../editors/bootstrap", () => ({
    surfaceRequestForDocument: (doc: string) => request.byDocument?.[doc] ?? request.value,
  }));
  vi.doMock("../host/ipc", () => ({ api: { setActiveContext } }));
  vi.doMock("../host/query", () => ({
    WITHOUT_PAGE: undefined,
    notesByName: () => Promise.resolve([]),
    resolvedReference: () => Promise.resolve(null),
    syntaxForms: () => Promise.resolve([]),
    unsavedDrafts: () => Promise.resolve([]),
    vaultTags: () => Promise.resolve([]),
  }));
  vi.doMock("../state/kernel", () => ({ onEvent: () => {} }));
  vi.doMock("../state/recent", () => ({ existingRecentNotes: () => [] }));
  vi.doMock("../state/store", () => ({
    emit: () => {},
    on: () => {},
    readState: () => null,
    state: shellState,
    writeState: () => {},
  }));
  vi.doMock("../state/drafts", () => ({
    CASE_KEY: {},
    caseOf: () => null,
    toRecover: () => [],
  }));
  vi.doMock("../state/document-session", () => ({
    documentSessions: session,
    isDocumentDeletedDuringRead: () => false,
  }));
  vi.doMock("../state/vault", () => ({ createNote: () => Promise.resolve() }));
  vi.doMock("../ui/commands", () => ({
    allCommands: () => [
      { id: "shell.mode.live", binding: "Mod-Shift-L" },
      { id: "shell.mode.reading", binding: "Mod-E" },
    ],
    registerShellCommand: () => {},
  }));
  vi.doMock("../ui/notify", () => ({ notify: () => {} }));
  vi.doMock("./preview", () => ({
    clearPreview: () => {},
    updatePreview: previews,
  }));
  vi.doMock("../ui/views", () => ({
    mountViewInPane: () => Promise.resolve(),
    primaryView: () => undefined,
    unmountViewFromPane: () => {},
  }));
  vi.doMock("../host/errors", () => ({ errorText: () => "errore" }));
  vi.doMock("../i18n/strings", () => ({
    onLanguage: (listener: () => void) => {
      languageListener = listener;
    },
    t: (key: string) => `${language}:${key}`,
  }));
  vi.doMock("../ui/tooltip", () => ({ setTooltip: () => {} }));

  return {
    contexts,
    flush,
    previews,
    refreshLanguage() {
      language = "updated";
      languageListener?.();
    },
  };
}

function panelDom(): void {
  document.body.innerHTML =
    '<main id="panes"></main>' +
    '<span id="mode-switch" class="segmented segmented--titlebar" role="group" ' +
    'data-i18n-label="mode.group" aria-label="Modalità del pannello"></span>';
}

type DestroyHook = {
  current: (() => void) | undefined;
};

type GenericSurfaceMount = {
  readonly documentId: string;
  readonly surface: EditorSurface;
};

type GenericSurfaceFixture = {
  readonly factory: SurfaceFactory;
  readonly mounts: GenericSurfaceMount[];
  readonly destroys: { calls: number };
};

function genericSurfaceFixture(
  label: string,
  hook: DestroyHook = { current: undefined },
  destroyError?: Error,
): GenericSurfaceFixture {
  const mounts: GenericSurfaceMount[] = [];
  const destroys = { calls: 0 };
  const factory: SurfaceFactory = {
    family: "grid",
    profile: "generic",
    mount(_request, context) {
      const element = context.parent.ownerDocument.createElement("div");
      element.className = `generic-surface-${label}`;
      context.parent.append(element);
      const surface: EditorSurface = {
        family: "grid",
        surfaceId: `${label}-${mounts.length + 1}`,
        focus() {},
        setReadOnly() {},
        setTheme() {},
        captureViewState() {
          return { version: 1, value: null };
        },
        restoreViewState() {},
        suspend() {},
        resume() {},
        destroy() {
          destroys.calls += 1;
          if (destroyError) throw destroyError;
          element.remove();
          hook.current?.();
        },
      };
      mounts.push({ documentId: context.documentId, surface });
      return surface;
    },
  };
  return { factory, mounts, destroys };
}


describe("modalità della superficie nel percorso reale del pannello", () => {
  it("usa il catalogo della superficie per modalità interne e proietta il contesto a source", async () => {
    vi.resetModules();
    const request: RequestBox = { value: { formatKey: "modeful-grid" } };
    const harness = mockPanelModules(request);
    const modes = [
      { id: "navigate" as never, labelKey: "mode.navigate" },
      { id: "edit" as never, labelKey: "mode.edit" },
    ] as const;
    let mounted:
      | (EditorSurface & {
          readonly modes: typeof modes;
          readonly defaultMode: (typeof modes)[number]["id"];
          mode(): (typeof modes)[number]["id"];
          setMode(id: (typeof modes)[number]["id"]): void;
        })
      | undefined;
    const factory: SurfaceFactory = {
      family: "grid",
      profile: "modeful-grid",
      mount(_request, context) {
        const element = context.parent.ownerDocument.createElement("div");
        element.className = "modeful-grid";
        context.parent.append(element);
        let current = modes[0].id;
        mounted = {
          family: "grid",
          surfaceId: "modeful-grid-1",
          modes,
          defaultMode: modes[0].id,
          mode: () => current,
          setMode(id) {
            if (modes.some((mode) => mode.id === id)) current = id;
          },
          focus() {},
          setReadOnly() {},
          setTheme() {},
          captureViewState() {
            return { version: 1, value: null };
          },
          restoreViewState() {},
          suspend() {},
          resume() {},
          destroy() {
            element.remove();
          },
        };
        return mounted;
      },
    };
    const registry = new DocumentSurfaceRegistry();
    registry.register({
      owner: "test-modeful-grid",
      family: "grid",
      profile: "modeful-grid",
      formatKey: "modeful-grid",
      factory,
    });

    panelDom();
    const { mountDocument, publishContext, setMode, synchronize } = await import("./document");
    const { layout, openIn } = await import("../state/layout");
    mountDocument({ surfaceRegistry: registry });
    openIn("main", "note.grid", layout);
    await synchronize();
    await publishContext();

    const switcher = document.querySelector<HTMLElement>("#mode-switch");
    expect([...switcher?.querySelectorAll<HTMLButtonElement>("button") ?? []].map(
      (button) => button.dataset.mode,
    )).toEqual(["navigate", "edit"]);
    expect(document.querySelector<HTMLElement>(".pane")?.dataset.mode).toBe("navigate");
    expect(harness.contexts[harness.contexts.length - 1]?.mode).toBe("source");

    const surface = mounted;
    expect(surface).toBeDefined();
    await setMode(surface!.modes[1].id);
    expect(surface!.mode()).toBe("edit");
    expect(
      switcher?.querySelector<HTMLButtonElement>('button[data-mode="edit"]')?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(layout.panes.main?.mode).toBe("source");
    expect(harness.contexts[harness.contexts.length - 1]?.mode).toBe("source");
  });
  it("segue le tre modalità dichiarate da Markdown e aggiorna Lettura", async () => {
    vi.resetModules();
    const request: RequestBox = {
      value: { family: "text", profile: "markdown", formatKey: "md", species: "text/markdown" },
    };
    const harness = mockPanelModules(request);
    const factory = createMarkdownSurfaceFactory();
    const mount = vi.spyOn(factory, "mount");
    const registry = new DocumentSurfaceRegistry();
    registry.register({
      owner: "test-markdown",
      family: "text",
      profile: "markdown",
      formatKey: "md",
      species: "text/markdown",
      factory,
    });

    panelDom();
    const { mountDocument, publishContext, setMode, synchronize } = await import("./document");
    const { layout, openIn } = await import("../state/layout");
    mountDocument({ surfaceRegistry: registry });
    openIn("main", "note.md", layout);
    await synchronize();
    await publishContext();
    expect(document.querySelector<HTMLElement>(".pane")?.dataset.mode).toBe("live_preview");
    expect(harness.contexts[harness.contexts.length - 1]?.mode).toBe("live_preview");
    const surface = mount.mock.results[0]?.value as MarkdownEditorSurface;
    expect(surface.mode()).toBe("live_preview");
    const switcher = document.querySelector<HTMLElement>("#mode-switch");
    const buttons = [...(switcher?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    expect(buttons.map((button) => button.dataset.mode)).toEqual([
      "source",
      "live_preview",
      "reading",
    ]);
    expect(buttons.map((button) => button.dataset.i18n)).toEqual([
      "mode.source",
      "mode.live",
      "mode.reading",
    ]);
    expect(buttons.map((button) => button.dataset.i18nTitle)).toEqual([
      "mode.source.hint",
      "mode.live.hint",
      "mode.reading.hint",
    ]);
    expect(switcher?.querySelector("#mode-live-key")?.textContent).toBe("Mod-Shift-L");
    expect(switcher?.querySelector("#mode-reading-key")?.textContent).toBe("Mod-E");
    expect(
      switcher?.querySelector<HTMLButtonElement>('button[data-mode="live_preview"]')?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");

    const setSurfaceMode = vi.spyOn(surface, "setMode");

    await setMode(declaredMode(surface, "source"));
    expect(surface.mode()).toBe("source");
    await setMode(declaredMode(surface, "live_preview"));
    expect(surface.mode()).toBe("live_preview");
    await setMode(declaredMode(surface, "reading"));
    expect(surface.mode()).toBe("reading");
    expect(setSurfaceMode.mock.calls.map(([mode]) => mode)).toEqual([
      "source",
      "live_preview",
      "reading",
    ]);
    expect(harness.flush).toHaveBeenCalledWith("note.md");
    expect(harness.previews).toHaveBeenCalled();

    await synchronize();
    const root = document.querySelector<HTMLElement>(".pane");
    expect(root?.dataset.mode).toBe("reading");
    expect(harness.contexts[harness.contexts.length - 1]?.mode).toBe("reading");
    const sourceButton = switcher?.querySelector<HTMLButtonElement>('button[data-mode="source"]');
    sourceButton?.click();
    expect(surface.mode()).toBe("source");
    expect(
      document.querySelector<HTMLButtonElement>('button[data-mode="source"]')?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(
      document.querySelector<HTMLButtonElement>('button[data-mode="live_preview"]')?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("false");
  });

  it("mantiene Plain in source quando il PaneMode non è nel catalogo", async () => {
    vi.resetModules();
    const request: RequestBox = {
      value: { family: "text", profile: "plain-text", formatKey: "txt", species: "text/plain" },
    };
    const harness = mockPanelModules(request);
    const factory = createPlainTextSurfaceFactory();
    const mount = vi.spyOn(factory, "mount");
    const registry = new DocumentSurfaceRegistry();
    registry.register({
      owner: "test-plain",
      family: "text",
      profile: "plain-text",
      formatKey: "txt",
      species: "text/plain",
      factory,
    });

    panelDom();
    const { mountDocument, publishContext, setMode, synchronize } = await import("./document");
    const { layout, openIn, setMode: setPaneMode } = await import("../state/layout");
    setPaneMode("main", "source", layout);
    mountDocument({ surfaceRegistry: registry });
    openIn("main", "note.txt", layout);
    await synchronize();
    const surface = mount.mock.results[0]?.value as PlainTextSurface;
    const switcher = document.querySelector<HTMLElement>("#mode-switch");
    const buttons = [...(switcher?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    expect(buttons.map((button) => button.dataset.mode)).toEqual(["source"]);
    expect(buttons[0]?.dataset.i18n).toBe("mode.source");
    expect(buttons[0]?.dataset.i18nTitle).toBe("mode.source.hint");
    expect(switcher?.querySelector("#mode-live-key")).toBeNull();
    expect(switcher?.querySelector("#mode-reading-key")).toBeNull();
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");

    await publishContext();
    const published = harness.contexts.length;
    const setSurfaceMode = vi.spyOn(surface, "setMode");

    await setMode("live_preview" as never);
    expect(surface.mode()).toBe("source");
    expect(layout.panes.main?.mode).toBe("source");
    expect(setSurfaceMode).not.toHaveBeenCalled();
    expect(harness.contexts).toHaveLength(published);
    expect(
      document.querySelector<HTMLButtonElement>('button[data-mode="source"]')?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(document.querySelector('button[data-mode="live_preview"]')).toBeNull();
    expect(document.querySelector('button[data-mode="reading"]')).toBeNull();

    await setMode("reading" as never);
    expect(surface.mode()).toBe("source");
    expect(layout.panes.main?.mode).toBe("source");
    expect(setSurfaceMode).not.toHaveBeenCalled();
    expect(harness.contexts).toHaveLength(published);
    expect(
      document.querySelector<HTMLButtonElement>('button[data-mode="source"]')?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(document.querySelector('button[data-mode="live_preview"]')).toBeNull();
    expect(document.querySelector('button[data-mode="reading"]')).toBeNull();

    expect(surface).not.toHaveProperty("setLivePreview");
    expect(surface.mode()).toBe("source");

    expect(harness.flush).not.toHaveBeenCalled();
    expect(harness.previews).not.toHaveBeenCalled();

    await synchronize();
    const root = document.querySelector<HTMLElement>(".pane");
    expect(root?.dataset.mode).toBe("source");
    expect(root?.dataset.mode).not.toBe("reading");
    expect(root?.querySelector(".pane-editor")).not.toBeNull();
    expect(harness.contexts.every((context) => context.mode !== "live_preview")).toBe(true);
  });

  it.each(
    [
      {
        name: "byte viewer",
        nextRequest: { species: "application/octet-stream" },
        doc: "note.bin",
        surfaceClass: "document-surface-byte-viewer",
      },
      {
        name: "fallback testuale",
        nextRequest: { family: "text", profile: "unknown" },
        doc: "note.txt",
        surfaceClass: "document-surface-text-fallback",
      },
      {
        name: "errore esplicito",
        nextRequest: { family: "unknown" },
        doc: "note.unknown",
        surfaceClass: "document-surface-error",
      },
    ] satisfies readonly {
      readonly name: string;
      readonly nextRequest: SurfaceRequest;
      readonly doc: string;
      readonly surfaceClass: string;
    }[],
  )(
    "da Markdown in Lettura a $name lascia visibile la propria superficie senza anteprima",
    async ({ nextRequest, doc, surfaceClass }) => {
      vi.resetModules();
      const request: RequestBox = {
        value: {
          family: "text",
          profile: "markdown",
          formatKey: "md",
          species: "text/markdown",
        },
      };
      const harness = mockPanelModules(request);
      const registry = new DocumentSurfaceRegistry();
      registry.register({
        owner: "test-markdown",
        family: "text",
        profile: "markdown",
        formatKey: "md",
        species: "text/markdown",
        factory: createMarkdownSurfaceFactory(),
      });

      panelDom();
      const { mountDocument, publishContext, setMode, synchronize } = await import("./document");
      const { layout, openIn } = await import("../state/layout");
      mountDocument({ surfaceRegistry: registry });
      await synchronize();
      expect(document.querySelectorAll("#mode-switch button")).toHaveLength(0);

      openIn("main", "note.md", layout);
      await synchronize();
      await setMode("reading" as never);
      harness.previews.mockClear();

      request.value = nextRequest;
      openIn("main", doc, layout);
      await synchronize();
      await publishContext();

      const root = document.querySelector<HTMLElement>(".pane");
      expect(layout.panes.main?.mode).toBe("reading");
      expect(root?.dataset.mode).toBe("source");
      expect(root?.classList.contains("markdown-reading")).toBe(false);
      expect(root?.querySelector(`.pane-editor .${surfaceClass}`)).not.toBeNull();
      expect(harness.previews).not.toHaveBeenCalled();
      expect(harness.contexts[harness.contexts.length - 1]?.mode).toBe("source");
      expect(document.querySelectorAll("#mode-switch button")).toHaveLength(0);
    },
  );
  it("isola catalogo, rendering e contesto dal riquadro che ha il fuoco", async () => {
    vi.resetModules();
    const markdownRequest: SurfaceRequest = {
      family: "text",
      profile: "markdown",
      formatKey: "md",
      species: "text/markdown",
    };
    const plainRequest: SurfaceRequest = {
      family: "text",
      profile: "plain-text",
      formatKey: "txt",
      species: "text/plain",
    };
    const request: RequestBox = {
      value: markdownRequest,
      byDocument: { "note.md": markdownRequest, "note.txt": plainRequest },
    };
    const harness = mockPanelModules(request);
    const registry = new DocumentSurfaceRegistry();
    registry.register({
      owner: "test-markdown",
      family: "text",
      profile: "markdown",
      formatKey: "md",
      species: "text/markdown",
      factory: createMarkdownSurfaceFactory(),
    });
    registry.register({
      owner: "test-plain",
      family: "text",
      profile: "plain-text",
      formatKey: "txt",
      species: "text/plain",
      factory: createPlainTextSurfaceFactory(),
    });

    panelDom();
    const { mountDocument, publishContext, setMode, synchronize } = await import("./document");
    const { focusPane, layout, openIn, split } = await import("../state/layout");
    mountDocument({ surfaceRegistry: registry });
    openIn("main", "note.md", layout);
    await synchronize();
    await setMode("reading" as never);

    const plainPaneId = split("main", "col", layout);
    expect(plainPaneId).not.toBeNull();
    openIn(plainPaneId!, "note.txt", layout);
    await synchronize();

    const markdownPane = document.querySelector<HTMLElement>('[data-pane="main"]');
    const plainPane = document.querySelector<HTMLElement>(`[data-pane="${plainPaneId}"]`);
    expect(markdownPane?.dataset.mode).toBe("reading");
    expect(markdownPane?.classList.contains("markdown-reading")).toBe(true);
    expect(plainPane?.dataset.mode).toBe("source");
    expect(plainPane?.classList.contains("markdown-reading")).toBe(false);
    expect([...document.querySelectorAll<HTMLButtonElement>("#mode-switch button")].map(
      (button) => button.dataset.mode,
    )).toEqual(["source"]);
    expect(
      document
        .querySelector<HTMLButtonElement>('#mode-switch button[data-mode="source"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    await publishContext();
    expect(harness.contexts[harness.contexts.length - 1]?.mode).toBe("source");

    focusPane("main", layout);
    await synchronize();
    expect([...document.querySelectorAll<HTMLButtonElement>("#mode-switch button")].map(
      (button) => button.dataset.mode,
    )).toEqual(["source", "live_preview", "reading"]);
    expect(
      document
        .querySelector<HTMLButtonElement>('#mode-switch button[data-mode="reading"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");

    harness.refreshLanguage();
    expect(
      document.querySelector<HTMLButtonElement>('#mode-switch button[data-mode="reading"]')?.textContent,
    ).toBe("updated:mode.reading");
  });
});

describe("identità della selezione nel percorso reale del pannello", () => {
  it("distrugge A e monta B, poi distrugge B e rimonta A", async () => {
    vi.resetModules();
    let request: SurfaceRequest = {
      family: "text",
      profile: "markdown",
      formatKey: "format-a",
      species: "text/markdown-a",
    };
    const shellState = { currentDoc: null as string | null, handledExtensions: [] as string[] };
    const session = {
      subscribe: () => () => {},
      isDirty: () => false,
      isDeletionPending: () => false,
      saveState: () => null,
      attachSurface: () => () => {},
    };

    vi.doMock("../editors/bootstrap", () => ({
      surfaceRequestForDocument: () => request,
    }));
    vi.doMock("../host/ipc", () => ({ api: {} }));
    vi.doMock("../host/query", () => ({
      WITHOUT_PAGE: undefined,
      notesByName: () => Promise.resolve([]),
      resolvedReference: () => Promise.resolve(null),
      syntaxForms: () => Promise.resolve([]),
      unsavedDrafts: () => Promise.resolve([]),
      vaultTags: () => Promise.resolve([]),
    }));
    vi.doMock("../state/kernel", () => ({ onEvent: () => {} }));
    vi.doMock("../state/recent", () => ({ existingRecentNotes: () => [] }));
    vi.doMock("../state/store", () => ({
      emit: () => {},
      on: () => {},
      readState: () => null,
      state: shellState,
      writeState: () => {},
    }));
    vi.doMock("../state/drafts", () => ({
      CASE_KEY: {},
      caseOf: () => null,
      toRecover: () => [],
    }));
    vi.doMock("../state/document-session", () => ({
      documentSessions: session,
      isDocumentDeletedDuringRead: () => false,
    }));
    vi.doMock("../state/vault", () => ({ createNote: () => Promise.resolve() }));
    vi.doMock("../ui/commands", () => ({
      allCommands: () => [],
      registerShellCommand: () => {},
    }));
    vi.doMock("../ui/notify", () => ({ notify: () => {} }));
    vi.doMock("./preview", () => ({
      clearPreview: () => {},
      updatePreview: () => Promise.resolve(),
    }));
    vi.doMock("../ui/views", () => ({
      mountViewInPane: () => Promise.resolve(),
      primaryView: () => undefined,
      unmountViewFromPane: () => {},
    }));
    vi.doMock("../host/errors", () => ({ errorText: () => "errore" }));
    vi.doMock("../i18n/strings", () => ({
      onLanguage: () => {},
      t: (key: string) => key,
    }));
    vi.doMock("../ui/tooltip", () => ({ setTooltip: () => {} }));

    const makeSurfaceFactory = (label: string) => {
      const mounts: EditorSurface[] = [];
      let destroys = 0;
      const factory: SurfaceFactory = {
        family: "text",
        profile: "markdown",
        mount(_request, context) {
          const element = context.parent.ownerDocument.createElement("div");
          element.dataset.testFactory = label;
          context.parent.appendChild(element);
          const surface: EditorSurface = {
            family: "text",
            surfaceId: `${label}-${mounts.length + 1}`,
            focus() {},
            setReadOnly() {},
            setTheme() {},
            captureViewState() {
              return { version: 1, value: null };
            },
            restoreViewState() {},
            suspend() {},
            resume() {},
            destroy() {
              destroys += 1;
              element.remove();
            },
          };
          mounts.push(surface);
          return surface;
        },
      };
      return {
        factory,
        mounts,
        destroys: () => destroys,
      };
    };

    const registry = new DocumentSurfaceRegistry();
    const a = makeSurfaceFactory("a");
    const b = makeSurfaceFactory("b");
    const registrationA: SurfaceRegistration = {
      owner: "owner-a",
      family: "text",
      profile: "markdown",
      formatKey: "format-a",
      species: "text/markdown-a",
      factory: a.factory,
    };
    const registrationB: SurfaceRegistration = {
      owner: "owner-b",
      family: "text",
      profile: "markdown",
      formatKey: "format-b",
      species: "text/markdown-b",
      factory: b.factory,
    };
    registry.register(registrationA);
    registry.register(registrationB);
    request = {
      family: "text",
      profile: "markdown",
      override: {
        kind: "registration",
        registrationId: registrationA.registrationId as string,
      },
    };

    document.body.innerHTML = '<main id="panes"></main><div id="mode-switch"></div>';
    // Questi moduli vanno caricati dopo i mock: document.ts li usa come singleton
    // e il pannello deve essere provato sul percorso reale di show.
    const { mountDocument, synchronize } = await import("./document");
    const { layout, openIn } = await import("../state/layout");
    mountDocument({ surfaceRegistry: registry });
    openIn("main", "note.md", layout);

    await synchronize();
    expect(a.mounts).toHaveLength(1);
    expect(b.mounts).toHaveLength(0);

    request = {
      family: "text",
      profile: "markdown",
      override: {
        kind: "registration",
        registrationId: registrationB.registrationId as string,
      },
    };
    await synchronize();
    expect(a.destroys()).toBe(1);
    expect(b.mounts).toHaveLength(1);

    request = {
      family: "text",
      profile: "markdown",
      override: {
        kind: "registration",
        registrationId: registrationA.registrationId as string,
      },
    };
    await synchronize();
    expect(b.destroys()).toBe(1);
    expect(a.mounts).toHaveLength(2);
    request = {
      family: "text",
      profile: "markdown",
      formatKey: "format-b",
      species: "text/markdown-b",
    };
    await synchronize();
    expect(a.destroys()).toBe(2);
    expect(b.mounts).toHaveLength(2);
  });
});

describe("identità del mount nel percorso reale del pannello", () => {
  it("rimonta una superficie generica sul nuovo documento e riusa la stessa istanza", async () => {
    vi.resetModules();
    const genericRequest = { formatKey: "generic-format" };
    const request: RequestBox = {
      value: genericRequest,
      byDocument: {
        "first.grid": genericRequest,
        "second.grid": genericRequest,
      },
    };
    mockPanelModules(request);
    const registry = new DocumentSurfaceRegistry();
    const a = genericSurfaceFixture("a");
    const dispose = registry.register({
      owner: "generic-a",
      family: "grid",
      profile: "generic",
      formatKey: genericRequest.formatKey,
      factory: a.factory,
    });

    panelDom();
    const { mountDocument, synchronize } = await import("./document");
    const { layout, openIn } = await import("../state/layout");
    mountDocument({ surfaceRegistry: registry });
    openIn("main", "first.grid", layout);
    await synchronize();
    const first = a.mounts[0]?.surface;
    const editor = document.querySelector<HTMLElement>(".pane-editor")!;
    expect(editor).toHaveAttribute("data-document-surface", "");

    openIn("main", "second.grid", layout);
    await synchronize();
    expect(a.destroys.calls).toBe(1);
    expect(a.mounts.map((mount) => mount.documentId)).toEqual([
      "first.grid",
      "second.grid",
    ]);
    expect(a.mounts[1]?.surface).not.toBe(first);

    await synchronize();
    expect(a.mounts).toHaveLength(2);
    expect(a.destroys.calls).toBe(1);
    dispose();
  });

  it("mantiene la key della superficie montata dopo una sostituzione rientrante", async () => {
    vi.resetModules();
    const request: RequestBox = { value: { formatKey: "format-a" } };
    mockPanelModules(request);
    const registry = new DocumentSurfaceRegistry();
    const aHook: DestroyHook = { current: undefined };
    const a = genericSurfaceFixture("a", aHook);
    const b = genericSurfaceFixture("b");
    const c = genericSurfaceFixture("c");
    const disposeA = registry.register({
      owner: "generic-a",
      family: "grid",
      profile: "generic",
      formatKey: "format-a",
      factory: a.factory,
    });
    const disposeB = registry.register({
      owner: "generic-b",
      family: "grid",
      profile: "generic",
      formatKey: "format-b",
      factory: b.factory,
    });
    let disposeC: (() => void) | undefined;
    aHook.current = () => {
      disposeB();
      disposeC = registry.register({
        owner: "generic-c",
        family: "grid",
        profile: "generic",
        formatKey: "format-b",
        factory: c.factory,
      });
    };

    panelDom();
    const { mountDocument, synchronize } = await import("./document");
    const { layout, openIn } = await import("../state/layout");
    mountDocument({ surfaceRegistry: registry });
    openIn("main", "note.grid", layout);
    await synchronize();
    expect(a.mounts).toHaveLength(1);

    request.value = { formatKey: "format-b" };
    await synchronize();
    expect(a.destroys.calls).toBe(1);
    expect(b.mounts).toHaveLength(0);
    expect(c.mounts.map((mount) => mount.documentId)).toEqual(["note.grid"]);

    await synchronize();
    expect(c.mounts).toHaveLength(1);
    expect(c.destroys.calls).toBe(0);
    disposeA();
    disposeC?.();
  });

  it("cleans a throwing generic teardown before retrying the next surface", async () => {
    vi.resetModules();
    const request: RequestBox = { value: { formatKey: "format-a" } };
    mockPanelModules(request);
    const registry = new DocumentSurfaceRegistry();
    const destroyError = new Error("generic teardown failed");
    const a = genericSurfaceFixture("a", { current: undefined }, destroyError);
    const b = genericSurfaceFixture("b");
    const disposeA = registry.register({
      owner: "generic-a",
      family: "grid",
      profile: "generic",
      formatKey: "format-a",
      factory: a.factory,
    });
    const disposeB = registry.register({
      owner: "generic-b",
      family: "grid",
      profile: "generic",
      formatKey: "format-b",
      factory: b.factory,
    });

    panelDom();
    const { mountDocument, synchronize } = await import("./document");
    const { layout, openIn } = await import("../state/layout");
    mountDocument({ surfaceRegistry: registry });
    openIn("main", "note.grid", layout);
    await synchronize();
    const editor = document.querySelector<HTMLElement>(".pane-editor")!;
    expect(editor.querySelector(".generic-surface-a")).not.toBeNull();

    request.value = { formatKey: "format-b" };
    await expect(synchronize()).rejects.toThrow(destroyError);
    expect(a.destroys.calls).toBe(1);
    expect(b.mounts).toHaveLength(0);
    expect(editor.querySelector(".generic-surface-a")).toBeNull();
    expect(editor.children).toHaveLength(0);
    expect(editor).not.toHaveAttribute("data-document-surface");

    await synchronize();
    expect(b.mounts.map((mount) => mount.documentId)).toEqual(["note.grid"]);
    expect(editor.children).toHaveLength(1);
    expect(editor.firstElementChild?.className).toBe("generic-surface-b");
    expect(editor).toHaveAttribute("data-document-surface", "");

    await synchronize();
    expect(b.mounts).toHaveLength(1);
    disposeA();
    disposeB();
  });

  it("cleans a parent dirtied by a throwing factory before its registration is fixed", async () => {
    vi.resetModules();
    const request: RequestBox = { value: { formatKey: "format-a" } };
    mockPanelModules(request);
    const registry = new DocumentSurfaceRegistry();
    const mountError = new Error("generic mount failed");
    const failedMounts = { calls: 0 };
    const failingFactory: SurfaceFactory = {
      family: "grid",
      profile: "generic",
      mount(_request, context) {
        failedMounts.calls += 1;
        const marker = context.parent.ownerDocument.createElement("div");
        marker.className = "generic-surface-failed";
        context.parent.append(marker);
        throw mountError;
      },
    };
    const disposeFailed = registry.register({
      owner: "generic-failed",
      family: "grid",
      profile: "generic",
      formatKey: "format-a",
      factory: failingFactory,
    });

    panelDom();
    const { mountDocument, synchronize } = await import("./document");
    const { layout, openIn } = await import("../state/layout");
    mountDocument({ surfaceRegistry: registry });
    openIn("main", "note.grid", layout);
    await expect(synchronize()).rejects.toThrow(mountError);
    const editor = document.querySelector<HTMLElement>(".pane-editor")!;
    expect(failedMounts.calls).toBe(1);
    expect(editor.children).toHaveLength(0);
    expect(editor.querySelector(".generic-surface-failed")).toBeNull();
    expect(editor).not.toHaveAttribute("data-document-surface");

    disposeFailed();
    const fixed = genericSurfaceFixture("fixed");
    const disposeFixed = registry.register({
      owner: "generic-fixed",
      family: "grid",
      profile: "generic",
      formatKey: "format-a",
      factory: fixed.factory,
    });

    await synchronize();
    expect(fixed.mounts.map((mount) => mount.documentId)).toEqual(["note.grid"]);
    expect(editor.children).toHaveLength(1);
    expect(editor.firstElementChild?.className).toBe("generic-surface-fixed");
    expect(editor).toHaveAttribute("data-document-surface", "");

    await synchronize();
    expect(fixed.mounts).toHaveLength(1);
    disposeFixed();
  });
});
