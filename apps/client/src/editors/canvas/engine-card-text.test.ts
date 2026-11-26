// @vitest-environment happy-dom
// Le prove di `CanvasEngine`: il testo di una scheda e la scheda in Live (T43).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CARD_PAUSE_MS, type CanvasCorePort } from "./engine";
import { applyOperation, lineFeeds } from "../core/text-operation";
import { t } from "../../i18n/strings";
import agentBoard from "../../__fixtures__/canvas-ops/agent-board.json";
import { CanvasCoreError, canvasCoreReady, openCore, openCoreNow, type CanvasCore, type CanvasIntentOp } from "./wasm/core";
import { type CanvasPreferences } from "./preferences";
import { canvasSource, cardText, mounted, openField, openLive, press, readCanvas, settle, textPort, type, withTextPort } from "./engine-test-support";

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

/** Il nucleo vero, con il conto delle chiamate che gli arrivano. */
function countingCore(): { port: CanvasCorePort; calls: string[] } {
  const calls: string[] = [];
  const wrap = (core: CanvasCore): CanvasCore => new Proxy(core, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.push(String(key));
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return {
    calls,
    port: {
      openNow: (text) => {
        calls.push("open");
        const core = openCoreNow(text);
        return core ? wrap(core) : null;
      },
      ready: canvasCoreReady,
    },
  };
}

describe("CanvasEngine: il testo di una scheda", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dieci tasti a 100 ms l'uno dall'altro: un solo commit, e nessuna chiamata al nucleo per tasto", () => {
    vi.useFakeTimers();
    const { port, calls } = countingCore();
    const { engine, host, changes } = mounted(canvasSource(), { core: port });
    const input = openField(host, "t");
    const before = calls.length;
    for (let key = 1; key <= 10; key++) {
      type(input, `${input.value}${key % 10}`);
      vi.advanceTimersByTime(100);
      expect(calls.length).toBe(before);
    }
    expect(changes).toHaveLength(0);
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);
    expect(calls.slice(before).filter((call) => call === "commit")).toHaveLength(1);
    expect(cardText(engine)).toBe("vedi [[Altra]] e #tag1234567890");
    engine.destroy();
  });

  it("due frasi con una pausa in mezzo sono due passi d'annulla", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = openField(host, "t");
    type(input, "Prima");
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    type(input, "Prima. Seconda");
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(2);
    input.blur();
    expect(engine.undo()).toBe(true);
    expect(cardText(engine)).toBe("Prima");
    expect(engine.undo()).toBe(true);
    expect(cardText(engine)).toBe("vedi [[Altra]] e #tag");
    expect(engine.redo()).toBe(true);
    expect(cardText(engine)).toBe("Prima");
    engine.destroy();
  });

  it("Esc registra e chiude (A14)", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = openField(host, "t");
    type(input, "Con Esc");
    press(input, "Escape");
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe("Con Esc");
    expect(host.querySelector(".canvas-text-editor")).toBeNull();
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);
    engine.destroy();
  });

  it("una scheda senza testo, anche mentre si scrive, dice la sua specie a parole: mai l'id interno", () => {
    vi.useFakeTimers();
    const source = JSON.stringify({
      nodes: [
        { id: "n-mszrueo0-a4o7t6-1", type: "text", x: 40, y: 40, width: 240, height: 140, text: "" },
        { id: "n-titolo", type: "text", x: 400, y: 40, width: 240, height: 140, text: "\n# Idee **nuove**\naltro" },
        { id: "n-gruppo", type: "group", x: 40, y: 240, width: 600, height: 300, label: "  " },
      ],
      edges: [{ id: "e1", fromNode: "n-mszrueo0-a4o7t6-1", toNode: "n-titolo" }],
    });
    const { engine, host } = mounted(source);
    const head = (id: string) => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"] .canvas-node-handle`)!;
    const title = (id: string) => head(id).querySelector(".canvas-node-title")!.textContent;
    const connect = (id: string) => head(id).querySelector(".canvas-connect")!.getAttribute("aria-label");
    const textKind = t("canvas_menu.header", { kind: t("canvas_menu.kind.text") });
    expect(title("n-mszrueo0-a4o7t6-1")).toBe(textKind);
    expect(connect("n-mszrueo0-a4o7t6-1")).toBe(t("canvas.connect", { card: textKind }));
    // Un testo col nome: la prima riga scritta, senza i segni del Markdown.
    expect(title("n-titolo")).toBe("Idee nuove");
    expect(connect("n-titolo")).toBe(t("canvas.connect", { card: t("canvas.a11y.titled", { kind: textKind, name: "Idee nuove" }) }));
    expect(title("n-gruppo")).toBe(t("canvas.a11y.group"));
    // Mentre si scrive, prima del commit: la testata e il campo non dicono l'id.
    const input = openField(host, "n-mszrueo0-a4o7t6-1");
    type(input, "Appunto");
    expect(input.getAttribute("aria-label")).toBe(t("canvas.edit_text", { card: textKind }));
    expect(title("n-mszrueo0-a4o7t6-1")).toBe(textKind);
    // Il nome di → segue il testo registrato.
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(title("n-mszrueo0-a4o7t6-1")).toBe("Appunto");
    expect(connect("n-mszrueo0-a4o7t6-1")).toBe(t("canvas.connect", { card: t("canvas.a11y.titled", { kind: textKind, name: "Appunto" }) }));
    input.blur();
    // Né a schermo né nei nomi per il lettore di schermo.
    const shown = host.textContent ?? "";
    for (const id of ["n-mszrueo0-a4o7t6-1", "n-titolo", "n-gruppo"]) expect(shown).not.toContain(id);
    const labels = [...host.querySelectorAll("[aria-label]")].map((el) => el.getAttribute("aria-label") ?? "");
    for (const id of ["n-mszrueo0-a4o7t6-1", "n-titolo", "n-gruppo"]) expect(labels.join("\n")).not.toContain(id);
    engine.destroy();
  });

  it("Invio in una scheda di testo va a capo e registra; Ctrl+Invio e Cmd+Invio registrano, chiudono e aprono la scheda dopo (A15, T44)", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    let input = openField(host, "t");
    type(input, "Riga");
    const enter = press(input, "Enter");
    expect(enter.defaultPrevented).toBe(false);
    type(input, "Riga\n");
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe("Riga\n");
    expect(host.querySelector(".canvas-text-editor")).toBe(input);
    type(input, "Riga\ndue");
    expect(press(input, "Enter", { ctrlKey: true }).defaultPrevented).toBe(true);
    // Il testo, poi la scheda nuova: due commit.
    expect(changes).toHaveLength(3);
    expect(cardText(engine)).toBe("Riga\ndue");
    let next = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
    expect(next).not.toBe(input);
    expect(next.closest<HTMLElement>(".canvas-node")!.dataset.node).not.toBe("t");
    next.blur();
    input = openField(host, "t");
    type(input, "Riga\ndue\ntre");
    press(input, "Enter", { metaKey: true });
    expect(cardText(engine)).toBe("Riga\ndue\ntre");
    next = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
    expect(next.closest<HTMLElement>(".canvas-node")!.dataset.node).not.toBe("t");
    engine.destroy();
  });

  it("Invio in un altro campo registra e chiude; l'uscita dal campo registra (A15)", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    let input = openField(host, "g");
    type(input, "Idee nuove");
    expect(press(input, "Enter").defaultPrevented).toBe(true);
    expect(changes).toHaveLength(1);
    expect(readCanvas(engine.getDoc()).nodes.find((node) => node.id === "g")?.label).toBe("Idee nuove");
    expect(host.querySelector(".canvas-field-editor")).toBeNull();
    input = openField(host, "t");
    type(input, "Uscendo");
    input.dispatchEvent(new FocusEvent("blur"));
    expect(changes).toHaveLength(2);
    expect(cardText(engine)).toBe("Uscendo");
    expect(host.querySelector(".canvas-text-editor")).toBeNull();
    engine.destroy();
  });

  it("col campo aperto Ctrl+Z è del campo, non della tela (A16)", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = openField(host, "t");
    type(input, "Scritto");
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    const undo = press(input, "z", { ctrlKey: true });
    expect(undo.defaultPrevented).toBe(false);
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe("Scritto");
    engine.destroy();
  });

  it("un gesto sulla tela registra prima il testo in sospeso", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = openField(host, "t");
    type(input, "Prima del gesto");
    host.querySelector<HTMLButtonElement>('[data-canvas-action="add-text"]')!.click();
    expect(changes).toHaveLength(2);
    expect(cardText(engine)).toBe("Prima del gesto");
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(5);
    expect(engine.undo()).toBe(true);
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(4);
    expect(cardText(engine)).toBe("Prima del gesto");
    engine.destroy();
  });

  it("chiudere il riquadro durante la pausa registra prima", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = openField(host, "t");
    type(input, "Prima di chiudere");
    engine.destroy();
    expect(changes).toHaveLength(1);
    expect(readCanvas(changes[0].text).nodes[0].text).toBe("Prima di chiudere");
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);
  });

  it("aprire un altro documento durante la pausa registra il testo in quello di prima", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = openField(host, "t");
    type(input, "Nel primo");
    engine.setDoc(JSON.stringify({ nodes: [], edges: [] }));
    expect(changes).toHaveLength(1);
    expect(readCanvas(changes[0].text).nodes[0].text).toBe("Nel primo");
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(0);
    expect(engine.undo()).toBe(false);
    engine.destroy();
  });

  it("un cambio da fuori mentre si scrive: il testo si registra subito dopo, sul testo nuovo", async () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = openField(host, "t");
    type(input, "Mentre scrivo");
    const remote = JSON.parse(canvasSource()) as { nodes: Array<Record<string, unknown>> };
    remote.nodes[0].x = 112;
    remote.nodes[1].x = 500;
    engine.syncDoc({ text: JSON.stringify(remote), operation: null });
    expect(changes).toHaveLength(0);
    expect(host.querySelector(".canvas-text-editor")).toBe(input);
    await Promise.resolve();
    expect(changes).toHaveLength(1);
    const after = readCanvas(engine.getDoc());
    expect(after.nodes[0]).toMatchObject({ x: 112, text: "Mentre scrivo" });
    expect(after.nodes[1].x).toBe(500);
    expect(applyOperation(JSON.stringify(remote), changes[0].operation)).toBe(engine.getDoc());
    engine.destroy();
  });

  it("se la scheda sparisce mentre si scrive torna col testo del campo, e un annulla la toglie", async () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = openField(host, "t");
    type(input, "Non lo perdo");
    const remote = JSON.parse(canvasSource()) as { nodes: Array<Record<string, unknown>>; edges: unknown[] };
    remote.nodes.shift();
    remote.edges = [];
    engine.syncDoc(JSON.stringify(remote));
    await Promise.resolve();
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe("Non lo perdo");
    input.dispatchEvent(new FocusEvent("blur"));
    expect(engine.undo()).toBe(true);
    expect(cardText(engine)).toBeUndefined();
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(3);
    engine.destroy();
  });

  it("un testo oltre 1 MiB: il campo resta aperto col suo testo e l'avviso lo dice; chiudere il riquadro lo perde", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = openField(host, "t");
    const huge = "x".repeat(2 * 1_048_576);
    type(input, huge);
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(0);
    expect(host.querySelector(".canvas-text-editor")).toBe(input);
    expect(input.value).toBe(huge);
    expect(host.querySelector(".canvas-intake-error")?.textContent).toBe(t("canvas.card_too_long"));
    press(input, "Escape");
    expect(host.querySelector(".canvas-text-editor")).toBe(input);
    expect(engine.undo()).toBe(false);
    // Il caso fissato: un incolla di 2 MiB e poi il riquadro chiuso, quel testo si perde.
    engine.destroy();
    expect(changes).toHaveLength(0);
  });

  it("durante la composizione la pausa non corre: conta dalla fine", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = openField(host, "t");
    input.dispatchEvent(new CompositionEvent("compositionstart"));
    type(input, "にほ");
    vi.advanceTimersByTime(1000);
    type(input, "日本");
    vi.advanceTimersByTime(1000);
    expect(changes).toHaveLength(0);
    input.dispatchEvent(new CompositionEvent("compositionend"));
    vi.advanceTimersByTime(CARD_PAUSE_MS - 1);
    expect(changes).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe("日本");
    engine.destroy();
  });

  it("Invio ed Esc che chiudono una composizione (WebKit: dopo compositionend, col codice 229) non chiudono il campo", () => {
    const { engine, host } = mounted();
    const input = openField(host, "t");
    input.dispatchEvent(new CompositionEvent("compositionstart"));
    type(input, "日本");
    input.dispatchEvent(new CompositionEvent("compositionend"));
    expect(press(input, "Escape", { keyCode: 229 }).defaultPrevented).toBe(false);
    expect(press(input, "Enter", { keyCode: 229, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(host.querySelector(".canvas-text-editor")).toBe(input);
    expect(press(input, "Escape").defaultPrevented).toBe(true);
    expect(host.querySelector(".canvas-text-editor")).toBeNull();
    expect(cardText(engine)).toBe("日本");
    engine.destroy();
  });

  it("con i CRLF la TextOperation conta sui \\n", () => {
    vi.useFakeTimers();
    const source = JSON.stringify(JSON.parse(canvasSource()), null, "\t").replace(/\n/g, "\r\n");
    const { engine, host, changes } = mounted(source);
    const input = openField(host, "t");
    type(input, "Con i CR");
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);
    expect(engine.getDoc()).toContain("\r\n");
    expect(applyOperation(lineFeeds(source), changes[0].operation)).toBe(lineFeeds(engine.getDoc()));
    engine.destroy();
  });

  it("due superfici sulla stessa tela: il testo dell'una arriva all'altra e il campo aperto resta", async () => {
    vi.useFakeTimers();
    const a = mounted();
    const b = mounted();
    const input = openField(a.host, "t");
    type(input, "Da A");
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(a.changes).toHaveLength(1);
    const inputB = openField(b.host, "g");
    type(inputB, "Da B");
    b.engine.syncDoc({ text: a.changes[0].text, operation: a.changes[0].operation });
    await Promise.resolve();
    expect(b.changes).toHaveLength(1);
    const both = readCanvas(b.engine.getDoc());
    expect(both.nodes.find((node) => node.id === "t")?.text).toBe("Da A");
    expect(both.nodes.find((node) => node.id === "g")?.label).toBe("Da B");
    expect(b.host.querySelector(".canvas-field-editor")).toBe(inputB);
    a.engine.destroy();
    b.engine.destroy();
  });

  it("una trappola nel nucleo: la tela si riapre su un'istanza nuova dal testo, e il testo in sospeso si registra", async () => {
    const real = countingCore();
    let trap = true;
    const port: CanvasCorePort = {
      openNow: (text) => {
        const core = real.port.openNow(text);
        if (!core) return null;
        return new Proxy(core, {
          get(target, key, receiver) {
            if (key === "commit" && trap) {
              return () => {
                trap = false;
                throw new CanvasCoreError("trap", "unreachable");
              };
            }
            return Reflect.get(target, key, receiver) as unknown;
          },
        });
      },
      ready: canvasCoreReady,
    };
    const { engine, host, changes } = mounted(canvasSource(), { core: port });
    const input = openField(host, "t");
    type(input, "Dopo la trappola");
    press(input, "Escape");
    expect(changes).toHaveLength(0);
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    expect(real.calls.filter((call) => call === "open")).toHaveLength(2);
    expect(cardText(engine)).toBe("Dopo la trappola");
    engine.destroy();
  });

  it("il cancello: la tela dell'agente si apre con le stesse schede negli stessi posti", async () => {
    const vector = agentBoard as unknown as { before: unknown; seed: number; ops: CanvasIntentOp[]; expect: { after: { nodes: Array<{ id: string; x: number; y: number; width: number; height: number }> } } };
    const before = JSON.stringify(vector.before);
    const core = await openCore(before);
    const compiled = core.compile(vector.ops, vector.seed);
    const { edit } = core.commit(compiled.patches);
    core.close();
    const text = before.slice(0, edit.start) + edit.text + before.slice(edit.end);
    const { engine, host } = mounted(text);
    const cards = [...host.querySelectorAll<HTMLElement>(".canvas-node")];
    expect(cards.map((card) => card.dataset.node)).toEqual(vector.expect.after.nodes.map((node) => node.id));
    for (const node of vector.expect.after.nodes) {
      const card = host.querySelector<HTMLElement>(`.canvas-node[data-node="${node.id}"]`)!;
      expect(card.style.transform).toBe(`translate(${node.x}px, ${node.y}px)`);
      expect(card.style.width).toBe(`${node.width}px`);
      expect(card.style.height).toBe(`${node.height}px`);
    }
    expect(host.querySelector<HTMLElement>(".canvas-viewport")!.dataset.canvasEdges).toBe("2");
    engine.destroy();
  });

  it("il testo tenuto: un avviso per tasto senza nucleo, il testo intero solo a richiesta, il commit adesso", () => {
    vi.useFakeTimers();
    const { port, calls } = countingCore();
    const seen: boolean[] = [];
    const { engine, host, changes } = mounted(canvasSource(), { core: port, onPendingChange: (pending) => seen.push(pending) });
    const input = openField(host, "t");
    expect(engine.pendingText()).toBeNull();
    const before = calls.length;
    type(input, "Ciao");
    type(input, "Ciao mondo");
    expect(seen).toEqual([true, true]);
    expect(calls.length).toBe(before);
    const whole = engine.pendingText()!;
    expect(calls.slice(before)).toEqual(["preview"]);
    expect(readCanvas(whole).nodes.find((node) => node.id === "t")!.text).toBe("Ciao mondo");
    // Il testo intero non tocca la lavagna.
    expect(cardText(engine)).toBe("vedi [[Altra]] e #tag");
    expect(changes).toHaveLength(0);
    engine.commitPending();
    expect(seen).toEqual([true, true, false]);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.text).toBe(whole);
    expect(engine.hasPending).toBe(false);
    expect(engine.pendingText()).toBeNull();
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);
    engine.destroy();
  });

  it("il testo tenuto che il nucleo non prende: niente testo intero, e il registro lo dice", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { engine, host } = mounted();
      const input = openField(host, "t");
      type(input, "x".repeat(1_048_577));
      expect(engine.pendingText()).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("invalid"));
      expect(cardText(engine)).toBe("vedi [[Altra]] e #tag");
      engine.destroy();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("CanvasEngine: la scheda di testo in Live (T43)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("il doppio clic monta l'editor delle note al posto del campo, col cursore in fondo", async () => {
    const { port, opened } = textPort();
    const { engine, host } = mounted(canvasSource(), withTextPort(port));
    await openLive(host);
    expect(opened).toHaveLength(1);
    const live = opened[0]!;
    expect(live.text).toBe("vedi [[Altra]] e #tag");
    expect(live.options.documentId).toBe("board.canvas");
    expect(live.options.readOnly).toBe(false);
    expect(host.querySelector(".canvas-text-editor")).toBeNull();
    const place = host.querySelector<HTMLElement>('.canvas-node[data-node="t"] .canvas-text-live')!;
    expect(place).not.toBeNull();
    expect(place.hidden).toBe(false);
    expect(place.contains(live.area)).toBe(true);
    expect(document.activeElement).toBe(live.area);
    expect(live.focusAt).toEqual(["vedi [[Altra]] e #tag".length]);
    // L'editor che porta il cursore in vista non sposta la lavagna: la vista
    // si muove solo con la camera.
    const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
    viewport.scrollTop = 280;
    viewport.dispatchEvent(new Event("scroll"));
    expect(viewport.scrollTop).toBe(0);
    // Né sposta il contenitore della scheda: scorre l'editor, e ciò che
    // l'editor tiene sotto di sé resta fuori dalla vista.
    expect(place.style.overflow).toBe("hidden");
    place.scrollTop = 72;
    place.dispatchEvent(new Event("scroll"));
    expect(place.scrollTop).toBe(0);
    engine.destroy();
    expect(live.destroyed).toBe(true);
  });

  it("il doppio clic su una scheda di testo mette il cursore dove si è cliccato, non in fondo (IMP-3808)", async () => {
    // Sul testo: il cursore va lì, e il fuoco non lo riporta in fondo.
    const onText = textPort("live", undefined, () => true);
    const first = mounted(canvasSource(), withTextPort(onText.port));
    first.host.querySelector<HTMLElement>('.canvas-node[data-node="t"]')!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 140, clientY: 90 }));
    await settle();
    const live = onText.opened[0]!;
    expect(live.pointsAt).toEqual([{ x: 140, y: 90 }]);
    expect(live.focusAt).toEqual([]);
    expect(document.activeElement).toBe(live.area);
    first.engine.destroy();
    // Fuori dal testo (la testata della scheda): il cursore in fondo, come prima.
    const offText = textPort("live", undefined, () => false);
    const second = mounted(canvasSource(), withTextPort(offText.port));
    second.host.querySelector<HTMLElement>('.canvas-node[data-node="t"]')!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 140, clientY: 4 }));
    await settle();
    expect(offText.opened[0]!.pointsAt).toEqual([{ x: 140, y: 4 }]);
    expect(offText.opened[0]!.focusAt).toEqual(["vedi [[Altra]] e #tag".length]);
    second.engine.destroy();
  });

  it("il testo arriva al .canvas dopo la pausa, con un commit solo; prima è nella bozza", async () => {
    const { port, opened } = textPort();
    const { engine, host, changes } = mounted(canvasSource(), withTextPort(port));
    await openLive(host);
    vi.useFakeTimers();
    const live = opened[0]!;
    live.typed("vedi [[Altra]] e #tag, poi");
    vi.advanceTimersByTime(100);
    live.typed("vedi [[Altra]] e #tag, poi altro");
    expect(changes).toHaveLength(0);
    expect(engine.hasPending).toBe(true);
    expect(readCanvas(engine.pendingText()!).nodes[0]!.text).toBe("vedi [[Altra]] e #tag, poi altro");
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe("vedi [[Altra]] e #tag, poi altro");
    expect(live.destroyed).toBe(false);
    // La stessa lavagna in un altro riquadro: il testo le arriva col commit.
    const other = mounted();
    other.engine.syncDoc({ text: changes[0]!.text, operation: changes[0]!.operation });
    expect(cardText(other.engine)).toBe("vedi [[Altra]] e #tag, poi altro");
    other.engine.destroy();
    engine.destroy();
  });

  it("Esc e Ctrl+Invio registrano e chiudono (A14, A15); un Esc che chiude i suggerimenti resta dell'editor", async () => {
    const { port, opened } = textPort();
    const { engine, host, changes } = mounted(canvasSource(), withTextPort(port));
    await openLive(host);
    vi.useFakeTimers();
    let live = opened[0]!;
    // L'editor delle note segna Esc come usato anche senza suggerimenti: esce lo stesso.
    live.area.addEventListener("keydown", (event) => event.preventDefault());
    live.typed("Con Esc");
    press(live.area, "Escape");
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe("Con Esc");
    expect(live.destroyed).toBe(true);
    expect(host.querySelector(".canvas-text-live")).toBeNull();
    expect(document.activeElement).toBe(host.querySelector(".canvas-viewport"));
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);

    vi.useRealTimers();
    await openLive(host);
    vi.useFakeTimers();
    live = opened[1]!;
    const seen: string[] = [];
    // L'elenco dei suggerimenti aperto: Esc lo chiude, e la scrittura resta.
    const suggestions = document.createElement("ul");
    suggestions.setAttribute("role", "listbox");
    live.area.append(suggestions);
    live.area.addEventListener("keydown", (event) => {
      seen.push(event.key);
      if (event.key === "Escape") suggestions.remove();
    });
    live.typed("Con Ctrl+Invio");
    press(live.area, "Escape");
    expect(live.destroyed).toBe(false);
    expect(changes).toHaveLength(1);
    const enter = press(live.area, "Enter", { ctrlKey: true });
    expect(enter.defaultPrevented).toBe(true);
    // Il Ctrl+Invio non arriva all'editor: non diventa un a capo.
    expect(seen).toEqual(["Escape"]);
    // Il testo, poi la scheda nuova sotto, già in scrittura (T44).
    expect(changes).toHaveLength(3);
    expect(cardText(engine)).toBe("Con Ctrl+Invio");
    expect(live.destroyed).toBe(true);
    expect(opened).toHaveLength(3);
    expect(opened[2]!.text).toBe("");

    vi.useRealTimers();
    await openLive(host);
    live = opened[opened.length - 1]!;
    live.typed("Con Cmd+Invio");
    press(live.area, "Enter", { metaKey: true });
    expect(cardText(engine)).toBe("Con Cmd+Invio");
    expect(opened[opened.length - 1]!.text).toBe("");
    engine.destroy();
  });

  it("Invio va a capo nell'editor e registra subito", async () => {
    const { port, opened } = textPort();
    const { engine, host, changes } = mounted(canvasSource(), withTextPort(port));
    await openLive(host);
    vi.useFakeTimers();
    const live = opened[0]!;
    live.typed("Riga");
    expect(press(live.area, "Enter").defaultPrevented).toBe(false);
    live.typed("Riga\n");
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe("Riga\n");
    expect(live.destroyed).toBe(false);
    engine.destroy();
  });

  it("il fuoco che esce dall'editor registra e chiude; dentro l'editor no", async () => {
    const { port, opened } = textPort();
    const { engine, host, changes } = mounted(canvasSource(), withTextPort(port));
    await openLive(host);
    vi.useFakeTimers();
    const live = opened[0]!;
    const inner = document.createElement("span");
    live.area.append(inner);
    live.typed("Uscendo");
    live.area.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: inner }));
    expect(live.destroyed).toBe(false);
    live.area.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe("Uscendo");
    expect(live.destroyed).toBe(true);
    engine.destroy();
  });

  it("un testo non toccato non cambia un byte, anche se non è Markdown valido e va a capo con CRLF", async () => {
    const odd = "**non chiuso\r\n<div>\r\n[[\r\n `";
    const source = `{\r\n  "nodes": [\r\n    {"id":"t","type":"text","x":0,"y":0,"width":240,"height":140,"text":${JSON.stringify(odd)}}\r\n  ],\r\n  "edges": []\r\n}\r\n`;
    const { port, opened } = textPort();
    const { engine, host, changes } = mounted(source, withTextPort(port));
    await openLive(host);
    expect(opened[0]!.text).toBe(odd);
    press(opened[0]!.area, "Escape");
    await openLive(host);
    opened[1]!.area.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(source);
    // Toccato, il testo resta col suo CRLF.
    await openLive(host);
    opened[2]!.typed(`${odd}\r\naltro`);
    press(opened[2]!.area, "Escape");
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe(`${odd}\r\naltro`);
    expect(engine.getDoc()).toContain("\r\n  \"edges\"");
    engine.destroy();
  });

  it("una scheda di 2000 righe si apre intera e si registra", async () => {
    const long = Array.from({ length: 2000 }, (_, line) => `riga ${line + 1}`).join("\n");
    const source = JSON.stringify({ nodes: [{ id: "t", type: "text", x: 0, y: 0, width: 240, height: 140, text: long }], edges: [] });
    const { port, opened } = textPort();
    const { engine, host, changes } = mounted(source, withTextPort(port));
    await openLive(host);
    vi.useFakeTimers();
    expect(opened[0]!.text).toBe(long);
    // La rotella sopra il testo lo scorre: la lavagna non la prende.
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 });
    opened[0]!.area.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    opened[0]!.typed(`${long}\nriga 2001`);
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);
    expect(cardText(engine)!.split("\n")).toHaveLength(2001);
    engine.destroy();
  });

  it("Ctrl+Z nell'editor è suo: la tela non lo vede", async () => {
    const { port, opened } = textPort();
    const { engine, host, changes } = mounted(canvasSource(), withTextPort(port));
    await openLive(host);
    vi.useFakeTimers();
    const live = opened[0]!;
    live.typed("Scritto");
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    const reached: string[] = [];
    host.addEventListener("keydown", (event) => reached.push(event.key));
    const undo = press(live.area, "z", { ctrlKey: true });
    expect(undo.defaultPrevented).toBe(false);
    expect(reached).toEqual([]);
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe("Scritto");
    expect(live.destroyed).toBe(false);
    engine.destroy();
  });

  it("un annulla della lavagna mentre si scrive prima esce dalla scrittura", async () => {
    const { port, opened } = textPort();
    const { engine, host } = mounted(canvasSource(), withTextPort(port));
    await openLive(host);
    vi.useFakeTimers();
    const live = opened[0]!;
    live.typed("Da annullare");
    expect(engine.undo()).toBe(true);
    expect(live.destroyed).toBe(true);
    expect(host.querySelector(".canvas-text-live")).toBeNull();
    expect(cardText(engine)).toBe("vedi [[Altra]] e #tag");
    engine.destroy();
  });

  it("la lavagna chiusa a metà pausa registra il testo e smonta l'editor", async () => {
    const { port, opened } = textPort();
    const { engine, host, changes } = mounted(canvasSource(), withTextPort(port));
    await openLive(host);
    vi.useFakeTimers();
    const live = opened[0]!;
    live.typed("Prima di chiudere");
    engine.destroy();
    expect(changes).toHaveLength(1);
    expect(readCanvas(changes[0]!.text).nodes[0]!.text).toBe("Prima di chiudere");
    expect(live.destroyed).toBe(true);
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);
  });

  it("in sola lettura non si entra", async () => {
    const { port, calls } = textPort();
    const { engine, host } = mounted(canvasSource(), withTextPort(port));
    engine.setReadOnly(true);
    await openLive(host);
    expect(calls).toEqual([]);
    expect(host.querySelector(".canvas-text-editor, .canvas-text-live")).toBeNull();
    engine.destroy();
  });

  it("se l'editor non si monta resta il campo di oggi, e si scrive lì", async () => {
    const { port, calls } = textPort("none");
    const { engine, host, changes } = mounted(canvasSource(), withTextPort(port));
    await openLive(host);
    vi.useFakeTimers();
    expect(calls).toHaveLength(1);
    expect(host.querySelector(".canvas-text-live")).toBeNull();
    const input = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
    expect(input).not.toBeNull();
    type(input, "Nel campo");
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe("Nel campo");
    engine.destroy();
  });

  it("ciò che si scrive nel campo mentre l'editor arriva non si perde: l'editor si riapre su quel testo", async () => {
    let open = (): void => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const { port, opened, calls } = textPort("live", gate);
    const { engine, host, changes } = mounted(canvasSource(), withTextPort(port));
    await openLive(host);
    const input = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
    type(input, "Veloce");
    input.setSelectionRange(3, 3);
    open();
    await settle();
    expect(calls).toEqual(["vedi [[Altra]] e #tag", "Veloce"]);
    expect(opened).toHaveLength(2);
    expect(opened[0]!.destroyed).toBe(true);
    expect(opened[1]!.destroyed).toBe(false);
    expect(host.querySelector(".canvas-text-editor")).toBeNull();
    expect(opened[1]!.focusAt).toEqual([3]);
    // Il testo del campo è già in attesa: nessuna battuta si perde.
    expect(engine.hasPending).toBe(true);
    engine.destroy();
    expect(changes).toHaveLength(1);
    expect(readCanvas(changes[0]!.text).nodes[0]!.text).toBe("Veloce");
  });
});
