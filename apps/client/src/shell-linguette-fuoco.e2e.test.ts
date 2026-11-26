// @vitest-environment happy-dom
//
// **La shell intera** (§17.2): le linguette, le superfici e il fuoco.
//
// Una parte delle prove che montano `main.ts` sulla scocca vera contro
// l'host finto; il perché, il montaggio e gli aiuti stanno in
// `shell-e2e-support.ts`.
import { describe, expect, it, vi } from "vitest";
import { appendToTextEditor as typeInEditor, mountedTextEditors as editorViews, undoDepth } from "./editors/text/test-support";
import type { FakeHost } from "./host/fake";
import type { KnownVault } from "./host/contract";
import { withoutTypeReads } from "./state/note-type-commands";
import { start, settle, microtasks, waitFor, rowsOfNote, row, contextMenu, textToVideo, VAULT, editorTexts, splitRight, twoPanes, useShellHarness } from "./shell-e2e-support";

// Ogni gesto monta la shell vera: qui un giro sta fra 0,5 e 3 s, sul runner CI
// è circa tre volte più lento e i 5 s del default li superava ora un gesto ora
// un altro. Il tetto vale per il file intero; un blocco vero resta fermo ben
// oltre.
vi.setConfig({ testTimeout: 20_000 });

// L'host finto vive in una scatola che `vi.mock` possa vedere: i factory dei
// mock sono issati sopra gli import, quindi non possono chiudere su una
// variabile normale di questo modulo. La scatola sì, perché a leggerla è la
// factory quando il modulo viene chiesto — cioè dopo che il test l'ha riempita.
const box = vi.hoisted(() => ({
  host: null as FakeHost | null,
  /// Cosa si risponde a una conferma, che sia quella del sistema o quella che
  /// lo Scrittoio disegna dentro la finestra. Negli e2e è un `true`.
  confirm: true,
  /// Quante volte una conferma è stata chiesta.
  asked: 0,
  /// I vault che la macchina ricorda, per la schermata senza vault.
  known: [] as KnownVault[],
}));

// Il modulo mimato è **uno solo per tutto il file**, e delega all'host di
// adesso a ogni chiamata. Non è un vezzo: `vi.resetModules()` svuota il
// registro dei moduli ma **non** quello dei mock, quindi una factory che
// restituisse `scatola.host.module` verrebbe eseguita una volta sola e ogni
// prova dalla seconda in poi parlerebbe col vault della prima — con la shell
// rimontata a dovere, che è il modo migliore per non accorgersene. È costato
// due giri di misura, e sta scritto qui perché al terzo nessuno lo rifaccia.
vi.mock("./host/ipc", () => {
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
    onKernelEvent: (handler: (n: unknown) => void) =>
      now().onKernelEvent(handler as never),
    onClose: (first: () => Promise<boolean>, onFailure: (reason: unknown) => void) => now().onClose(first, onFailure),
    // `finestra` è il manico della titlebar custom (§Fase 1): in test non
    // tocchiamo finestre vere, e i metodi sono tutti no-op o ritornano
    // valori neutri.
    window: {
      minimize: async () => {},
      toggleMaximize: async () => {},
      close: async () => {},
      isMaximized: async () => false,
      setTitle: async () => {},
      onResize: async () => async () => {},
    },
  };
});

vi.mock("./host/dialog", () => ({
  confirm: () => {
    box.asked++;
    return Promise.resolve(box.confirm);
  },
  pickFolder: () => Promise.resolve("/vault"),
  pickFile: () => Promise.resolve(null),
}));

useShellHarness(box);

describe("chiudere linguette e superfici", () => {
  it("mantiene il focus al ridisegno e permette frecce, attivazione e chiusura", async () => {
    await start(VAULT);
    const { openDocument, synchronize } = await import("./panels/document");
    await openDocument("note/Riunione.md");
    await settle();
    const tabs = () => [...document.querySelectorAll<HTMLButtonElement>(".pane .tab")];
    tabs()[1]!.focus();
    await synchronize();
    await synchronize();
    expect(document.activeElement).toBe(tabs()[1]);
    expect(document.querySelectorAll("[data-tab-menu]")).toHaveLength(1);

    tabs()[1]!.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowLeft", bubbles: true, cancelable: true,
    }));
    expect(document.activeElement).toBe(tabs()[0]);
    expect(textToVideo()).toContain("Appunti della riunione");
    tabs()[0]!.click();
    await settle();
    expect(textToVideo()).toContain("Il primo documento");
    expect(document.activeElement).toBe(tabs()[0]);

    tabs()[0]!.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Delete", bubbles: true, cancelable: true,
    }));
    await settle();
    expect(tabs().map((tab) => tab.textContent)).toEqual(["Riunione"]);
    expect(document.activeElement).toBe(tabs()[0]);
    expect(textToVideo()).toContain("Appunti della riunione");
    const close = document.querySelector<HTMLButtonElement>(".pane .tab-close")!;
    close.focus();
    close.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", bubbles: true, cancelable: true,
    }));
    await settle();
    expect(document.activeElement).toBe(
      document.querySelector('.pane-toolbar button[aria-haspopup="menu"]'),
    );
  });

  it("le frecce fra le linguette chiudono il giro, vanno agli estremi e lasciano stare gli altri tasti", async () => {
    await start(VAULT);
    const { openDocument } = await import("./panels/document");
    await openDocument("note/Riunione.md");
    await openDocument("note/Spesa.md");
    await settle();
    const tabs = () => [...document.querySelectorAll<HTMLButtonElement>(".pane .tab")];
    expect(tabs()).toHaveLength(3);
    const press = (key: string): boolean => {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      document.activeElement!.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const focused = () => tabs().indexOf(document.activeElement as HTMLButtonElement);

    tabs()[0]!.focus();
    expect(press("ArrowLeft")).toBe(true);
    expect(focused()).toBe(2);
    press("ArrowRight");
    expect(focused()).toBe(0);
    press("End");
    expect(focused()).toBe(2);
    press("Home");
    expect(focused()).toBe(0);
    press("ArrowRight");
    expect(focused()).toBe(1);
    // Il riquadro resta una fermata sola del Tab: la segue la linguetta col fuoco.
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
    expect(press("ArrowDown")).toBe(false);
    expect(focused()).toBe(1);
  });

  it("chiude una linguetta senza chiudere le altre", async () => {
    const host = await start(VAULT);
    const folder = document.querySelector<HTMLElement>("#file-list .tree-row.folder");
    folder?.click();
    await waitFor("la cartella si apre", () => rowsOfNote().length === 3);

    row("Riunione").click();
    await waitFor("la seconda linguetta si apre", () =>
      textToVideo().includes("Appunti della riunione"),
    );
    const tabs = [...document.querySelectorAll<HTMLElement>(".pane .tab")];
    expect(tabs).toHaveLength(2);

    const tab = tabs[1];
    const tabId = tab?.id;
    const close = tabId
      ? document.querySelector<HTMLElement>(`.pane .tab-close[data-tab-id="${tabId}"]`)
      : null;
    expect(close?.classList.contains("tab-close")).toBe(true);
    // La chiusura scatta al `click` e non al `mousedown` (WCAG 2.5.2): premere
    // e trascinare fuori dalla × annulla il gesto.
    close?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(document.querySelectorAll(".pane .tab")).toHaveLength(2);
    close?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(
      "resta la linguetta iniziale",
      () => document.querySelectorAll(".pane .tab").length === 1,
    );
    expect(textToVideo()).toContain("Il primo documento");
    expect(host.files()["Benvenuto.md"]).toBe(VAULT["Benvenuto.md"]);
  });

  it("chiude l'ultima linguetta, salva una volta e non lascia timer", async () => {
    const host = await start(VAULT);
    typeInEditor("testo prima di chiudere la linguetta");

    const close = document.querySelector<HTMLElement>(".pane .tab-close");
    close?.click();
    await waitFor(
      "l'ultima linguetta si chiude",
      () => document.querySelectorAll(".pane .tab").length === 0,
    );
    await waitFor("il salvataggio della linguetta parte", () =>
      host.atGate("writeDocument").length === 1,
    );
    expect(host.files()["Benvenuto.md"]).toContain("testo prima di chiudere la linguetta");

    // This integration must let the real save/debounce deadlines pass: a
    // residual timer is the behavior under test, not an injectable callback.
    await new Promise((resolve) => setTimeout(resolve, 450));
    await settle();
    expect(host.atGate("writeDocument")).toHaveLength(1);
  });

  it("una linguetta che non si salva non butta il buffer alla chiusura", async () => {
    const host = await start(VAULT);
    const { documentSessions } = await import("./state/document-session");
    const repair = host.fault("writeDocument", "disco pieno");
    box.confirm = false;
    const asked = box.asked;
    typeInEditor("lavoro che il disco rifiuta");

    document.querySelector<HTMLElement>(".pane .tab-close")?.click();
    await waitFor("la chiusura chiede cosa fare", () => box.asked === asked + 1);
    // Senza un «scarta» esplicito la nota torna aperta, col suo buffer.
    await waitFor("la nota torna aperta", () =>
      document.querySelectorAll(".pane .tab").length === 1 &&
      textToVideo().includes("lavoro che il disco rifiuta"),
    );
    expect(documentSessions.inspect("Benvenuto.md")).toMatchObject({ dirty: true });

    // Scartare è una scelta: allora la sessione se ne va davvero.
    box.confirm = true;
    document.querySelector<HTMLElement>(".pane .tab-close")?.click();
    await waitFor("la sessione se ne va", () => documentSessions.get("Benvenuto.md") === undefined);
    expect(document.querySelectorAll(".pane .tab")).toHaveLength(0);
    repair();
    expect(host.files()["Benvenuto.md"]).toBe(VAULT["Benvenuto.md"]);
  });

  it("una riapertura prenotata durante il flush conserva lo stesso owner", async () => {
    const host = await start(VAULT);
    const { documentSessions } = await import("./state/document-session");
    const owner = documentSessions.get("Benvenuto.md");
    if (!owner) throw new Error("sessione non costruita");
    const unlock = host.throttle("writeDocument");

    typeInEditor("battuta prima di chiudere");
    await waitFor("la prima scrittura parte", () => host.atGate("writeDocument").length === 1);

    const close = document.querySelector<HTMLElement>(".pane .tab-close");
    close?.click();
    await waitFor(
      "la linguetta si chiude",
      () => document.querySelectorAll(".pane .tab").length === 0,
    );

    // Il click arriva mentre il rilascio dell'ultima linguetta aspetta la
    // scrittura frenata: l'intento di apertura deve precederla, non arrivare
    // dopo che l'owner è già stato chiuso.
    row("Benvenuto").click();
    await settle();
    expect(documentSessions.get("Benvenuto.md")).toBe(owner);

    unlock();
    await waitFor(
      "la nota si riapre",
      () =>
        document.querySelectorAll(".pane .tab").length === 1 &&
        textToVideo().includes("battuta prima di chiudere"),
    );
    expect(documentSessions.get("Benvenuto.md")).toBe(owner);

    const writesBeforeReopen = host.atGate("writeDocument").length;
    typeInEditor(" e dopo la riapertura");
    await waitFor(
      "la battuta dopo la riapertura viene salvata",
      () => host.atGate("writeDocument").length === writesBeforeReopen + 1,
    );
    expect(host.files()["Benvenuto.md"]).toContain("e dopo la riapertura");
  });

  it("distrugge la superficie del riquadro chiuso", async () => {
    await start(VAULT);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "\\", ctrlKey: true }),
    );
    await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);

    const panes = [...document.querySelectorAll<HTMLElement>(".pane")];
    const removed = editorViews()[1]!;
    panes[1]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "w",
        ctrlKey: true,
        shiftKey: true,
      }),
    );

    await waitFor("il riquadro si chiude", () => document.querySelectorAll(".pane").length === 1);
    expect(editorViews()).toHaveLength(1);
    expect(removed.dom.isConnected).toBe(false);
  });

  it("non fa risorgere una nota sporca appena cancellata", async () => {
    const host = await start(VAULT);
    typeInEditor("testo della nota cancellata");
    const unlock = host.throttle("invokeCommand");

    await contextMenu(row("Benvenuto"), "Sposta nel cestino");
    await waitFor(
      "la cancellazione arriva al kernel",
      () => withoutTypeReads(host.atGate("invokeCommand")).some((c) => c.args[0] === "note.trash"),
    );

    // Keep the delete command in flight past the save debounce. If the delete
    // left a timer armed, its write would recreate the now-missing path here.
    await new Promise((resolve) => setTimeout(resolve, 450));
    await settle();
    expect(host.atGate("writeDocument")).toHaveLength(0);
    expect(Object.keys(host.files())).toContain("Benvenuto.md");

    unlock();
    await waitFor("la bozza viene scartata", () => host.atGate("discardDraft").length > 0);
    await settle();
    expect(Object.keys(host.files())).not.toContain("Benvenuto.md");
  });

  it("blocca un input reale durante una cancellazione lenta e non resuscita la bozza", async () => {
    const host = await start(VAULT);
    // Dynamic imports are required because `start` resets the shell module graph
    // for every isolated fake host.
    const { documentSessions } = await import("./state/document-session");
    const { trashWithConfirm } = await import("./panels/trash");
    const view = editorViews()[0];
    if (!view) throw new Error("l'editor non è montato");
    view.dispatch({
      changes: { from: view.state.doc.length, insert: " testo da cancellare" },
      userEvent: "input.type",
    });
    const before = view.state.doc.toString();
    const unlock = host.throttle("invokeCommand");

    const deleting = trashWithConfirm("Benvenuto.md");
    await microtasks();
    expect(withoutTypeReads(host.atGate("invokeCommand")).some((c) => c.args[0] === "note.trash")).toBe(true);
    expect(view.state.readOnly).toBe(true);

    view.focus();
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(view.state.doc.toString()).toBe(before);
    expect(host.atGate("writeDocument")).toHaveLength(0);

    unlock();
    await deleting;
    await microtasks();
    expect(host.atGate("writeDocument")).toHaveLength(0);
    expect(host.atGate("saveDraft")).toHaveLength(0);
    expect(Object.keys(host.files())).not.toContain("Benvenuto.md");
    expect(documentSessions.get("Benvenuto.md")).toBeUndefined();
  });

  it("scongela lo stesso owner dopo un rifiuto e salva il primo input successivo", async () => {
    const host = await start(VAULT);
    // Dynamic imports are required because `start` resets the shell module graph
    // for every isolated fake host.
    const { documentSessions } = await import("./state/document-session");
    const { trashWithConfirm } = await import("./panels/trash");
    const view = editorViews()[0];
    if (!view) throw new Error("l'editor non è montato");
    view.dispatch({
      changes: { from: view.state.doc.length, insert: " testo da conservare" },
      userEvent: "input.type",
    });
    const before = view.state.doc.toString();
    const owner = documentSessions.get("Benvenuto.md");
    if (!owner) throw new Error("sessione non costruita");
    const historyBefore = undoDepth(view.state);
    const unlock = host.throttle("invokeCommand");
    const repair = host.fault("invokeCommand", "cancellazione rifiutata");

    const deleting = trashWithConfirm("Benvenuto.md");
    await microtasks();
    expect(view.state.readOnly).toBe(true);
    expect(host.files()["Benvenuto.md"]).toBe(VAULT["Benvenuto.md"]);
    expect(host.trash()).toHaveLength(0);
    view.focus();
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(view.state.doc.toString()).toBe(before);
    unlock();
    await expect(deleting).rejects.toThrow("cancellazione rifiutata");
    repair();

    expect(documentSessions.get("Benvenuto.md")).toBe(owner);
    expect(view.state.readOnly).toBe(false);
    expect(view.state.doc.toString()).toBe(before);
    expect(documentSessions.inspect("Benvenuto.md")).toMatchObject({
      dirty: true,
      pendingDeletion: false,
      text: before,
    });
    expect(undoDepth(view.state)).toBe(historyBefore);

    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    const after = view.state.doc.toString();
    expect(after).not.toBe(before);
    await waitFor(
      "il primo input dopo il rifiuto viene salvato",
      () => host.atGate("writeDocument").length > 0,
    );
    expect(host.files()["Benvenuto.md"]).toBe(after);
    expect(documentSessions.inspect("Benvenuto.md")?.dirty).toBe(false);
  });
});

describe("i tasti del mouse sulla striscia delle schede", () => {
  const tabs = () => [...document.querySelectorAll<HTMLButtonElement>(".pane .tab")];
  const names = () => tabs().map((tab) => tab.querySelector(".tab-name")?.textContent);
  const selected = () => document.querySelector('.pane .tab[aria-selected="true"] .tab-name')?.textContent;
  /// Una pressione vera: giù e su col tasto, poi il `click` col `detail` della
  /// serie. WebKitGTK lo manda anche dopo il centrale, col `button` del sinistro.
  const press = (target: Element, button: number, detail = 1): void => {
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button, detail }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button, detail }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, detail }));
  };

  it("il centrale chiude la scheda e non la attiva, in WebKitGTK e in Chromium (IMP-012)", async () => {
    await start(VAULT);
    const { openDocument } = await import("./panels/document");
    await openDocument("note/Riunione.md");
    await openDocument("note/Spesa.md");
    await settle();
    expect(selected()).toBe("Spesa");

    // WebKitGTK: un `click` dopo il centrale.
    press(tabs()[0]!, 1);
    await settle();
    expect(names()).toEqual(["Riunione", "Spesa"]);
    expect(selected()).toBe("Spesa");

    // Chromium: un `auxclick` col centrale, e nient'altro. Una scheda sola.
    const riunione = tabs()[0]!;
    riunione.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 1 }));
    riunione.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 1 }));
    riunione.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1, detail: 1 }));
    riunione.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, detail: 1 }));
    await settle();
    expect(names()).toEqual(["Spesa"]);
  });

  it("il doppio clic sulla × chiude una scheda sola: il secondo clic non tocca ciò che scorre sotto (IMP-013)", async () => {
    const host = await start(VAULT);
    const { openDocument } = await import("./panels/document");
    await openDocument("note/Riunione.md");
    await openDocument("note/Spesa.md");
    await settle();
    const files = Object.keys(host.files()).sort();

    press(tabs()[2]!.parentElement!.querySelector(".tab-close")!, 0, 1);
    await settle();
    expect(names()).toEqual(["Benvenuto", "Riunione"]);
    expect(selected()).toBe("Riunione");
    // Il secondo clic della serie cade sulla vicina, sul «+» o sul vuoto, e
    // non sceglie la parola che ha sotto.
    const second = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, detail: 2 });
    tabs()[0]!.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(true);
    press(tabs()[0]!, 0, 2);
    const plus = document.querySelector(".pane .tab-new");
    if (plus) press(plus, 0, 2);
    const strip = document.querySelector(".pane .pane-tabs")!;
    press(strip, 0, 2);
    strip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 }));
    await settle();
    expect(names()).toEqual(["Benvenuto", "Riunione"]);
    expect(selected()).toBe("Riunione");
    expect(Object.keys(host.files()).sort()).toEqual(files);

    // Un clic che comincia da capo sulla vicina la attiva, come sempre.
    press(tabs()[0]!, 0, 1);
    await settle();
    expect(selected()).toBe("Benvenuto");
  });
});

describe("il fuoco dopo un gesto che toglie ciò che lo aveva", () => {
  const panes = () => [...document.querySelectorAll<HTMLElement>(".pane")];
  const focusIn = (el: HTMLElement) => el.contains(document.activeElement);

  it("chiusa con la × la scheda attiva, il fuoco resta nel riquadro (IMP-011)", async () => {
    await start(VAULT);
    const { openDocument } = await import("./panels/document");
    await openDocument("note/Riunione.md");
    await settle();
    editorViews()[0]!.focus();
    expect(focusIn(panes()[0]!)).toBe(true);
    const close = document.querySelector<HTMLElement>('.pane .tab[aria-selected="true"] + .tab-close')!;
    close.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    close.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    close.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    await waitFor("resta Benvenuto", () => editorTexts().join().includes("Il primo documento"));
    await settle();
    expect(document.activeElement).not.toBe(document.body);
    expect(focusIn(panes()[0]!)).toBe(true);
  });

  it("dopo «Dividi a destra» il fuoco è nel riquadro nuovo", async () => {
    await start(VAULT);
    editorViews()[0]!.focus();
    await splitRight();
    await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);
    await settle();
    expect(document.activeElement).not.toBe(document.body);
    expect(focusIn(panes()[1]!)).toBe(true);
    expect(panes()[1]!.classList.contains("focus")).toBe(true);
  });

  it("il divisore mosso con le frecce tiene il fuoco e continua a muoversi (IMP-016)", async () => {
    await start(VAULT);
    await splitRight();
    await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);
    await settle();
    const divider = () => document.querySelector<HTMLElement>(".pane-divider")!;
    divider().focus();
    for (const expected of ["55", "60"]) {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
      await settle();
      expect(document.activeElement).toBe(divider());
      expect(divider().getAttribute("aria-valuenow")).toBe(expected);
    }
  });
});

// Un cambio di scheda fatto con un tasto globale porta il fuoco nell'editor
// della scheda che diventa attiva, da qualunque punto del riquadro parta: dal
// testo, o dalla linguetta su cui un clic lo aveva lasciato. Senza, la battuta
// dopo il tasto finiva sul `body` o su una linguetta e si perdeva in silenzio
// (IMP-048…051). Il tasto passa dalla tastiera vera (`ui/keyboard.ts`), come
// nell'app.
describe("il fuoco dopo un cambio di scheda da tastiera", () => {
  const tabs = () => [...document.querySelectorAll<HTMLButtonElement>(".pane .tab")];
  const selected = () => document.querySelector<HTMLElement>('.pane .tab[aria-selected="true"] .tab-name')?.textContent;
  /// Il tasto, con Ctrl, sull'elemento col fuoco: dove lo manda il WebView.
  /// Maiusc+Tab arriva come lo passa WebKitGTK, `Unidentified` col tasto
  /// fisico in `code` (GTK lo chiama `ISO_Left_Tab`).
  const press = (key: string, shift = false) => {
    const webkit = shift && key === "Tab" ? { key: "Unidentified", code: "Tab" } : { key };
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", {
      ...webkit, ctrlKey: true, shiftKey: shift, bubbles: true, cancelable: true,
    }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Control", bubbles: true }));
  };
  /// Il fuoco è nell'editor che si vede, e quell'editor mostra `text`.
  const focusedEditorShows = (text: string): boolean => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || focused === document.body) return false;
    const content = focused.closest(".cm-content");
    return !!content && !!focused.closest(".pane-editor") && !focused.closest("[hidden]")
      && (content.textContent ?? "").includes(text);
  };
  const editorOf = (text: string) => editorViews().find((view) => view.state.doc.toString().includes(text))!;
  /// Due schede, Benvenuto e Riunione (attiva), col fuoco nel testo di Riunione.
  const twoTabs = async () => {
    await start(VAULT);
    const { openDocument } = await import("./panels/document");
    await openDocument("note/Riunione.md");
    await settle();
    expect(selected()).toBe("Riunione");
    editorOf("Appunti della riunione").focus();
    expect(focusedEditorShows("Appunti della riunione")).toBe(true);
  };
  /// Il clic su una linguetta lascia il fuoco sulla linguetta (le frecce della
  /// striscia partono da lì): un tasto globale dopo il clic lo porta comunque
  /// nell'editor.
  const clickTab = async (name: string) => {
    const tab = tabs().find((each) => each.textContent?.includes(name))!;
    tab.focus();
    tab.click();
    await settle();
    expect(document.activeElement).toBe(tabs().find((each) => each.textContent?.includes(name)));
  };
  const lands = async (name: string, text: string) => {
    await waitFor(`la scheda ${name} è attiva`, () => selected() === name);
    await waitFor(`il fuoco è nel testo di ${name}`, () => focusedEditorShows(text));
    await settle();
    expect(focusedEditorShows(text)).toBe(true);
  };

  it("Ctrl+W porta il fuoco nell'editor della scheda vicina, non sulla sua linguetta (IMP-048)", async () => {
    await twoTabs();
    press("w");
    await waitFor("Riunione si chiude", () => tabs().length === 1);
    await lands("Benvenuto", "Il primo documento");
  });

  it("Ctrl+Tab porta il fuoco nell'editor della scheda nuova, dal testo e dalla linguetta (IMP-049)", async () => {
    await twoTabs();
    press("Tab");
    await lands("Benvenuto", "Il primo documento");
    await clickTab("Riunione");
    press("Tab");
    await lands("Benvenuto", "Il primo documento");
  });

  it("Ctrl+Maiusc+Tab torna alla scheda usata prima, col fuoco nel suo editor (IMP-050)", async () => {
    await twoTabs();
    press("Tab", true);
    await lands("Benvenuto", "Il primo documento");
    press("Tab", true);
    await lands("Riunione", "Appunti della riunione");
  });

  it("Ctrl+PagGiù e Ctrl+PagSu portano il fuoco nell'editor della scheda nuova (IMP-049)", async () => {
    await twoTabs();
    press("PageDown");
    await lands("Benvenuto", "Il primo documento");
    await clickTab("Benvenuto");
    press("PageUp");
    await lands("Riunione", "Appunti della riunione");
  });

  it("Ctrl+1 e Ctrl+9 portano il fuoco nell'editor della scheda scelta (IMP-049)", async () => {
    await twoTabs();
    press("1");
    await lands("Benvenuto", "Il primo documento");
    await clickTab("Benvenuto");
    press("9");
    await lands("Riunione", "Appunti della riunione");
  });

  // IMP-152: le scorciatoie globali non agiscono dietro una finestra modale.
  it("con le Impostazioni aperte Ctrl+W e Ctrl+N tacciono, e dopo Esc tornano (IMP-152)", async () => {
    await twoTabs();
    const host = box.host!;
    const panel = document.querySelector<HTMLElement>("#settings-panel")!;
    press(",");
    await waitFor("le Impostazioni si aprono", () => !panel.hidden);
    await settle();
    expect(panel.contains(document.activeElement)).toBe(true);
    const files = Object.keys(host.files()).sort();

    press("w");
    press("n");
    await settle();
    expect(tabs(), "nessuna scheda chiusa dietro la finestra").toHaveLength(2);
    expect(selected()).toBe("Riunione");
    expect(Object.keys(host.files()).sort(), "nessuna nota creata dietro la finestra").toEqual(files);
    expect(panel.hidden).toBe(false);

    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await waitFor("le Impostazioni si chiudono", () => panel.hidden);
    editorOf("Appunti della riunione").focus();
    press("w");
    await waitFor("chiusa la finestra, Ctrl+W torna a chiudere la scheda", () => tabs().length === 1);
  });

  it("Ctrl+Maiusc+T riapre la scheda col fuoco nel suo editor (IMP-051)", async () => {
    await twoTabs();
    press("w");
    await waitFor("Riunione si chiude", () => tabs().length === 1);
    await clickTab("Benvenuto");
    press("T", true);
    await waitFor("Riunione torna", () => tabs().length === 2);
    await lands("Riunione", "Appunti della riunione");
  });

  it("Ctrl+\\ porta il fuoco nell'editor del riquadro nuovo anche dalla linguetta", async () => {
    await twoTabs();
    await clickTab("Riunione");
    press("\\");
    await waitFor("il secondo riquadro si apre", () => document.querySelectorAll(".pane").length === 2);
    await waitFor("il riquadro nuovo ha il suo editor", () => editorViews().length >= 2);
    await settle();
    const second = document.querySelectorAll<HTMLElement>(".pane")[1]!;
    await waitFor("il fuoco è nel riquadro nuovo", () => second.contains(document.activeElement));
    expect(focusedEditorShows("Appunti della riunione")).toBe(true);
  });

  it("un tasto di scheda col fuoco fuori dai riquadri porta il fuoco nella scheda nuova", async () => {
    await twoTabs();
    const search = document.querySelector<HTMLElement>("#file-list .tree-row")!;
    search.focus();
    expect(search.contains(document.activeElement)).toBe(true);
    press("PageDown");
    await lands("Benvenuto", "Il primo documento");
  });
});

// Un clic nel testo con un menu aperto chiude il menu e lascia il fuoco nel
// testo: la chiusura non lo riporta al pulsante che aveva aperto il menu, e la
// battuta dopo arriva alla sessione del documento (IMP-151). Senza, il fuoco
// tornava su «Ordina» e le battute si perdevano in silenzio.
describe("il fuoco dopo un clic fuori da un menu", () => {
  it("il clic nel testo con «Ordina» aperto lascia il fuoco nell'editor, e la battuta arriva alla sessione", async () => {
    const host = await start(VAULT);
    const sort = document.getElementById("explorer-sort") as HTMLButtonElement;
    sort.focus();
    sort.click();
    await waitFor("il menu «Ordina» si apre", () => document.getElementById("context-menu") !== null);
    await settle();
    expect(sort.getAttribute("aria-expanded")).toBe("true");

    // Il clic del puntatore nel testo: il `mousedown` dà il fuoco all'editor,
    // poi il `click` arriva al documento e chiude il menu.
    const view = editorViews().find((each) => each.state.doc.toString().includes("Il primo documento"))!;
    view.contentDOM.focus();
    view.contentDOM.click();
    await settle();
    expect(sort.getAttribute("aria-expanded"), "il menu si chiude").toBe("false");
    const focused = editorViews().find((each) => each.contentDOM.contains(document.activeElement));
    expect(focused, "il fuoco resta nel testo cliccato, non sul pulsante del menu").toBe(view);

    // La battuta va all'editor col fuoco, e da lì alla sessione e al disco.
    focused!.dispatch({ changes: { from: 0, insert: "QQ" }, userEvent: "input.type" });
    await settle();
    const { documentSessions } = await import("./state/document-session");
    expect(documentSessions.text("Benvenuto.md")).toContain("QQIl primo documento");
    await waitFor("il salvataggio arriva al disco", () =>
      host.atGate("writeDocument").some((call) => call.args[0] === "Benvenuto.md" && String(call.args[1]).includes("QQIl primo")));
  });
});

describe("chiudere un riquadro", () => {
  const panes = () => [...document.querySelectorAll<HTMLElement>(".pane")];
  const tabNames = (pane: HTMLElement) => [...pane.querySelectorAll<HTMLElement>(".tab .tab-name")].map((tab) => tab.textContent);
  const run = async (id: string) => {
    const registry = await import("./ui/commands");
    await registry.allCommands().find((entry) => entry.id === id)?.run?.();
  };

  // La scheda unica di un riquadro chiuso col testo ancora da salvare: il
  // testo arriva sul disco prima che la sessione si chiuda, e la scheda si
  // riapre con Mod-Shift-t come una chiusa con la × (IMP-018).
  it("la scheda unica non si perde: il testo va sul disco e Mod-Shift-t la riapre (IMP-018)", async () => {
    const host = await start(VAULT);
    await twoPanes();
    // Nel secondo riquadro resta solo Riunione.
    panes()[1]!.querySelector<HTMLElement>(".tab-entry .tab-close")!.click();
    await waitFor("il secondo riquadro ha solo Riunione", () => tabNames(panes()[1]!).join() === "Riunione");
    const right = editorViews()[1]!;
    right.dispatch({ changes: { from: right.state.doc.length, insert: "testo del riquadro chiuso" } });
    expect(host.files()["note/Riunione.md"]).not.toContain("testo del riquadro chiuso");

    await run("shell.pane.close");
    expect(panes()).toHaveLength(1);
    expect(host.files()["note/Riunione.md"]).toContain("testo del riquadro chiuso");
    expect(tabNames(panes()[0]!)).toEqual(["Benvenuto"]);

    await run("shell.tab.reopen");
    await waitFor("Riunione torna nel riquadro rimasto", () => tabNames(panes()[0]!).includes("Riunione"));
    await waitFor("col testo scritto", () => editorViews()[0]?.state.doc.toString().includes("testo del riquadro chiuso") === true);
  });
});

describe("spostare linguette dal registro dei comandi", () => {
  const press = (on: Element, key: string, mods: KeyboardEventInit): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });
    on.dispatchEvent(event);
    return event;
  };
  const names = (pane: Element) =>
    [...pane.querySelectorAll<HTMLElement>(".tab")].map((tab) => tab.textContent?.trim());

  it("l'accordo del registro sposta la linguetta col fuoco, non quella attiva", async () => {
    await start(VAULT);
    const { openDocument } = await import("./panels/document");
    await openDocument("note/Riunione.md");
    await settle();
    const pane = document.querySelector<HTMLElement>(".pane")!;
    expect(names(pane)).toEqual(["Benvenuto", "Riunione"]);

    // Le frecce della striscia portano il fuoco sulla prima senza attivarla.
    const first = pane.querySelector<HTMLElement>(".tab")!;
    first.focus();
    const registry = await import("./ui/commands");
    const chord = { key: "PageDown", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false };
    expect(registry.advance(registry.allCommands(), null, chord)).toMatchObject({
      type: "esegue",
      entry: { id: "shell.tab.move.right" },
    });
    press(first, "PageDown", { ctrlKey: true, shiftKey: true });
    await waitFor("la linguetta col fuoco si sposta", () => names(pane)[1] === "Benvenuto");
    expect(names(pane)).toEqual(["Riunione", "Benvenuto"]);
    expect(textToVideo()).toContain("Appunti della riunione");
    expect(first.getAttribute("aria-keyshortcuts")).toContain("Control+Shift+PageDown");

    // Il gesto di prima non è più un tasto locale che aggira il registro.
    const old = press(pane.querySelectorAll<HTMLElement>(".tab")[1]!, "ArrowLeft", { altKey: true, shiftKey: true });
    await settle();
    expect(old.defaultPrevented).toBe(false);
    expect(names(pane)).toEqual(["Riunione", "Benvenuto"]);
  });

  it("porta la linguetta nel riquadro dopo, in giro, e l'appuntata resta", async () => {
    await start(VAULT);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "\\", ctrlKey: true }),
    );
    await waitFor("il secondo riquadro si apre", () => document.querySelectorAll(".pane").length === 2);
    await settle();
    const { openDocument } = await import("./panels/document");
    await openDocument("note/Riunione.md");
    await settle();
    const panes = () => [...document.querySelectorAll<HTMLElement>(".pane")];
    const focused = panes().find((pane) => pane.classList.contains("focus"))!;
    const other = panes().find((pane) => pane !== focused)!;
    const before = names(other).length;

    const registry = await import("./ui/commands");
    const next = registry.allCommands().find((entry) => entry.id === "shell.tab.move.pane.next")!;
    expect(next.binding).toBe("Mod-Alt-PageDown");
    await next.run!();
    await waitFor("la linguetta arriva nell'altro riquadro", () => names(other).length === before + 1);
    expect(names(other)).toContain("Riunione");
    expect(names(focused)).not.toContain("Riunione");

    // Un'appuntata è appuntata al suo riquadro: il comando non la porta via.
    const { pinCurrentTab } = await import("./panels/document");
    other.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await settle();
    pinCurrentTab(true);
    await settle();
    const pinned = names(other);
    await next.run!();
    await settle();
    expect(names(other)).toEqual(pinned);
  });
});
