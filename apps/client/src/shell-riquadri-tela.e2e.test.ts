// @vitest-environment happy-dom
//
// **La shell intera** (§17.2): i riquadri affiancati e la lavagna.
//
// Una parte delle prove che montano `main.ts` sulla scocca vera contro
// l'host finto; il perché, il montaggio e gli aiuti stanno in
// `shell-e2e-support.ts`.
import { describe, expect, it, vi } from "vitest";
import { appendToTextEditor as typeInEditor, mountedTextEditors as editorViews } from "./editors/text/test-support";
import type { FakeHost } from "./host/fake";
import type { CommandSpec, KnownVault } from "./host/contract";
import { start, settle, waitFor, row, textToVideo, VAULT, editorTexts, splitRight, twoPanes, useShellHarness } from "./shell-e2e-support";

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

describe("i riquadri dopo un'attesa", () => {
  it("il banner del conflitto risolve la nota che nomina, non quella col fuoco", async () => {
    const host = await start(VAULT);
    await twoPanes();
    const views = editorViews();
    views[0]!.dispatch({ changes: { from: 0, insert: "mio A " } });
    views[1]!.dispatch({ changes: { from: 0, insert: "mio B " } });
    await host.module.api.writeDocument("Benvenuto.md", "disco A\n", { kind: "dictated" });
    await host.module.api.writeDocument("note/Riunione.md", "disco B\n", { kind: "dictated" });
    const banners = () => [...document.querySelectorAll<HTMLElement>(".pane")]
      .map((pane) => pane.querySelector<HTMLElement>("[data-banner='document.conflict.body']"));
    await waitFor("entrambe le note vanno in conflitto", () => banners().every((b) => b && !b.hidden));

    // Il fuoco resta sul secondo riquadro: si sceglie dal banner del primo.
    const useDisk = banners()[0]!.querySelector<HTMLButtonElement>("button[data-choice='theirs']")!;
    useDisk.click();
    await waitFor("Benvenuto torna al disco", () => editorTexts()[0]?.startsWith("disco A") === true);
    await settle();

    expect(editorTexts()[1]).toContain("mio B");
    expect(banners()[1]?.hidden, "il conflitto di Riunione resta da decidere").toBe(false);
    expect(host.files()["note/Riunione.md"]).toBe("disco B\n");
  });

  /// La Cronologia accesa monta `version.keep` fra i comandi del registro.
  const specVersionKeep: CommandSpec = {
    id: "version.keep",
    title: "Conserva un testo nella cronologia",
    description: "",
    keybinding: null,
    params: [
      { name: "doc", title: "Documento", description: "", kind: { kind: "document" }, required: true },
      { name: "text", title: "Testo", description: "", kind: { kind: "text" }, required: true },
      { name: "note", title: "Nota", description: "", kind: { kind: "text" }, required: true },
    ],
    scope: { writes: true, reach: "document", reversible: true },
    surfaces: [],
  };

  it("«Usa la versione su disco» mette il mio testo nella Cronologia prima di scartarlo", async () => {
    const host = await start(VAULT, [], undefined, null, [specVersionKeep]);
    const { recentNotices } = await import("./ui/notify");
    editorViews()[0]!.dispatch({ changes: { from: 0, insert: "mio A " } });
    await host.module.api.writeDocument("Benvenuto.md", "disco A\n", { kind: "dictated" });
    const banner = () => document.querySelector<HTMLElement>(".pane [data-banner='document.conflict.body']");
    await waitFor("la nota va in conflitto", () => banner()?.hidden === false);
    const before = host.calls.length;

    banner()!.querySelector<HTMLButtonElement>("button[data-choice='theirs']")!.click();
    await waitFor("Benvenuto torna al disco", () => editorTexts()[0]?.startsWith("disco A") === true);
    await settle();

    const after = host.calls.slice(before);
    const kept = after.findIndex((c) => c.gate === "invokeCommand" && c.args[0] === "version.keep");
    const reread = after.findIndex((c) => (c.gate === "readDocument" || c.gate === "openDocument") && c.args[0] === "Benvenuto.md");
    expect(kept, "il testo è stato conservato").toBeGreaterThan(-1);
    expect(reread, "il disco si rilegge solo dopo la conservazione").toBeGreaterThan(kept);
    const args = after[kept]!.args[1] as { doc: string; text: string; note: string };
    expect(args.doc).toBe("Benvenuto.md");
    expect(args.text).toContain("mio A ");
    expect(args.note).toMatch(/^Testo scartato nel conflitto del /);
    expect(recentNotices().some((notice) => notice.text.includes("è nella Cronologia"))).toBe(true);
  });

  it("col testo nella Cronologia e il disco che non si rilegge lo si dice, e ripetere non lo conserva due volte", async () => {
    const host = await start(VAULT, [], undefined, null, [specVersionKeep]);
    const { recentNotices } = await import("./ui/notify");
    editorViews()[0]!.dispatch({ changes: { from: 0, insert: "mio A " } });
    await host.module.api.writeDocument("Benvenuto.md", "disco A\n", { kind: "dictated" });
    const banner = () => document.querySelector<HTMLElement>(".pane [data-banner='document.conflict.body']");
    await waitFor("la nota va in conflitto", () => banner()?.hidden === false);
    const before = host.calls.length;
    const repairOpen = host.fault("openDocument", "disco non leggibile");
    const repairRead = host.fault("readDocument", "disco non leggibile");

    banner()!.querySelector<HTMLButtonElement>("button[data-choice='theirs']")!.click();
    await waitFor(
      "chi scrive sa che il suo testo è salvo",
      () => recentNotices().some((notice) => notice.text.includes("è nella Cronologia, ma il file non si è riletto")),
    );
    await settle();
    repairOpen();
    repairRead();
    expect(editorTexts()[0]).toContain("mio A ");
    expect(banner()?.hidden, "il conflitto resta da decidere").toBe(false);

    banner()!.querySelector<HTMLButtonElement>("button[data-choice='theirs']")!.click();
    await waitFor("Benvenuto torna al disco", () => editorTexts()[0]?.startsWith("disco A") === true);
    await settle();

    const keeps = host.calls.slice(before).filter((c) => c.gate === "invokeCommand" && c.args[0] === "version.keep");
    expect(keeps, "lo stesso testo entra nella Cronologia una volta sola").toHaveLength(1);
  });

  it("se il testo non entra nella Cronologia non si scarta niente, e lo si dice", async () => {
    const host = await start(VAULT, [], undefined, null, [specVersionKeep]);
    const { recentNotices } = await import("./ui/notify");
    editorViews()[0]!.dispatch({ changes: { from: 0, insert: "mio A " } });
    await host.module.api.writeDocument("Benvenuto.md", "disco A\n", { kind: "dictated" });
    const banner = () => document.querySelector<HTMLElement>(".pane [data-banner='document.conflict.body']");
    await waitFor("la nota va in conflitto", () => banner()?.hidden === false);
    const repair = host.fault("invokeCommand", "spazio dati pieno");

    banner()!.querySelector<HTMLButtonElement>("button[data-choice='theirs']")!.click();
    await waitFor(
      "l'errore arriva a chi scrive",
      () => recentNotices().some((notice) => notice.text.includes("non è entrato nella Cronologia")),
    );
    await settle();
    repair();

    expect(editorTexts()[0]).toContain("mio A ");
    expect(banner()?.hidden, "il conflitto resta da decidere").toBe(false);
    expect(host.files()["Benvenuto.md"]).toBe("disco A\n");
  });

  it("la finestra staccata conserva il suo testo con la stessa regola, e un guasto lo dice", async () => {
    const host = await start(VAULT, [], undefined, null, [specVersionKeep]);
    const { recentNotices } = await import("./ui/notify");
    const { attachRemoteSurface } = await import("./state/document-bridge");
    const { state } = await import("./state/store");
    const { request, handle } = await attachRemoteSurface("Benvenuto.md", state.vaultRoot, () => "plain-text");
    // La finestra staccata, com'è vista dal canale: chiede e aspetta.
    const child = new BroadcastChannel(request.channel);
    const replies: Array<{ kind: string; token?: string; keeps?: boolean; reason?: string }> = [];
    child.onmessage = (event: MessageEvent) => replies.push(event.data);
    const id = { v: 1, doc: request.document, vault: request.vault, session: request.session, surfaceId: request.surfaceId };
    try {
      child.postMessage({ ...id, kind: "hello" });
      await waitFor("la finestra è collegata", () => replies.some((r) => r.kind === "snapshot"));
      child.postMessage({ ...id, kind: "keep-probe", token: "domanda" });
      await waitFor("la finestra sa se conserva", () => replies.some((r) => r.kind === "keep-mode"));
      expect(replies.find((r) => r.kind === "keep-mode")?.keeps).toBe(true);

      const before = host.calls.length;
      child.postMessage({ ...id, kind: "keep", token: "uno", text: "testo della finestra" });
      await waitFor("il testo è conservato", () => replies.some((r) => r.kind === "kept" && r.token === "uno"));
      const kept = host.calls.slice(before).find((c) => c.gate === "invokeCommand" && c.args[0] === "version.keep");
      const args = kept?.args[1] as { doc: string; text: string; note: string } | undefined;
      expect(args?.doc).toBe("Benvenuto.md");
      expect(args?.text).toBe("testo della finestra");
      expect(args?.note).toMatch(/^Testo scartato nel conflitto del /);
      // Il nome della nota come lo dice il resto dell'app, non il percorso.
      const notice = recentNotices().find((entry) => entry.text.includes("è nella Cronologia"));
      expect(notice?.text).toContain("su Benvenuto è");
      expect(notice?.text).not.toContain("Benvenuto.md");

      const repair = host.fault("invokeCommand", "spazio dati pieno");
      child.postMessage({ ...id, kind: "keep", token: "due", text: "testo della finestra" });
      await waitFor("il guasto torna alla finestra", () => replies.some((r) => r.token === "due"));
      repair();
      const failed = replies.find((r) => r.token === "due");
      expect(failed?.kind).toBe("keep-failed");
      expect(failed?.reason).toContain("spazio dati pieno");
    } finally {
      child.close();
      await handle.dispose();
    }
  });

  it("la palette dice che il testo resta nella Cronologia solo quando c'è chi lo conserva", async () => {
    const { IT } = await import("./i18n/catalog");
    const describe = async (): Promise<string | undefined> => {
      const registry = await import("./ui/commands");
      return registry.allCommands().find((entry) => entry.id === "shell.doc.conflict.theirs")?.description;
    };
    await start(VAULT);
    expect(await describe()).toBe(IT["commands.doc.conflict.theirs.desc_lost"]);
    await start(VAULT, [], undefined, null, [specVersionKeep]);
    expect(await describe()).toBe(IT["commands.doc.conflict.theirs.desc"]);
  });

  it("in Lettura il conflitto mostra il testo di chi scrive e lo dice nella fascia (R03)", async () => {
    const host = await start(VAULT);
    const { setMode } = await import("./panels/document");
    editorViews()[0]!.dispatch({ changes: { from: 0, insert: "mio A " } });
    await host.module.api.writeDocument("Benvenuto.md", "disco A\n", { kind: "dictated" });
    const banner = () => document.querySelector<HTMLElement>(".pane [data-banner='document.conflict.body']");
    const readingLine = () => banner()?.querySelector<HTMLElement>("[data-conflict-reading]") ?? null;
    await waitFor("la nota va in conflitto", () => banner()?.hidden === false);
    expect(readingLine(), "in Live la riga della Lettura non c'è").toBeNull();

    await setMode("reading");
    await settle();
    const rendered = document.querySelector<HTMLElement>(".pane-preview.markdown-rendered");
    expect(rendered?.textContent, "la Lettura mostra il buffer").toContain("mio A");
    expect(rendered?.textContent).not.toContain("disco A");
    expect(banner()?.hidden, "la fascia resta in Lettura").toBe(false);
    expect(banner()?.querySelectorAll(".conflict-actions button[data-choice]")).toHaveLength(2);
    expect(readingLine()?.textContent).toBe("Stai leggendo la tua versione, non ancora salvata");

    banner()!.querySelector<HTMLButtonElement>("button[data-choice='mine']")!.click();
    await waitFor("il conflitto si chiude", () => banner()?.hidden !== false);
    expect(readingLine(), "risolto il conflitto, la riga sparisce").toBeNull();
    expect(document.querySelector(".pane-preview.markdown-rendered")?.textContent).toContain("mio A");
  });

  it("due riquadri sulla stessa nota in conflitto: la riga solo in quello in Lettura", async () => {
    const host = await start(VAULT);
    await splitRight();
    await waitFor("il secondo riquadro si apre", () => document.querySelectorAll(".pane").length === 2);
    await settle();
    const { setMode } = await import("./panels/document");
    editorViews()[0]!.dispatch({ changes: { from: 0, insert: "mio A " } });
    await host.module.api.writeDocument("Benvenuto.md", "disco A\n", { kind: "dictated" });
    const banners = () => [...document.querySelectorAll<HTMLElement>(".pane")]
      .map((pane) => pane.querySelector<HTMLElement>("[data-banner='document.conflict.body']"));
    await waitFor("la nota va in conflitto in entrambi", () => banners().every((b) => b && !b.hidden));

    // Il fuoco è sul secondo riquadro, appena aperto: passa in Lettura.
    await setMode("reading");
    await settle();
    const panes = [...document.querySelectorAll<HTMLElement>(".pane")];
    expect(panes[1]!.querySelector(".pane-preview.markdown-rendered")?.textContent).toContain("mio A");
    expect(editorTexts()[0]).toContain("mio A");
    expect(banners()[0]!.querySelector("[data-conflict-reading]"), "il riquadro in Live non la mostra").toBeNull();
    expect(banners()[1]!.querySelector("[data-conflict-reading]")?.textContent)
      .toBe("Stai leggendo la tua versione, non ancora salvata");
  });

  it("una lettura fallita non lascia la linguetta mostrata senza editor", async () => {
    const host = await start(VAULT);
    const { openDocument, synchronize } = await import("./panels/document");
    const restore = [host.fault("readDocument"), host.fault("openDocument")];
    await openDocument("note/Spesa.md").catch(() => {});
    expect(textToVideo()).not.toContain("pane, latte");
    for (const undo of restore) undo();

    await synchronize();
    await settle();

    expect(textToVideo()).toContain("pane, latte");
  });

  const errorSurfaces = () => [...document.querySelectorAll<HTMLElement>(".document-surface-error")];

  it("un canvas rotto da fuori passa alla superficie d'errore e torna quando guarisce", async () => {
    const good = JSON.stringify({
      nodes: [{ id: "a", type: "text", text: "ciao", x: 0, y: 0, width: 10, height: 10 }],
      edges: [],
    });
    const host = await start({ ...VAULT, "lavagna.canvas": good });
    const { openDocument } = await import("./panels/document");
    await openDocument("lavagna.canvas");
    await waitFor("il canvas si monta", () => document.querySelector(".canvas-surface-host") !== null);

    // Un'altra app lo riscrive male: la superficie non resta coi nodi di
    // prima, dove una modifica sembrerebbe presa e non si salverebbe.
    host.writeFromOutside("lavagna.canvas", "{rotto");
    await waitFor("la superficie d'errore prende il posto del canvas", () => errorSurfaces().length === 1);
    expect(document.querySelector(".canvas-surface-host")).toBeNull();

    host.writeFromOutside("lavagna.canvas", good);
    await waitFor("il canvas torna", () => document.querySelector(".canvas-surface-host") !== null);
    expect(errorSurfaces()).toHaveLength(0);
  });

  it("un canvas rotto all'apertura mostra la superficie d'errore, non un riquadro vuoto", async () => {
    await start({ ...VAULT, "lavagna.canvas": "{rotto" });
    const { openDocument } = await import("./panels/document");
    await openDocument("lavagna.canvas");
    // Nell'attesa del nucleo il riquadro non mostra una tela da modificare.
    expect(document.querySelector(".canvas-viewport")).toBeNull();
    expect(document.querySelectorAll(".canvas-node")).toHaveLength(0);
    // Senza parser TypeScript il testo rotto lo dice il nucleo, appena è caricato.
    await waitFor("la superficie d'errore al posto della lavagna rotta", () => errorSurfaces().length === 1);

    expect(errorSurfaces()).toHaveLength(1);
    expect(errorSurfaces()[0]!.textContent).not.toBe("");
  });

  it("un riquadro che non si monta non ferma l'altro", async () => {
    await start({ ...VAULT, "lavagna.canvas": "{rotto" });
    await splitRight();
    await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);
    await settle();
    const { openDocument } = await import("./panels/document");
    const { state } = await import("./state/store");
    const panes = () => [...document.querySelectorAll<HTMLElement>(".pane")];

    panes()[0]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await openDocument("lavagna.canvas");
    await waitFor("il primo riquadro mostra l'errore", () => errorSurfaces().length === 1);

    panes()[1]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await openDocument("note/Spesa.md");
    await settle();

    expect(panes()[1]!.querySelector(".pane-editor .cm-content")?.textContent).toContain("pane, latte");
    expect(state.currentDoc).toBe("note/Spesa.md");
    expect(panes()[0]!.querySelector(".document-surface-error")).not.toBeNull();
  });

  it("il secondo editor si monta col testo che la sessione ha adesso", async () => {
    const host = await start(VAULT);
    // Le forme sintattiche passano da `queryIndex`: frenarlo ferma il secondo
    // riquadro dopo aver letto il buffer e prima di montare l'editor.
    const unlock = host.throttle("queryIndex");
    await splitRight();
    await settle();
    const first = editorViews()[0]!;
    first.dispatch({ changes: { from: first.state.doc.length, insert: " [durante il montaggio]" } });
    unlock();
    await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);
    await settle();

    const texts = editorTexts();
    expect(texts[1]).toBe(texts[0]);
    expect(texts[1]).toContain("[durante il montaggio]");
  });
});

/// Una tela con due carte: la seconda lontana dalla prima.
const BOARD = JSON.stringify({
  nodes: [
    { id: "prima", type: "text", text: "prima", x: 0, y: 0, width: 10, height: 10 },
    { id: "seconda", type: "text", text: "seconda", x: 900, y: 700, width: 10, height: 10 },
  ],
  edges: [],
});

describe("la carta in corso sulla tela", () => {
  /// Il testo di una carta aperta resta nel campo finché non si lascia o non
  /// passa la pausa: non è ancora nel buffer della sessione. Questi banchi
  /// guardano che la chiusura e il cambio da fuori non lo perdano lì.
  const CANVAS_VAULT = { ...VAULT, "lavagna.canvas": BOARD };

  async function openBoard(): Promise<void> {
    const { openDocument } = await import("./panels/document");
    await openDocument("lavagna.canvas");
    await waitFor("la tela mostra le carte", () => document.querySelector('.canvas-node[data-node="prima"]') !== null);
    await settle();
  }

  function typeInCard(id: string, value: string): void {
    document.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = document.querySelector<HTMLTextAreaElement>(".canvas-text-editor");
    if (!input) throw new Error("la carta non ha aperto il campo");
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("chiudere la finestra nella pausa porta il testo della carta sul disco", async () => {
    const host = await start(CANVAS_VAULT);
    await openBoard();
    typeInCard("prima", "la carta prima di chiudere");

    await host.close();

    const arrived = [
      ...host.atGate("writeDocument").filter((c) => c.args[0] === "lavagna.canvas"),
      ...host.atGate("saveDraft").filter((c) => c.args[0] === "lavagna.canvas"),
    ].map((c) => String(c.args[1]));
    expect(
      arrived.join("\n--- e poi ---\n"),
      "la finestra si è chiusa con la carta aperta: il testo non è arrivato né al disco né alla bozza",
    ).toContain("la carta prima di chiudere");
  });

  it("un cambio da fuori nella pausa dà il conflitto e tiene il testo della carta", async () => {
    const host = await start(CANVAS_VAULT);
    const { documentSessions } = await import("./state/document-session");
    await openBoard();
    typeInCard("prima", "la carta che nessuno deve perdere");

    host.writeFromOutside("lavagna.canvas", BOARD.replace('"text":"seconda"', '"text":"cambiata da fuori"'));

    await waitFor("la tela è in conflitto", () => document.getElementById("save-state")?.dataset.state === "conflitto");
    const snapshot = documentSessions.inspect("lavagna.canvas");
    expect(snapshot?.dirty).toBe(true);
    expect(snapshot?.text, "il cambio da fuori ha sostituito il testo della carta").toContain("la carta che nessuno deve perdere");
    expect(host.files()["lavagna.canvas"]).toContain("cambiata da fuori");
  });

  it("nessun motore della tela muore col testo di una carta ancora in sospeso", async () => {
    const host = await start(CANVAS_VAULT);
    const { CanvasEngine } = await import("./editors/canvas/engine");
    const { documentSessions } = await import("./state/document-session");
    const pendingAtDestroy: boolean[] = [];
    const destroy = CanvasEngine.prototype.destroy;
    const spy = vi.spyOn(CanvasEngine.prototype, "destroy").mockImplementation(function (this: InstanceType<typeof CanvasEngine>) {
      pendingAtDestroy.push(this.hasPending);
      destroy.call(this);
    });
    const registry = await import("./ui/commands");
    const run = async (id: string) => {
      await registry.allCommands().find((entry) => entry.id === id)?.run?.();
      await settle();
    };

    try {
      // Cambio di linguetta nello stesso riquadro.
      await openBoard();
      typeInCard("prima", "via per il cambio di linguetta");
      row("Benvenuto").click();
      await waitFor("Benvenuto torna davanti", () => editorTexts()[0]?.includes("Il primo documento") === true);
      expect(documentSessions.text("lavagna.canvas")).toContain("via per il cambio di linguetta");

      // Chiusura della linguetta.
      await openBoard();
      typeInCard("seconda", "via per la linguetta chiusa");
      const isBoard = (t: Element) => (t as HTMLElement).dataset.key?.includes("lavagna.canvas") === true;
      const tab = [...document.querySelectorAll<HTMLElement>(".pane .tab")].find(isBoard);
      tab?.parentElement?.querySelector<HTMLElement>(".tab-close")?.click();
      await waitFor("la linguetta della tela si chiude", () => ![...document.querySelectorAll(".pane .tab")].some(isBoard));
      await waitFor("la carta arriva sul disco", () => host.files()["lavagna.canvas"]?.includes("via per la linguetta chiusa") === true);

      // Chiusura del riquadro.
      await splitRight();
      await waitFor("il secondo riquadro si apre", () => document.querySelectorAll(".pane").length === 2);
      await openBoard();
      typeInCard("prima", "via per il riquadro chiuso");
      await run("shell.pane.close");
      await waitFor("il riquadro si chiude", () => document.querySelectorAll(".pane").length === 1);
      await waitFor("la carta arriva sul disco", () => host.files()["lavagna.canvas"]?.includes("via per il riquadro chiuso") === true);

      expect(pendingAtDestroy.length, "ogni via ha distrutto un motore").toBeGreaterThanOrEqual(3);
      expect(pendingAtDestroy, "un motore è morto col testo di una carta in sospeso").not.toContain(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("portare a schermo un punto", () => {
  const panes = () => [...document.querySelectorAll<HTMLElement>(".pane")];
  const cursor = (index: number) => editorViews()[index]!.state.selection.main.head;
  const toast = () => [...document.querySelectorAll(".toast")].pop()?.textContent ?? "";

  it("il punto va al riquadro che mostra il documento, non a quello col fuoco", async () => {
    await start(VAULT);
    await twoPanes();
    const { applyIntent } = await import("./ui/intents");
    expect(panes()[1]!.classList.contains("focus")).toBe(true);
    const before = cursor(1);

    // Lo span nomina Benvenuto, che sta nel primo riquadro: l'offset misurato
    // su quel testo non deve finire nel testo di Riunione.
    await applyIntent({ kind: "reveal", doc_id: "Benvenuto.md", span: { start: 10, end: 10 } });
    await settle();

    expect(panes()[0]!.classList.contains("focus"), "il riquadro di Benvenuto prende il fuoco").toBe(true);
    expect(cursor(0)).toBe(10);
    expect(cursor(1), "il cursore di Riunione resta dov'era").toBe(before);
    expect(editorTexts()[1]).toContain("Appunti");
  });

  it("una linguetta dietro un'altra torna davanti prima di portarci il punto", async () => {
    await start(VAULT);
    const { openDocument } = await import("./panels/document");
    const { applyIntent } = await import("./ui/intents");
    const { state } = await import("./state/store");
    await openDocument("note/Riunione.md");
    await settle();
    expect(state.currentDoc).toBe("note/Riunione.md");

    await applyIntent({ kind: "reveal", doc: "Benvenuto.md", span: { start: 9, end: 9 } });
    await settle();

    expect(state.currentDoc).toBe("Benvenuto.md");
    expect(editorTexts()).toHaveLength(1);
    expect(editorTexts()[0]).toContain("Il primo documento");
    expect(cursor(0)).toBe(9);
    expect(panes()[0]!.querySelectorAll(".tab"), "nessuna linguetta in più").toHaveLength(2);
  });

  it("una superficie che non sa portarci lo dice, invece di non fare niente", async () => {
    await start({ ...VAULT, "foto.png": "png" });
    const { applyIntent } = await import("./ui/intents");
    const { t } = await import("./i18n/strings");

    await applyIntent({ kind: "reveal", doc: "foto.png", span: { start: 3, end: 3 } });
    await settle();

    expect(panes()[0]!.querySelector(".media-surface"), "l'immagine è aperta").not.toBeNull();
    expect(toast()).toContain(t("document.reveal_unavailable", { doc: "foto" }));
  });

  it("sulla tela il punto è la carta che lo contiene", async () => {
    await start({ ...VAULT, "lavagna.canvas": BOARD });
    const { applyIntent } = await import("./ui/intents");
    const { t } = await import("./i18n/strings");
    const at = BOARD.indexOf('"seconda"');

    await applyIntent({ kind: "reveal", doc: "lavagna.canvas", span: { start: at, end: at } });
    await waitFor("una carta è selezionata", () => document.querySelector(".canvas-node.selected") !== null);

    expect([...document.querySelectorAll<HTMLElement>(".canvas-node.selected")].map((node) => node.dataset.node))
      .toEqual(["seconda"]);
    expect(toast()).not.toContain(t("document.reveal_unavailable", { doc: "lavagna" }));
  });

  it("il menu del riquadro offre ciò che la superficie dichiara di saper fare", async () => {
    await start({ ...VAULT, "lavagna.canvas": BOARD });
    const { openDocument } = await import("./panels/document");
    const { t } = await import("./i18n/strings");
    const { closeContextMenu } = await import("./ui/menu");
    const gestures = [t("pane.recorder.open"), t("pane.slides"), t("pane.print"), t("pane.export_pdf")];
    const offered = async (): Promise<string[]> => {
      panes()[0]!.querySelector<HTMLButtonElement>("[data-pane-menu]")!.click();
      await settle();
      const menus = [...document.querySelectorAll<HTMLElement>("#context-menu")];
      const labels = [...(menus[menus.length - 1]?.querySelectorAll("button") ?? [])]
        .map((button) => button.querySelector(".menu-label")?.textContent ?? button.textContent ?? "");
      closeContextMenu();
      await settle();
      return gestures.filter((gesture) => labels.includes(gesture));
    };

    // Una nota Markdown si stampa dallo spazio «Esporta in PDF».
    expect(await offered(), "la nota Markdown").toEqual([t("pane.recorder.open"), t("pane.slides"), t("pane.export_pdf")]);
    await openDocument("lavagna.canvas");
    await settle();
    // La tela si stampa dal suo provider; non ha una resa da presentare né
    // una sintassi in cui scrivere un rimando.
    expect(await offered(), "la tela").toEqual([t("pane.print")]);
  });

  it("i menu dell'albero, delle schede e del riquadro stanno nel bilancio e parlano col lessico", async () => {
    await start({ ...VAULT, "dati.zip": "zip" });
    const { openDocument } = await import("./panels/document");
    await openDocument("Benvenuto.md");
    await settle();
    const { forbiddenIn } = await import("./i18n/lexicon");
    const { closeContextMenu } = await import("./ui/menu");
    const tree = (path: string) => document.querySelector<HTMLElement>(`#file-list li[data-path="${path}"] > .tree-row`)!;
    const places: [string, () => HTMLElement, "click" | "contextmenu"][] = [
      ["una nota", () => tree("Benvenuto.md"), "contextmenu"],
      ["un altro file", () => tree("dati.zip"), "contextmenu"],
      ["una cartella", () => tree("note"), "contextmenu"],
      ["il titolo dell'albero", () => document.querySelector<HTMLElement>("#files-title")!, "contextmenu"],
      ["una scheda", () => document.querySelector<HTMLElement>(".pane .tab")!, "contextmenu"],
      ["il riquadro", () => panes()[0]!.querySelector<HTMLElement>("[data-pane-menu]")!, "click"],
    ];
    for (const [place, on, gesture] of places) {
      if (gesture === "click") on().click();
      else on().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      await settle();
      const menu = document.getElementById("context-menu");
      expect(menu, place).not.toBeNull();
      const entries = [...menu!.querySelectorAll<HTMLElement>(".menu-items [role^=menuitem]")];
      const clipboard = menu!.querySelector(".menu-clipboard") ? 1 : 0;
      const groups = menu!.querySelectorAll(".menu-items .menu-separator").length + 1 + clipboard;
      const labels = entries.map((entry) => entry.querySelector(".menu-label")?.textContent ?? "");
      expect(entries.length + clipboard, `${place}: ${labels.join(", ")}`).toBeLessThanOrEqual(9);
      expect(groups, place).toBeLessThanOrEqual(4);
      const danger = entries.findIndex((entry) => entry.classList.contains("danger"));
      if (danger >= 0) expect(entries.slice(danger).every((entry) => entry.classList.contains("danger")), place).toBe(true);
      expect(labels.filter((label) => forbiddenIn(label) !== null), place).toEqual([]);
      expect(menu!.querySelector(".menu-head"), `${place} ha la sua testata`).not.toBeNull();
      if (place === "il titolo dell'albero") {
        expect(menu!.querySelector(".menu-head-kind")!.textContent, "il nome dello spazio, senza il bottone accanto").toBe(document.getElementById("space-title")!.textContent);
      }
      closeContextMenu();
      await settle();
    }
  });

  it("la stampa dallo spazio «Esporta in PDF» salva prima ciò che il buffer ha, e su afterprint non lascia niente", async () => {
    const host = await start(VAULT);
    const { t } = await import("./i18n/strings");
    const previous = Object.getOwnPropertyDescriptor(window, "print");
    const print = vi.fn();
    Object.defineProperty(window, "print", { configurable: true, value: print });
    try {
      // Il debounce del salvataggio non è ancora scaduto: senza il flush la
      // resa di stampa, che il kernel legge dal disco, non avrebbe la riga.
      typeInEditor("Riga appena scritta.");
      expect(host.atGate("writeDocument")).toHaveLength(0);
      panes()[0]!.querySelector<HTMLButtonElement>("[data-pane-menu]")!.click();
      await settle();
      const entry = [...document.querySelectorAll<HTMLButtonElement>("#context-menu button")]
        .find((button) => button.querySelector(".menu-label")?.textContent === t("pane.export_pdf"));
      entry!.click();
      await waitFor("lo spazio si apre", () => document.querySelector(".export-print") !== null);
      // La resa che si impagina ha la riga: la nota è stata salvata prima.
      await waitFor("la resa arriva", () => document.querySelector(".export-measure")?.textContent?.includes("Riga appena scritta.") === true);
      document.querySelector<HTMLButtonElement>(".export-print")!.click();
      await waitFor("la stampa parte", () => print.mock.calls.length > 0);

      const written = host.calls.findIndex((call) => call.gate === "writeDocument");
      const rendered = host.calls.findIndex((call) =>
        call.gate === "queryIndex" && (call.args[0] as { kind?: string }).kind === "render_print");
      expect(written).toBeGreaterThanOrEqual(0);
      expect(rendered).toBeGreaterThan(written);
      // Le stesse pagine dello spazio, senza zoom.
      expect(document.querySelectorAll(".print-host > .print-sheet")).toHaveLength(document.querySelectorAll(".export-slot").length);
      expect(document.querySelector(".print-host")?.textContent).toContain("Benvenuto");

      window.dispatchEvent(new Event("afterprint"));
      expect(document.querySelector(".print-host")).toBeNull();
      document.querySelector(".export-space")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(document.querySelector(".export-space")).toBeNull();
    } finally {
      if (previous) Object.defineProperty(window, "print", previous);
      else Reflect.deleteProperty(window, "print");
    }
  });

  it("«Esporta in PDF…» salva, apre lo spazio sopra la nota, cambia vista e con Esc torna alla nota", async () => {
    const host = await start(VAULT);
    const { t } = await import("./i18n/strings");
    typeInEditor("Riga per il PDF.");
    expect(host.atGate("writeDocument")).toHaveLength(0);
    const opener = panes()[0]!.querySelector<HTMLButtonElement>("[data-pane-menu]")!;
    opener.focus();
    opener.click();
    await settle();
    const labels = [...document.querySelectorAll<HTMLButtonElement>("#context-menu button")].map((button) => button.querySelector(".menu-label")?.textContent);
    // Al posto di «Stampa», che sta nello spazio.
    expect(labels).toContain(t("pane.export_pdf"));
    expect(labels).not.toContain(t("pane.print"));
    [...document.querySelectorAll<HTMLButtonElement>("#context-menu button")]
      .find((button) => button.querySelector(".menu-label")?.textContent === t("pane.export_pdf"))!.click();
    await waitFor("lo spazio si apre", () => document.querySelector(".export-space") !== null);

    const space = document.querySelector<HTMLElement>(".export-space")!;
    expect(space.getAttribute("role")).toBe("dialog");
    expect(document.getElementById("workspace")!.inert).toBe(true);
    // La nota salvata prima della resa, che il core legge dal disco.
    const written = host.calls.findIndex((call) => call.gate === "writeDocument");
    const rendered = host.calls.findIndex((call) =>
      call.gate === "queryIndex" && (call.args[0] as { kind?: string }).kind === "render_print");
    expect(written).toBeGreaterThanOrEqual(0);
    expect(rendered).toBeGreaterThan(written);
    await waitFor("le pagine ci sono", () => space.querySelector(".export-slot") !== null);
    expect(space.querySelector(".export-title-note")?.textContent).not.toBe("");

    space.querySelector<HTMLButtonElement>('.export-segment[data-view="due"]')!.click();
    expect(space.querySelector(".export-doc")?.getAttribute("data-view")).toBe("due");
    expect(space.querySelector('.export-segment[data-view="due"]')?.getAttribute("aria-pressed")).toBe("true");

    space.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".export-space")).toBeNull();
    expect(document.querySelector(".export-measure")).toBeNull();
    expect(document.getElementById("workspace")!.inert).toBe(false);
    expect(panes()[0]!.contains(document.activeElement)).toBe(true);
  });

  it("lo spazio «Esporta in PDF» si apre anche dallo spazio dei comandi", async () => {
    await start(VAULT);
    const { allCommands } = await import("./ui/commands");
    const command = allCommands().find((entry) => entry.id === "shell.doc.export_pdf")!;
    expect(command.unavailable ?? null).toBeNull();
    await command.run!();
    await waitFor("lo spazio si apre", () => document.querySelector(".export-space") !== null);
    document.querySelector<HTMLButtonElement>(".export-back")!.click();
    expect(document.querySelector(".export-space")).toBeNull();
  });

  it("la nota resta byte per byte: aprire lo spazio, regolare, stampare e tornare non la riscrive", async () => {
    // A capo di Windows, spazi in coda, l'interruzione a mano e nessun a capo
    // finale: niente che una riscrittura lascerebbe com'è.
    const note = "---\r\ntags: [prova]\r\n---\r\n# Strana  \r\n\r\nRiga con spazi in coda   \r\n\r\n<!-- pagina -->\r\n\r\n| a | b |\r\n|---|---|\r\n| 1 | 2 |\r\n\r\nSenza a capo finale";
    const host = await start({ ...VAULT, "Strana.md": note });
    const { openDocument } = await import("./panels/document");
    const { allCommands } = await import("./ui/commands");
    await openDocument("Strana.md");
    await settle();
    const previous = Object.getOwnPropertyDescriptor(window, "print");
    const print = vi.fn();
    Object.defineProperty(window, "print", { configurable: true, value: print });
    try {
      await allCommands().find((entry) => entry.id === "shell.doc.export_pdf")!.run!();
      await waitFor("le pagine ci sono", () => document.querySelector(".export-space .export-slot") !== null);
      const space = document.querySelector<HTMLElement>(".export-space")!;
      space.querySelector<HTMLButtonElement>('.export-segment[data-view="tutte"]')!.click();
      space.querySelector<HTMLButtonElement>('.export-section[data-section="tema"] .export-section-head')!.click();
      await settle();
      space.querySelector<HTMLButtonElement>("#export-theme-relazione")!.click();
      await settle();
      space.querySelector<HTMLButtonElement>(".export-print")!.click();
      await waitFor("la stampa parte", () => print.mock.calls.length > 0);
      window.dispatchEvent(new Event("afterprint"));
      space.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(document.querySelector(".export-space")).toBeNull();
      await settle();
    } finally {
      if (previous) Object.defineProperty(window, "print", previous);
      else Reflect.deleteProperty(window, "print");
    }
    expect(host.atGate("writeDocument").filter((call) => call.args[0] === "Strana.md")).toEqual([]);
    expect(host.files()["Strana.md"]).toBe(note);
  });
});

describe("la modalità di ogni famiglia di superfici", () => {
  const paneMode = () => document.querySelector<HTMLElement>(".pane.focus")?.dataset.mode;
  const choose = async (mode: string) => {
    document.querySelector<HTMLButtonElement>(`.pane.focus .pane-toolbar button[data-mode="${mode}"]`)!.click();
    await settle();
  };

  it("il bottone solo dice la modalità accesa e la cambia da un menu di scelte", async () => {
    await start(VAULT);
    const current = document.querySelector<HTMLButtonElement>(".pane.focus > .pane-mode-current")!;
    const pressed = () =>
      document.querySelector<HTMLElement>('.pane.focus .pane-toolbar button[data-mode][aria-pressed="true"]')?.textContent;
    expect(current.hidden).toBe(false);
    expect(current.textContent).toBe(pressed());
    expect(current.getAttribute("aria-label")).toContain(pressed()!);
    current.click();
    expect(current.getAttribute("aria-expanded")).toBe("true");
    const radios = [...document.querySelectorAll<HTMLElement>("#context-menu [role=menuitemradio]")];
    expect(radios.map((item) => item.querySelector(".menu-label")?.textContent)).toEqual(["Scrittura", "Sorgente", "Lettura"]);
    expect(radios.filter((item) => item.getAttribute("aria-checked") === "true")).toHaveLength(1);
    radios.find((item) => item.querySelector(".menu-label")?.textContent === "Sorgente")!.click();
    await settle();
    expect(paneMode()).toBe("source");
    expect(current.textContent).toBe("Sorgente");
    expect(current.getAttribute("aria-expanded")).toBe("false");
  });

  it("con due riquadri aperti, `shell.mode.source` cambia solo quello a fuoco", async () => {
    await start(VAULT);
    await twoPanes();
    const modes = () => [...document.querySelectorAll<HTMLElement>(".pane")].map((pane) => pane.dataset.mode);
    const focused = () => [...document.querySelectorAll<HTMLElement>(".pane")].findIndex((pane) => pane.classList.contains("focus"));
    expect(modes()).toEqual(["live_preview", "live_preview"]);
    expect(focused()).toBe(1);
    const registry = await import("./ui/commands");
    await registry.allCommands().find((entry) => entry.id === "shell.mode.source")!.run!();
    await settle();
    expect(modes()).toEqual(["live_preview", "source"]);
    expect(focused()).toBe(1);
  });

  it("una nota in Sorgente non fa aprire la tela seguente come JSON", async () => {
    await start({ ...VAULT, "lavagna.canvas": BOARD });
    const { openDocument } = await import("./panels/document");
    await choose("source");
    expect(paneMode()).toBe("source");

    await openDocument("lavagna.canvas");
    await settle();
    expect(paneMode(), "la tela si apre sulla tela").toBe("canvas");
    expect(document.querySelector(".pane.focus [data-surface-mode='canvas']")).not.toBeNull();

    await openDocument("Benvenuto.md");
    await settle();
    expect(paneMode(), "la nota ritrova la Sorgente scelta").toBe("source");
  });

  it("la modalità scelta sulla tela non decide come si apre la nota", async () => {
    await start({ ...VAULT, "lavagna.canvas": BOARD });
    const { openDocument } = await import("./panels/document");
    expect(paneMode()).toBe("live_preview");
    await openDocument("lavagna.canvas");
    await settle();
    await choose("source");
    await choose("canvas");

    await openDocument("Benvenuto.md");
    await settle();
    expect(paneMode(), "non la Sorgente, prima modalità del testo").toBe("live_preview");

    await openDocument("lavagna.canvas");
    await settle();
    await choose("source");
    await openDocument("Benvenuto.md");
    await settle();
    expect(paneMode()).toBe("live_preview");
    await openDocument("lavagna.canvas");
    await settle();
    expect(paneMode(), "la tela ritrova il suo sorgente").toBe("source");
  });

  // Il contratto non nomina le modalità di una superficie: dice che vista è.
  // La tela si scrive attraverso una resa, non sul sorgente.
  it("il contesto pubblicato dice che vista è, non una modalità Markdown", async () => {
    const host = await start({ ...VAULT, "lavagna.canvas": BOARD });
    const { openDocument } = await import("./panels/document");
    const published = () => {
      const calls = host.atGate("setActiveContext");
      return (calls[calls.length - 1]?.args[0] as { doc: string | null; mode: string } | undefined);
    };

    await openDocument("lavagna.canvas");
    await settle();
    expect(published()).toMatchObject({ doc: "lavagna.canvas", mode: "live_preview" });
    await choose("source");
    expect(published()).toMatchObject({ doc: "lavagna.canvas", mode: "source" });

    await openDocument("Benvenuto.md");
    await settle();
    await choose("reading");
    expect(published()).toMatchObject({ doc: "Benvenuto.md", mode: "reading" });
  });
});
