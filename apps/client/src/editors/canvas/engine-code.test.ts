// @vitest-environment happy-dom
// Le prove di `CanvasEngine`: la lavagna come codice (LIC T25).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CanvasEngine } from "./engine";
import { CANVAS_CLIPBOARD_TYPE, CANVAS_PASTE_STEP, clipboardJson, copiedSelection } from "./clipboard";
import { t } from "../../i18n/strings";
import { canvasCoreReady, openCoreNow, type CanvasIntentOp } from "./wasm/core";
import { type CanvasPreferences } from "./preferences";
import { declareClipboard } from "../../platform/clipboard";
import { mounted, readCanvas } from "./engine-test-support";

// Le impostazioni della lavagna (T35): il motore monta `watchPreferences`, e la
// prova tiene le sue funzioni per cambiare «La rotella del mouse» a lavagna
// aperta, come farebbe un cambio da Impostazioni. Il resto del modulo è quello vero.
const watched = vi.hoisted(() => ({ appliers: [] as Array<(preferences: CanvasPreferences) => void> }));

vi.mock("./preferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./preferences")>()),
  watchPreferences: (apply: (preferences: CanvasPreferences) => void) => {
    watched.appliers.push(apply);
    return () => {
      watched.appliers = watched.appliers.filter((other) => other !== apply);
    };
  },
}));

// Le notifiche della shell (T70, «Estrai in una nota»): la prova legge che
// cosa dicono e quale gesto offrono. Il resto del modulo è quello vero.
const notices = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock("../../ui/notify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ui/notify")>()),
  notify: notices.notify,
}));

// Il nucleo si carica una volta: dopo, la tela si apre subito.
beforeAll(async () => {
  await canvasCoreReady();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("la lavagna come codice: copia, incolla, disponi (LIC T25)", () => {
  const STROKE = {
    id: "s-a", tool: "pen",
    brush: "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint",
    color: "#0072b2", anchor: { kind: "card", width: 240, height: 160 }, ink: "1 s100 cxy 4000,2500 120,40 95,-10",
  };

  /** Due schede collegate, una terza a parte; con `ink` un tratto su `a` e uno libero. */
  function board(ink = false): string {
    return JSON.stringify({
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 240, height: 160, text: "uno", ...(ink ? { "fub:ink": { v: 1, strokes: [STROKE] } } : {}) },
        { id: "b", type: "text", x: 400, y: 0, width: 240, height: 160, text: "due" },
        { id: "c", type: "text", x: 0, y: 400, width: 240, height: 160, text: "tre" },
      ],
      edges: [{ id: "e1", fromNode: "a", toNode: "b" }],
      ...(ink ? { "fub:ink": { v: 1, strokes: [{ ...STROKE, id: "s-free", anchor: { kind: "free" } }] } } : {}),
    });
  }

  const stops: Array<() => void> = [];
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
  });

  /** Gli appunti di una prova: `text` si legge come `text/plain` (`null`: vuoti), ciò che si scrive finisce in `written`. */
  function clipboard(text: string | null): string[] {
    const written: string[] = [];
    stops.push(declareClipboard(async (value) => {
      written.push(value);
    }, {
      write: async () => {},
      read: async () => (text === null ? [] : [{ types: ["text/plain"], getType: async () => new Blob([text], { type: "text/plain" }) }]),
      supports: () => true,
    }));
    return written;
  }

  function viewport(host: HTMLElement): HTMLElement {
    return host.querySelector<HTMLElement>(".canvas-viewport")!;
  }

  function pick(host: HTMLElement, id: string, additive = false): void {
    host.querySelector(`.canvas-node[data-node="${id}"]`)!.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 3, shiftKey: additive, clientX: 0, clientY: 0 }),
    );
    viewport(host).dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3, clientX: 0, clientY: 0 }));
  }

  function command(engine: CanvasEngine, id: string) {
    return engine.commands().find((one) => one.id === id)!;
  }

  /** Lascia finire le promesse della tela (gli appunti, il dialogo). */
  async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const notice = (host: HTMLElement) => host.querySelector(".canvas-intake-error")?.textContent ?? "";
  const dialog = () => document.querySelector<HTMLElement>(".kit-dialog");

  /** Il testo che il nucleo scrive per `ops` su `source`, col seme 1. */
  function compiled(source: string, ops: readonly unknown[]): string {
    const core = openCoreNow(source)!;
    try {
      return core.preview(core.compile(ops as CanvasIntentOp[], 1n).patches);
    } finally {
      core.close();
    }
  }

  /** «Incolla codice» con `text` negli appunti, fino alla finestra (o all'avviso). */
  async function pasteCode(engine: CanvasEngine, text: string | null): Promise<void> {
    clipboard(text);
    command(engine, "canvas.paste_code").run();
    await settle();
  }

  it("«Copia come codice» senza scelta dà la lavagna intera, con una scelta solo quelle schede; non scrive", async () => {
    const source = board();
    const { engine, host, changes } = mounted(source, { seed: () => 1n });
    const written = clipboard(null);
    command(engine, "canvas.copy_code").run();
    await settle();
    expect(written).toHaveLength(1);
    const all = JSON.parse(written[0]!) as Array<{ op: string; id?: string }>;
    expect(all.filter((op) => op.op === "add_card").map((op) => op.id)).toEqual(["a", "b", "c"]);
    expect(all.filter((op) => op.op === "connect")).toHaveLength(1);
    // La lista rifà la lavagna: compilata su una lavagna vuota ne dà lo stesso modello.
    expect(readCanvas(compiled("", all))).toEqual(readCanvas(source));

    pick(host, "a");
    pick(host, "c", true);
    command(engine, "canvas.copy_code").run();
    await settle();
    const some = JSON.parse(written[1]!) as Array<{ op: string; id?: string }>;
    expect(some.filter((op) => op.op === "add_card").map((op) => op.id)).toEqual(["a", "c"]);
    expect(some.some((op) => op.op === "connect")).toBe(false);
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(source);
    // In sola lettura si copia lo stesso; una lavagna vuota non ha niente da copiare.
    engine.setReadOnly(true);
    expect(command(engine, "canvas.copy_code").disabled()).toBeNull();
    expect(command(engine, "canvas.paste_code").disabled()).toBe(t("canvas.commands.why.read_only"));
    engine.setReadOnly(false);
    engine.setDoc("");
    expect(command(engine, "canvas.copy_code").disabled()).toBe(t("canvas.commands.why.empty"));
    engine.destroy();
  });

  it("«Copia come codice» su una lavagna con tratti dà l'inchiostro nelle forme di T17", async () => {
    const { engine } = mounted(board(true), { seed: () => 1n });
    const written = clipboard(null);
    command(engine, "canvas.copy_code").run();
    await settle();
    const ops = JSON.parse(written[0]!) as Array<{ op: string; layer?: unknown; strokes?: Array<{ id: string }> }>;
    const ink = ops.filter((op) => op.op === "add_strokes");
    expect(ink).toHaveLength(2);
    expect(ink.some((op) => op.layer === "board")).toBe(true);
    expect(ink.flatMap((op) => op.strokes ?? []).map((stroke) => stroke.id).sort()).toEqual(["s-a", "s-free"]);
    expect(readCanvas(compiled("", ops))).toEqual(readCanvas(board(true)));
    engine.destroy();
  });

  it("«Incolla codice»: il riassunto, poi «Incolla» scrive in un passo d'annulla e sceglie le schede nate", async () => {
    const source = board();
    const { engine, host, changes } = mounted(source, { seed: () => 1n });
    const ops = [
      { op: "add_card", text: "nuova", x: 800, y: 0 },
      { op: "move", ids: ["c"], dx: 40, dy: 0 },
    ];
    await pasteCode(engine, JSON.stringify(ops));
    expect(dialog()?.textContent).toContain("1 scheda nuova, 1 scheda spostata");
    expect(changes).toHaveLength(0);
    document.querySelector<HTMLElement>('.kit-dialog [data-action="paste"]')!.click();
    await settle();
    expect(dialog()).toBeNull();
    // Come lo scrive il nucleo con lo stesso seme del controllo.
    expect(engine.getDoc()).toBe(compiled(source, ops));
    expect(changes).toHaveLength(1);
    const born = readCanvas(engine.getDoc()).nodes.find((node) => node.type === "text" && node.text === "nuova")!;
    expect(engine.selection().nodes).toEqual([born.id]);
    expect(host.querySelector(`.canvas-node[data-node="${born.id}"]`)!.classList.contains("selected")).toBe(true);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(source);
    expect(engine.undo()).toBe(false);
    engine.destroy();
  });

  it("Esc e «Annulla» chiudono la finestra senza scrivere", async () => {
    const source = board();
    const { engine, changes } = mounted(source, { seed: () => 1n });
    const text = JSON.stringify([{ op: "remove", ids: ["c"] }]);
    await pasteCode(engine, text);
    expect(dialog()?.textContent).toContain("1 scheda tolta");
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await settle();
    expect(dialog()).toBeNull();
    await pasteCode(engine, text);
    document.querySelector<HTMLElement>('.kit-dialog [data-action="cancel"]')!.click();
    await settle();
    expect(dialog()).toBeNull();
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(source);
    expect(engine.undo()).toBe(false);
    engine.destroy();
  });

  it("una scheda che non c'è: il primo problema, `unknown_node` col suggerimento, e nessuna finestra", async () => {
    const source = board();
    const { engine, host, changes } = mounted(source, { seed: () => 1n });
    await pasteCode(engine, JSON.stringify([{ op: "add_card", text: "ok" }, { op: "move", ids: ["bb"], dx: 10, dy: 0 }]));
    expect(dialog()).toBeNull();
    const said = notice(host);
    expect(said).toContain(t("canvas.code.problem.unknown_node"));
    expect(said).toContain("Operazione 2, /1/ids/0");
    expect(said).toContain("Forse: b");
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(source);
    engine.destroy();
  });

  it("appunti vuoti, un testo che non è JSON o non è una lista: l'avviso, nessuna finestra", async () => {
    const source = board();
    const { engine, host, changes } = mounted(source, { seed: () => 1n });
    await pasteCode(engine, null);
    expect(notice(host)).toBe(t("canvas.paste_code.empty"));
    await pasteCode(engine, "graph TD; A-->B");
    expect(notice(host)).toBe(t("canvas.paste_code.not_json"));
    // Dopo un avviso senza finestra il fuoco è sulla tela.
    expect(document.activeElement).toBe(viewport(host));
    await pasteCode(engine, "﻿  \n");
    expect(notice(host)).toBe(t("canvas.paste_code.empty"));
    await pasteCode(engine, JSON.stringify({ op: "add_card" }));
    expect(notice(host)).toBe(t("canvas.paste_code.not_list"));
    // Una lista che non cambia niente lo dice, senza chiedere.
    await pasteCode(engine, "[]");
    expect(notice(host)).toBe(t("canvas.paste_code.nothing"));
    // Ciò che JSON non dice esatto non arriva né al controllo né alla scrittura.
    await pasteCode(engine, "[1e999]");
    expect(notice(host)).toBe(t("canvas.paste_code.bad_number"));
    await pasteCode(engine, '[{"op":"add_card","text":"\\ud800"}]');
    expect(notice(host)).toBe(t("canvas.paste_code.bad_text"));
    await pasteCode(engine, `${"[".repeat(65)}${"]".repeat(65)}`);
    expect(notice(host)).toBe(t("canvas.paste_code.too_deep"));
    await pasteCode(engine, `${"[".repeat(129)}${"]".repeat(129)}`);
    expect(notice(host)).toBe(t("canvas.paste_code.too_deep"));
    // Entro i livelli la lista arriva al nucleo, che dice il suo problema.
    await pasteCode(engine, `${"[".repeat(64)}${"]".repeat(64)}`);
    expect(notice(host)).toContain(t("canvas.code.problem.wrong_type"));
    expect(dialog()).toBeNull();
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(source);
    engine.destroy();
  });

  it("gli appunti che non si leggono lo dicono; una lavagna cambiata mentre si decide non scrive", async () => {
    const source = board();
    const { engine, host, changes } = mounted(source, { seed: () => 1n });
    stops.push(declareClipboard(async () => {}, {
      write: async () => {},
      read: () => Promise.reject(new Error("negato")),
      supports: () => true,
    }));
    command(engine, "canvas.paste_code").run();
    await settle();
    expect(notice(host)).toBe(t("editor_menu.paste_failed"));

    await pasteCode(engine, JSON.stringify([{ op: "remove", ids: ["c"] }]));
    expect(dialog()).not.toBeNull();
    const parsed = JSON.parse(source) as { nodes: unknown[] };
    const other = JSON.stringify({ ...parsed, nodes: parsed.nodes.slice(0, 2) });
    engine.setDoc(other);
    document.querySelector<HTMLElement>('.kit-dialog [data-action="paste"]')!.click();
    await settle();
    expect(notice(host)).toBe(t("canvas.paste_code.changed"));
    expect(engine.getDoc()).toBe(other);
    expect(changes).toHaveLength(0);
    engine.destroy();
  });

  it("una lista che fa nascere 10 000 schede: il riassunto, poi un annulla solo torna a prima", async () => {
    const source = board();
    const { engine, host } = mounted(source, { seed: () => 1n });
    const ops = Array.from({ length: 10_000 }, (_, i) => ({
      op: "add_card", text: `s${i}`, x: 1000 + (i % 100) * 300, y: Math.floor(i / 100) * 200, width: 240, height: 160,
    }));
    await pasteCode(engine, JSON.stringify(ops));
    expect(dialog()?.textContent).toContain(t("canvas.paste_code.cards_added", { n: 10_000 }));
    document.querySelector<HTMLElement>('.kit-dialog [data-action="paste"]')!.click();
    await settle();
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(10_003);
    const big = engine.getDoc();
    // Oltre il limite interattivo la scena è troppo grande: niente «Incolla codice» né «Disponi».
    expect(command(engine, "canvas.paste_code").disabled()).not.toBeNull();
    expect(command(engine, "canvas.layout.grid").disabled()).not.toBeNull();
    // L'annulla la riporta, e il ripeti la rifà, oltre il limite.
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(source);
    expect(host.querySelectorAll(".canvas-node")).toHaveLength(3);
    expect(engine.redo()).toBe(true);
    expect(engine.getDoc()).toBe(big);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(source);
    expect(engine.undo()).toBe(false);
    engine.destroy();
  }, 120_000);

  it("i quattro «Disponi»: `layout` sulle schede scelte, o su tutte senza scelta; un annulla ciascuno", () => {
    const source = board();
    for (const kind of ["grid", "row", "column", "tree"] as const) {
      const { engine, host, changes } = mounted(source, { seed: () => 1n });
      // Senza scelta: tutte le schede fuori dai gruppi.
      command(engine, `canvas.layout.${kind}`).run();
      expect(engine.getDoc(), kind).toBe(compiled(source, [{ op: "layout", kind }]));
      expect(engine.undo()).toBe(true);
      expect(engine.getDoc()).toBe(source);
      // Con due schede scelte: solo loro.
      pick(host, "b");
      pick(host, "c", true);
      command(engine, `canvas.layout.${kind}`).run();
      expect(engine.getDoc(), kind).toBe(compiled(source, [{ op: "layout", ids: ["b", "c"], kind }]));
      expect(engine.getDoc()).not.toBe(source);
      expect(changes.length).toBeGreaterThanOrEqual(2);
      expect(engine.undo()).toBe(true);
      expect(engine.getDoc()).toBe(source);
      // Una scheda sola: spento, col perché.
      pick(host, "a");
      expect(command(engine, `canvas.layout.${kind}`).disabled()).toBe(t("canvas.commands.why.two"));
      engine.destroy();
    }
  });

  /** Copia la lavagna intera come codice e torna la lista. */
  async function copyAll(engine: CanvasEngine): Promise<Array<Record<string, unknown>>> {
    const written = clipboard(null);
    command(engine, "canvas.copy_code").run();
    await settle();
    return JSON.parse(written[0]!) as Array<Record<string, unknown>>;
  }

  const action = (id: string) => document.querySelector<HTMLElement>(`.kit-dialog [data-action="${id}"]`);

  it("il giro intero: copia, cambia una scheda, incolla, «Aggiorna le schede» la riscrive al suo posto, gli archi restano; un annulla", async () => {
    const source = board();
    const { engine, changes } = mounted(source, { seed: () => 1n });
    const ops = await copyAll(engine);
    const a = ops.find((op) => op.op === "add_card" && op.id === "a")!;
    if (typeof a.node === "object" && a.node !== null) (a.node as Record<string, unknown>).text = "UNO";
    else a.text = "UNO";
    await pasteCode(engine, JSON.stringify(ops));
    const said = dialog()?.textContent ?? "";
    expect(said).toContain(t("canvas.paste_code.clash", {
      list: [t("canvas.paste_code.count.cards", { n: 3 }), t("canvas.paste_code.count.edges.one")].join(", "),
    }));
    expect(said).toContain(t("canvas.paste_code.cards_updated.one"));
    // Le due scelte, e «Aggiorna» è quella proposta.
    expect(action("update")!.textContent).toBe(t("canvas.paste_code.update"));
    expect(action("copies")!.textContent).toBe(t("canvas.paste_code.copies"));
    expect(action("paste")).toBeNull();
    expect(action("update")!.dataset.kind).toBe("primary");
    expect(action("copies")!.dataset.kind).toBe("normal");
    expect(changes).toHaveLength(0);
    action("update")!.click();
    await settle();
    const after = readCanvas(engine.getDoc());
    expect(after.nodes.map((node) => node.id)).toEqual(["a", "b", "c"]);
    expect(after.nodes[0]).toMatchObject({ id: "a", text: "UNO", x: 0, y: 0 });
    expect(after.edges).toEqual(readCanvas(source).edges);
    expect(changes).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(source);
    expect(engine.undo()).toBe(false);
    engine.destroy();
  });

  it("una scheda che manca dalla lista incollata non si toglie aggiornando", async () => {
    const source = board();
    const { engine } = mounted(source, { seed: () => 1n });
    const ops = (await copyAll(engine)).filter((op) => !(op.op === "add_card" && op.id === "c"));
    await pasteCode(engine, JSON.stringify(ops));
    expect(dialog()?.textContent).toContain(t("canvas.paste_code.option_nothing"));
    // Niente cambia aggiornando: resta solo «Aggiungi come copie».
    expect(action("update")).toBeNull();
    document.querySelector<HTMLElement>('.kit-dialog [data-action="cancel"]')!.click();
    await settle();
    expect(engine.getDoc()).toBe(source);
    engine.destroy();
  });

  it("«Aggiungi come copie»: ids nuovi, e l'arco copiato collega le copie; un annulla", async () => {
    const source = board();
    const { engine } = mounted(source, { seed: () => 1n });
    const ops = await copyAll(engine);
    await pasteCode(engine, JSON.stringify(ops));
    expect(dialog()?.textContent).toContain(t("canvas.paste_code.cards_added", { n: 3 }));
    action("copies")!.click();
    await settle();
    const after = readCanvas(engine.getDoc());
    expect(after.nodes).toHaveLength(6);
    expect(after.edges).toHaveLength(2);
    const copies = after.nodes.slice(3);
    expect(copies.map((node) => node.id).some((id) => ["a", "b", "c"].includes(id))).toBe(false);
    const text = (id: string) => (after.nodes.find((node) => node.id === id) as { text?: string }).text;
    const edge = after.edges[1]!;
    expect(edge.id).not.toBe("e1");
    expect([text(edge.fromNode), text(edge.toNode)]).toEqual(["uno", "due"]);
    expect(["a", "b"]).not.toContain(edge.fromNode);
    expect(engine.selection().nodes).toEqual(copies.map((node) => node.id));
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(source);
    engine.destroy();
  });

  it("«Aggiungi come copie» mette le copie dove le mette Ctrl+V, e di nuovo nello stesso punto un passo più in là", async () => {
    const source = board();
    const { engine, host } = mounted(source, { seed: () => 1n });
    const ops = JSON.stringify(await copyAll(engine));
    viewport(host).dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: 200 }));
    // Ctrl+V delle stesse schede, per sapere dove le mette.
    const fub = copiedSelection(readCanvas(source), ["a", "b", "c"])!;
    const values: Record<string, string> = { [CANVAS_CLIPBOARD_TYPE]: clipboardJson(fub) };
    const data = { files: [], items: [], types: Object.keys(values), getData: (type: string) => values[type] ?? "" } as unknown as DataTransfer;
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    viewport(host).dispatchEvent(event);
    await settle();
    const pasted = readCanvas(engine.getDoc()).nodes.slice(3);
    expect(pasted).toHaveLength(3);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(source);

    const place = () => readCanvas(engine.getDoc()).nodes.slice(3).map((node) => [node.x, node.y]);
    await pasteCode(engine, ops);
    action("copies")!.click();
    await settle();
    const first = place();
    expect(first).toEqual(pasted.map((node) => [node.x, node.y]));
    expect(first[0]).not.toEqual([0, 0]);
    await pasteCode(engine, ops);
    action("copies")!.click();
    await settle();
    expect(readCanvas(engine.getDoc()).nodes.slice(6).map((node) => [node.x, node.y]))
      .toEqual(first.map(([x, y]) => [x! + CANVAS_PASTE_STEP, y! + CANVAS_PASTE_STEP]));
    engine.destroy();
  });

  it("un nuovo «Incolla codice» toglie l'avviso di prima appena parte", async () => {
    const { engine, host } = mounted(board(), { seed: () => 1n });
    await pasteCode(engine, "graph TD; A-->B");
    expect(notice(host)).toBe(t("canvas.paste_code.not_json"));
    await pasteCode(engine, JSON.stringify([{ op: "remove", ids: ["c"] }]));
    expect(dialog()).not.toBeNull();
    expect(notice(host)).toBe("");
    document.querySelector<HTMLElement>('.kit-dialog [data-action="cancel"]')!.click();
    await settle();
    expect(notice(host)).toBe("");
    engine.destroy();
  });

  it("un id della lavagna usato per un'altra specie: l'avviso, nessuna finestra, niente scritto", async () => {
    const source = board();
    const { engine, host, changes } = mounted(source, { seed: () => 1n });
    await pasteCode(engine, JSON.stringify([{ op: "add_card", id: "e1", text: "x" }]));
    expect(dialog()).toBeNull();
    expect(notice(host)).toBe(t("canvas.paste_code.kind", { n: "1", id: "e1", kind: t("canvas.paste_code.kind.edge") }));
    await pasteCode(engine, JSON.stringify([{ op: "add_card", text: "ok" }, { op: "add_card", id: "a", url: "https://example.org" }]));
    expect(notice(host)).toBe(t("canvas.paste_code.kind", { n: "2", id: "a", kind: t("canvas.paste_code.kind.text") }));
    expect(document.activeElement).toBe(viewport(host));
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(source);
    engine.destroy();
  });

  it("gli avvisi nella finestra si contano per specie, ognuno con la sua frase", async () => {
    const { engine } = mounted(board(), { seed: () => 1n });
    await pasteCode(engine, JSON.stringify([
      { op: "add_card", text: "sopra", x: 20, y: 20, width: 240, height: 160 },
      { op: "add_card", text: "anche", x: 420, y: 20, width: 240, height: 160 },
    ]));
    expect(dialog()?.textContent).toContain(t("canvas.paste_code.warnings", { list: t("canvas.paste_code.warn.overlap", { n: 2 }) }));
    document.querySelector<HTMLElement>('.kit-dialog [data-action="cancel"]')!.click();
    await settle();
    engine.destroy();
  });

  it("la lavagna diventata di sola lettura mentre si decide: l'avviso, niente scritto", async () => {
    const source = board();
    const { engine, host, changes } = mounted(source, { seed: () => 1n });
    await pasteCode(engine, JSON.stringify([{ op: "remove", ids: ["c"] }]));
    expect(dialog()).not.toBeNull();
    engine.setReadOnly(true);
    action("paste")!.click();
    await settle();
    expect(notice(host)).toBe(t("canvas.paste_code.locked"));
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(source);
    engine.destroy();
  });

  /** Un tratto libero lontano dalle schede, a (800, 300). */
  function inkedFar(): string {
    const parsed = JSON.parse(board(true)) as Record<string, unknown>;
    return JSON.stringify({
      ...parsed,
      "fub:ink": { v: 1, strokes: [{ ...STROKE, id: "s-free", anchor: { kind: "free" }, ink: "1 s100 cxy 80000,30000 1000,0" }] },
    });
  }

  function lassoAround(engine: CanvasEngine, host: HTMLElement, x0: number, y0: number, x1: number, y1: number): void {
    command(engine, "canvas.tool.lasso").run();
    const transform = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
    const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(transform)!;
    const cam = { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
    const points: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0 + 2]];
    const send = (type: string, [x, y]: [number, number], buttons: number): void => {
      viewport(host).dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, isPrimary: true, pointerId: 1, pointerType: "mouse",
        button: type === "pointermove" ? -1 : 0, buttons, clientX: x * cam.zoom + cam.x, clientY: y * cam.zoom + cam.y,
      }));
    };
    send("pointerdown", points[0]!, 1);
    for (const point of points.slice(1)) send("pointermove", point, 1);
    send("pointerup", points[points.length - 1]!, 0);
  }

  it("«Copia come codice» copia ciò che è scelto: un tratto libero solo, o schede col tratto libero", async () => {
    const source = inkedFar();
    const { engine, host } = mounted(source, { seed: () => 1n });
    lassoAround(engine, host, 780, 280, 830, 320);
    const written = clipboard(null);
    command(engine, "canvas.copy_code").run();
    await settle();
    const only = JSON.parse(written[0]!) as Array<Record<string, unknown>>;
    expect(only).toEqual([{ op: "add_strokes", layer: "board", strokes: [(JSON.parse(source) as { "fub:ink": { strokes: unknown[] } })["fub:ink"].strokes[0]] }]);

    lassoAround(engine, host, -20, -20, 900, 360);
    expect(engine.selection().nodes).toEqual(["a", "b"]);
    command(engine, "canvas.copy_code").run();
    await settle();
    const both = JSON.parse(written[1]!) as Array<{ op: string; id?: string; layer?: unknown }>;
    expect(both.filter((op) => op.op === "add_card").map((op) => op.id)).toEqual(["a", "b"]);
    expect(both.filter((op) => op.op === "connect")).toHaveLength(1);
    expect(both[both.length - 1]).toMatchObject({ op: "add_strokes", layer: "board" });
    engine.destroy();
  });

  it("«Copia come codice» è spento per un arco scelto senza le sue schede", () => {
    const { engine, host } = mounted(board(), { seed: () => 1n });
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(host.querySelector('.canvas-edge-hit[data-edge="e1"]'));
    engine.contextMenu({ x: 10, y: 10 });
    pointing.mockRestore();
    expect(engine.selection().edges).toEqual(["e1"]);
    expect(command(engine, "canvas.copy_code").disabled()).toBe(t("canvas.copy_code.why"));
    engine.destroy();
  });

  it("«Disponi» senza scelta conta le schede libere come il nucleo: non i gruppi, non le schede nei gruppi", () => {
    const parsed = JSON.parse(board()) as { nodes: Array<Record<string, unknown>>; edges: unknown[] };
    const group = { id: "g", type: "group", x: -40, y: 360, width: 320, height: 240, label: "G" };
    const grouped = JSON.stringify({ ...parsed, nodes: [group, ...parsed.nodes] });
    const { engine } = mounted(grouped, { seed: () => 1n });
    expect(command(engine, "canvas.layout.column").disabled()).toBeNull();
    command(engine, "canvas.layout.column").run();
    expect(engine.getDoc()).toBe(compiled(grouped, [{ op: "layout", kind: "column" }]));
    const moved = readCanvas(engine.getDoc()).nodes;
    expect(moved.find((node) => node.id === "c")).toMatchObject({ x: 0, y: 400 });
    expect(moved.find((node) => node.id === "g")).toMatchObject({ x: -40, y: 360 });
    engine.destroy();

    // Una scheda libera sola, più il gruppo con la sua: spento, col perché.
    const lonely = JSON.stringify({ ...parsed, edges: [], nodes: [group, parsed.nodes[0], parsed.nodes[2]] });
    const second = mounted(lonely, { seed: () => 1n });
    expect(command(second.engine, "canvas.layout.grid").disabled()).toBe(t("canvas.commands.why.two"));
    second.engine.destroy();
  });

  it("«Disponi» che non sposta niente lo dice, non tace", () => {
    const { engine, host, changes } = mounted(board(), { seed: () => 1n });
    command(engine, "canvas.layout.row").run();
    expect(changes).toHaveLength(1);
    command(engine, "canvas.layout.row").run();
    expect(changes).toHaveLength(1);
    expect(notice(host)).toBe(t("canvas.layout.nothing"));
    engine.destroy();
  });
});
