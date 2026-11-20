// @vitest-environment happy-dom
//
// Il pannello del documento: le schede che la superficie porta
// nell'ispettore. Qui le monta un ispettore finto, come fa la shell.
import { afterEach, describe, expect, it, vi } from "vitest";
import { activeMotions, createManualDriver, setMotionDriver } from "../../moto";
import { t } from "../../i18n/strings";
import { RichEngine } from "./engine";
import { parseProjection, type Block, type CommentView } from "./projection";
import { mountRichSide, RICH_SIDE_VIEWS, type RichSide } from "./side";
import { lineFeeds, tryApplyOperation, type EditorChange } from "../core/text-operation";
import { DocumentSessionCollection, type DocumentSessionApi } from "../../state/document-session";
import type { DocumentSource, WriteBase } from "../../host/contract";
import { mountKeyboard } from "../../ui/keyboard";
import { revisions } from "./review";
import { openLifetime, type Lifetime } from "../../ui/lifetime";

let engines: RichEngine[] = [];
let sides: RichSide[] = [];
let lifetimes: Lifetime[] = [];
afterEach(() => {
  for (const life of lifetimes) life.close();
  lifetimes = [];
  for (const side of sides) side.destroy();
  for (const engine of engines) engine.destroy();
  sides = [];
  engines = [];
  document.body.replaceChildren();
  setMotionDriver(null);
  vi.restoreAllMocks();
});

const AT = "2026-10-18T13:00:00Z";
const para = (c: unknown[]): Block => ({ t: "para", role: { kind: "body" }, c }) as Block;
const marker = (id: number, end: boolean) => ({ t: "atom", kind: "marker", comment: end ? { id, end: true } : { id } });
const kept: CommentView = { id: 7, by: "Redazione", at: AT, text: "Da rivedere." };

function engine(blocks: readonly Block[], comments: readonly CommentView[] = [], readonly = false): RichEngine {
  const parent = document.createElement("div");
  document.body.append(parent);
  const made = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  made.setDoc(JSON.stringify({ format: "fub-rich", version: 1, ...(readonly ? { readonly: "protected" } : {}), ...(comments.length > 0 ? { comments } : {}), blocks }));
  engines.push(made);
  return made;
}

/// Il pannello con un ispettore che monta la scheda chiesta. L'ispettore è
/// legato al documento come nella shell: col fuoco su un suo pulsante,
/// Ctrl+Z va alla storia del documento (`ui/off-sheet-keys.ts`).
function side(e: RichEngine, review = true) {
  const host = document.createElement("div");
  document.body.append(host);
  const keys = openLifetime();
  lifetimes.push(keys);
  mountKeyboard(keys, () => {}, { owns: (target) => host.contains(target), history: (step) => e.history(step) });
  const unmounts = new Map<string, () => void>();
  const made = mountRichSide(e, { review }, (viewId) => {
    if (unmounts.has(viewId)) return;
    unmounts.set(viewId, made.panels.find((panel) => panel.id === viewId)!.mount(host));
  });
  sides.push(made);
  return {
    side: made,
    host,
    unmount: (viewId: string) => {
      unmounts.get(viewId)?.();
      unmounts.delete(viewId);
    },
  };
}

const at = (e: RichEngine, needle: string): number => {
  let found = -1;
  e.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(needle)) found = pos + node.text!.indexOf(needle);
    return found < 0;
  });
  return found;
};
const listed = (e: RichEngine) => parseProjection(e.getDoc()).comments ?? [];
const field = (host: HTMLElement, label: string) =>
  document.getElementById([...host.querySelectorAll("label")].find((l) => l.textContent === label)!.htmlFor) as HTMLInputElement;
const pressed = (host: HTMLElement, label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label)!;

describe("la scheda Commenti", () => {
  it("elenca i fili, ne aggiunge uno sulla selezione, risponde e risolve", () => {
    const e = engine([para([{ t: "text", x: "il " }, marker(7, false), { t: "text", x: "passo" }, marker(7, true), { t: "text", x: " e altro" }])], [kept]);
    const { side: panel, host } = side(e);
    expect(panel.panels.map((p) => p.id)).toContain(RICH_SIDE_VIEWS.comments);
    const from = at(e, "altro");
    e.select(from, from + "altro".length);
    // «Nuovo commento» (il tasto) apre la scheda sul commento da scrivere.
    expect(e.run("rich.comment")).toBe(false);
    expect(panel.show("comments", "compose")).toBe(true);
    const text = field(host, t("rich.comment.text"));
    expect(document.activeElement).toBe(text);
    expect(host.querySelector(".rich-side-quote")?.textContent).toBe("passo");
    text.value = "Da togliere.";
    const author = field(host, t("rich.comment.author"));
    author.value = "Bea";
    author.dispatchEvent(new Event("input"));
    text.form!.requestSubmit();
    expect(listed(e).map((c) => [c.id, c.by, c.text])).toEqual([
      [7, "Redazione", "Da rivedere."],
      [8, "Bea", "Da togliere."],
    ]);
    // Nell'ordine del testo: «passo» viene prima di «altro».
    expect([...host.querySelectorAll(".rich-side-quote")].map((q) => q.textContent)).toEqual(["passo", "altro"]);
    // Un clic sul testo commentato lo seleziona.
    host.querySelector<HTMLButtonElement>(".rich-side-quote")!.click();
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe("passo");
    // Rispondi, poi Risolvi del primo filo.
    const first = host.querySelector<HTMLElement>('[data-comment="7"]')!;
    pressed(first, t("rich.comment.reply")).click();
    const answer = first.querySelector<HTMLTextAreaElement>(".rich-side-answer textarea")!;
    expect(document.activeElement).toBe(answer);
    answer.value = "Fatto.";
    answer.form!.requestSubmit();
    expect(listed(e).find((c) => c.parent === 7)?.text).toBe("Fatto.");
    expect(host.querySelector('[data-comment="7"] .rich-side-reply')?.textContent).toContain("Fatto.");
    pressed(host.querySelector<HTMLElement>('[data-comment="7"]')!, t("rich.comment.resolve")).click();
    expect(listed(e).filter((c) => c.done).map((c) => c.id)).toEqual([7, 9]);
  });

  it("una risposta che si sta scrivendo resta mentre il documento cambia altrove", () => {
    const e = engine([para([marker(7, false), { t: "text", x: "passo" }, marker(7, true), { t: "text", x: " e altro" }])], [kept]);
    const { side: panel, host } = side(e);
    panel.show("comments");
    const item = host.querySelector<HTMLElement>('[data-comment="7"]')!;
    pressed(item, t("rich.comment.reply")).click();
    item.querySelector<HTMLTextAreaElement>("textarea")!.value = "a metà";
    e.select(at(e, "altro") + 5);
    e.run("text.newline");
    expect(host.querySelector('[data-comment="7"]')).toBe(item);
    expect(item.querySelector("textarea")!.value).toBe("a metà");
  });

  it("in sola lettura si leggono e basta", () => {
    const e = engine([para([marker(7, false), { t: "text", x: "passo" }, marker(7, true)])], [kept], true);
    const { side: panel, host } = side(e);
    panel.show("comments");
    expect(host.querySelector(".rich-side-text")?.textContent).toBe("Da rivedere.");
    expect(host.querySelector<HTMLElement>(".rich-side-compose")!.hidden).toBe(true);
    expect([...host.querySelectorAll("button")].map((b) => b.className)).toEqual(["rich-side-quote"]);
  });

  it("in un formato che non li scrive non se ne aggiungono, e lo dice", () => {
    const e = engine([para([{ t: "text", x: "una parola" }])]);
    const { side: panel, host } = side(e, false);
    panel.show("comments", "compose");
    expect(host.textContent).toContain(t("rich.comment.unsupported"));
    expect(host.querySelector<HTMLElement>(".rich-side-compose")!.hidden).toBe(true);
    expect(host.textContent).toContain(t("rich.comment.none"));
  });

  it("smontata, la scheda non segue più il documento e non lascia nodi", () => {
    const e = engine([para([marker(7, false), { t: "text", x: "passo" }, marker(7, true)])], [kept]);
    const { side: panel, host, unmount } = side(e);
    for (let round = 0; round < 3; round += 1) {
      panel.show("comments");
      expect(host.querySelectorAll(".rich-side")).toHaveLength(1);
      unmount(RICH_SIDE_VIEWS.comments);
      expect(host.childElementCount).toBe(0);
    }
    e.select(1, 3);
    e.apply((state, dispatch) => {
      dispatch?.(state.tr.insertText("x"));
      return true;
    });
    expect(host.childElementCount).toBe(0);
  });
});

describe("la scheda Revisioni", () => {
  const ada = { by: "Ada", at: AT };
  const bea = { by: "Bea", at: AT };
  const tracked = () => [para([{ t: "text", x: "resta " }, { t: "text", x: "nuovo", ins: ada }, { t: "text", x: " e " }, { t: "text", x: "vecchio", del: bea }])];

  it("elenca le modifiche nell'ordine del testo, le raggiunge, le accetta una alla volta e tutte", () => {
    const e = engine(tracked());
    const { side: panel, host } = side(e);
    expect(panel.panels.map((p) => p.id)).toEqual([RICH_SIDE_VIEWS.comments, RICH_SIDE_VIEWS.revisions, RICH_SIDE_VIEWS.properties]);
    panel.show("revisions");
    const items = () => [...host.querySelectorAll<HTMLElement>(".rich-side-change")];
    expect(items().map((el) => [el.dataset.kind, el.querySelector(".rich-side-quote")?.textContent])).toEqual([
      ["ins", "nuovo"],
      ["del", "vecchio"],
    ]);
    expect(items()[1]!.querySelector(".rich-side-head")?.textContent).toContain("Bea");
    // Il pallino ha il colore dell'autore, nell'ordine in cui compare.
    const dotOf = (el: HTMLElement) => el.querySelector(".rich-side-dot")!.classList;
    expect(dotOf(items()[0]!).contains("rich-autore-1")).toBe(true);
    expect(dotOf(items()[1]!).contains("rich-autore-2")).toBe(true);
    // Un clic sul testo lo seleziona nel documento.
    items()[1]!.querySelector<HTMLButtonElement>(".rich-side-quote")!.click();
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe("vecchio");
    // Accettare l'inserimento lo tiene, e la sua voce se ne va; l'altra resta
    // la stessa voce, anche se il testo prima di lei è cambiato.
    const second = items()[1];
    pressed(items()[0]!, t("rich.rev.accept.one")).click();
    expect(items()).toEqual([second]);
    // Tolta Ada, Bea è la prima: la sua voce resta e cambia colore.
    expect(dotOf(second!).contains("rich-autore-1")).toBe(true);
    expect(e.state.doc.textContent).toBe("resta nuovo e vecchio");
    pressed(host, t("rich.rev.reject_all.short")).click();
    expect(e.state.doc.textContent).toBe("resta nuovo e vecchio");
    expect(items()).toHaveLength(0);
    expect(host.textContent).toContain(t("rich.rev.none"));
    expect(pressed(host, t("rich.rev.accept_all.short")).hidden).toBe(true);
  });

  it("dopo Accetta, Ctrl+Z col fuoco sul pulsante annulla nel documento; nel campo del nome resta del campo (IMP-120)", () => {
    const e = engine(tracked());
    const { side: panel, host, unmount } = side(e);
    panel.show("revisions");
    const items = () => [...host.querySelectorAll<HTMLElement>(".rich-side-change")];
    const accept = pressed(items()[0]!, t("rich.rev.accept.one"));
    accept.focus();
    accept.click();
    expect(items()).toHaveLength(1);
    const key = (target: HTMLElement, init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ctrlKey: true, ...init });
      target.dispatchEvent(event);
      return event;
    };
    // Il pulsante è uscito con la sua voce: il tasto arriva da dove sta il
    // fuoco adesso, dentro la scheda.
    const all = pressed(host, t("rich.rev.accept_all.short"));
    expect(key(all, { key: "z" }).defaultPrevented).toBe(true);
    expect(items().map((el) => el.dataset.kind)).toEqual(["ins", "del"]);
    key(all, { key: "Z", shiftKey: true });
    expect(items().map((el) => el.dataset.kind)).toEqual(["del"]);
    // Nel campo di chi firma il tasto è del campo.
    const name = field(host, t("rich.comment.author"));
    expect(key(name, { key: "z" }).defaultPrevented).toBe(false);
    expect(items().map((el) => el.dataset.kind)).toEqual(["del"]);
    // Smontata la scheda, l'ispettore resta legato al documento: da lì
    // Ctrl+Z annulla ancora, senza un ascoltatore della scheda.
    unmount(RICH_SIDE_VIEWS.revisions);
    expect(items()).toHaveLength(0);
    expect(key(host, { key: "z" }).defaultPrevented).toBe(true);
    expect(revisions(e.state.doc).map((change) => change.kind)).toEqual(["ins", "del"]);
  });

  it("dopo Rifiuta e Rifiuta tutte il fuoco resta nella scheda, e Ctrl+Z da lì li annulla (IMP-126)", () => {
    const e = engine([para([{ t: "text", x: "resta " }, { t: "text", x: "nuovo", ins: ada }, { t: "text", x: " e " }, { t: "text", x: "vecchio", del: bea }, { t: "text", x: " e " }, { t: "text", x: "altro", ins: bea }])]);
    const { side: panel, host } = side(e);
    panel.show("revisions");
    const items = () => [...host.querySelectorAll<HTMLElement>(".rich-side-change")];
    const kinds = () => items().map((el) => el.dataset.kind);
    // Il tasto parte da dove sta il fuoco, come nell'app.
    const press = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ctrlKey: true, ...init });
      (document.activeElement ?? document.body).dispatchEvent(event);
      return event.defaultPrevented;
    };
    const undo = () => press({ key: "z" });
    // Rifiutata la prima voce, il fuoco va al «Rifiuta» della voce che ora
    // sta al suo posto: non su BODY.
    const reject = pressed(items()[0]!, t("rich.rev.reject.one"));
    reject.focus();
    reject.click();
    expect(e.state.doc.textContent).toBe("resta  e vecchio e altro");
    expect(kinds()).toEqual(["del", "ins"]);
    expect(document.activeElement).toBe(pressed(items()[0]!, t("rich.rev.reject.one")));
    expect(undo()).toBe(true);
    expect(e.state.doc.textContent).toBe("resta nuovo e vecchio e altro");
    expect(kinds()).toEqual(["ins", "del", "ins"]);
    // La voce che torna sposta l'altra nell'elenco: il fuoco resta sul suo
    // pulsante, e da lì si ripete e si annulla ancora.
    expect(host.contains(document.activeElement)).toBe(true);
    expect(press({ key: "Z", shiftKey: true })).toBe(true);
    expect(kinds()).toEqual(["del", "ins"]);
    expect(host.contains(document.activeElement)).toBe(true);
    expect(undo()).toBe(true);
    expect(kinds()).toEqual(["ins", "del", "ins"]);
    // L'ultima voce: il fuoco passa a quella prima di lei.
    const last = pressed(items()[2]!, t("rich.rev.reject.one"));
    last.focus();
    last.click();
    expect(kinds()).toEqual(["ins", "del"]);
    expect(document.activeElement).toBe(pressed(items()[1]!, t("rich.rev.reject.one")));
    expect(undo()).toBe(true);
    expect(kinds()).toEqual(["ins", "del", "ins"]);
    // «Rifiuta tutte» si nasconde col gesto: il fuoco va all'interruttore.
    const all = pressed(host, t("rich.rev.reject_all.short"));
    all.focus();
    all.click();
    expect(items()).toHaveLength(0);
    expect(e.state.doc.textContent).toBe("resta  e vecchio e ");
    expect(all.hidden).toBe(true);
    expect(document.activeElement).toBe(host.querySelector('[role="switch"]'));
    expect(undo()).toBe(true);
    expect(e.state.doc.textContent).toBe("resta nuovo e vecchio e altro");
    expect(kinds()).toEqual(["ins", "del", "ins"]);
  });

  it("l'ultima voce rifiutata senza interruttore lascia il fuoco sull'elenco (IMP-126)", () => {
    const e = engine([para([{ t: "text", x: "resta " }, { t: "text", x: "nuovo", ins: ada }])]);
    const { side: panel, host } = side(e, false);
    panel.show("revisions");
    const toggle = host.querySelector<HTMLInputElement>('[role="switch"]')!;
    expect(toggle.disabled).toBe(true);
    const reject = pressed(host.querySelector(".rich-side-change")!, t("rich.rev.reject.one"));
    reject.focus();
    reject.click();
    expect(host.querySelectorAll(".rich-side-change")).toHaveLength(0);
    expect(document.activeElement).toBe(host.querySelector('.rich-side-list[role="list"]'));
  });

  it("un gesto del pannello col fuoco altrove non lo sposta", () => {
    const e = engine(tracked());
    const { side: panel, host } = side(e);
    panel.show("revisions");
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    pressed(host.querySelector(".rich-side-change")!, t("rich.rev.reject.one")).click();
    expect(document.activeElement).toBe(outside);
  });

  it("Rifiuta e Rifiuta tutte dal pannello portano alla sessione un'operazione che regge sul testo di prima (IMP-127)", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const changes: EditorChange[] = [];
    const e = new RichEngine(parent, { label: () => "documento", onChange: (change) => changes.push(change), onSelectionChange: () => {} });
    engines.push(e);
    e.setDoc(JSON.stringify({ format: "fub-rich", version: 1, track: true, blocks: tracked() }));
    const { side: panel, host } = side(e);
    panel.show("revisions");
    // La sessione accetta una modifica soltanto se l'operazione, applicata al
    // testo che ha, dà il testo nuovo (`acceptSurfaceChange`): altrimenti la
    // respinge e non salva.
    let text = e.getDoc();
    const accepted = () => {
      const change = changes.shift()!;
      expect(changes).toHaveLength(0);
      const applied = tryApplyOperation(lineFeeds(text), change.operation);
      expect(applied).toEqual({ kind: "applied", text: lineFeeds(change.text) });
      expect(change.origin).toBe("input");
      text = change.text;
    };
    pressed(host.querySelector(".rich-side-change")!, t("rich.rev.reject.one")).click();
    accepted();
    expect(text).toBe(e.getDoc());
    pressed(host, t("rich.rev.reject_all.short")).click();
    accepted();
    expect(parseProjection(text).track).toBe(true);
    expect(e.state.doc.textContent).toBe("resta  e vecchio");
  });

  it("accettando, la voce esce come immagine entro 140 ms e l'altra sale; una battuta non muove niente", async () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    // happy-dom non impagina: ogni voce ha un posto suo, sotto la precedente.
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(() => [new DOMRect(0, 0, 200, 40)] as unknown as DOMRectList);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const index = this.parentElement ? [...this.parentElement.children].indexOf(this) : 0;
      return new DOMRect(0, 40 * index, 200, 40);
    });
    const e = engine(tracked());
    const { side: panel, host } = side(e);
    panel.show("revisions");
    const items = () => [...host.querySelectorAll<HTMLElement>(".rich-side-change")];
    const second = items()[1]!;
    // Una battuta nel documento rifà l'elenco senza muoverlo.
    e.select(1);
    e.run("text.newline");
    expect(driver.plays).toHaveLength(0);
    pressed(items()[0]!, t("rich.rev.accept.one")).click();
    expect(items()).toEqual([second]);
    const exits = driver.plays.filter((play) => !play.el.isConnected || !host.contains(play.el));
    expect(exits.length).toBeGreaterThan(0);
    for (const exit of exits) expect((exit.timing.delay ?? 0) + Number(exit.timing.duration)).toBeLessThanOrEqual(140);
    // Quella che resta sale di una riga, dal posto che aveva.
    const rise = driver.plays.find((play) => play.el === second);
    expect(rise?.keyframes[0]?.transform).toContain("40");
    driver.advance(1000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(activeMotions()).toBe(0);
    expect(document.body.querySelectorAll(".rich-side-change")).toHaveLength(1);
  });

  it("in sola lettura si leggono e basta, e l'interruttore è spento", () => {
    const e = engine(tracked(), [], true);
    const { side: panel, host } = side(e);
    panel.show("revisions");
    expect(host.querySelectorAll(".rich-side-change")).toHaveLength(2);
    expect(host.querySelector<HTMLInputElement>('[role="switch"]')!.disabled).toBe(true);
    expect([...host.querySelectorAll<HTMLButtonElement>(".rich-side-change button")].map((b) => b.className)).toEqual(["rich-side-quote", "rich-side-quote"]);
  });

  it("smontata non lascia nodi, e una modifica dopo non la ridisegna", () => {
    const e = engine(tracked());
    const { side: panel, host, unmount } = side(e);
    for (let round = 0; round < 3; round += 1) {
      panel.show("revisions");
      expect(host.querySelectorAll(".rich-side-revisions")).toHaveLength(1);
      unmount(RICH_SIDE_VIEWS.revisions);
      expect(host.childElementCount).toBe(0);
    }
    e.select(1);
    e.run("text.newline");
    expect(host.childElementCount).toBe(0);
  });
});

describe("la scheda Proprietà", () => {
  it("dice formato e lingua del file, e «Conteggio» della barra va al conteggio", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const e = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
    e.setDoc(JSON.stringify({ format: "fub-rich", version: 1, lang: "it-IT", blocks: [para([{ t: "text", x: "due parole" }])] }));
    engines.push(e);
    const host = document.createElement("div");
    document.body.append(host);
    const made = mountRichSide(e, { format: "docx" }, () => {
      if (host.childElementCount === 0) made.panels.find((panel) => panel.id === RICH_SIDE_VIEWS.properties)!.mount(host);
    });
    sides.push(made);
    expect(made.show("properties", "count")).toBe(true);
    const facts = [...host.querySelectorAll(".rich-side-facts dd")].map((dd) => dd.textContent);
    expect(facts[0]).toBe(t("rich.prop.format.docx"));
    expect(facts[1]).not.toBe(t("rich.prop.language.none"));
    expect(document.activeElement?.querySelector(".rich-strip-count")).not.toBeNull();
  });

  it("senza lingua nel file lo dice, e smontata non lascia nodi", () => {
    const e = engine([para([{ t: "text", x: "testo" }])]);
    const { side: panel, host, unmount } = side(e);
    for (let round = 0; round < 3; round += 1) {
      panel.show("properties");
      expect(host.querySelectorAll(".rich-side-properties")).toHaveLength(1);
      expect(host.textContent).toContain(t("rich.prop.language.none"));
      unmount(RICH_SIDE_VIEWS.properties);
      expect(host.childElementCount).toBe(0);
    }
    e.select(1);
    e.run("text.newline");
    expect(host.childElementCount).toBe(0);
  });
});

describe("i gesti della scheda Revisioni arrivano al disco come una battuta (IMP-127)", () => {
  const DOC = "rev.docx";
  const ada = { by: "Ada", at: AT };
  const bea = { by: "Bea", at: AT };
  const tracked = (track: boolean) => JSON.stringify({ format: "fub-rich", version: 1, track, blocks: [
    para([{ t: "text", x: "resta " }, { t: "text", x: "nuovo", ins: ada }, { t: "text", x: " e " }, { t: "text", x: "vecchio", del: bea }, { t: "text", x: " e " }, { t: "text", x: "altro", ins: bea }]),
  ] });

  afterEach(() => {
    vi.useRealTimers();
  });

  /// Il documento aperto come nella shell: la sessione unica, il motore che
  /// le porta ogni cambio (`written` nel controllore) e la scheda Revisioni.
  /// Il disco risponde quando lo si lascia (`finish`): una scrittura lenta
  /// del provider tiene la successiva in coda, come nell'app sotto carico.
  async function opened(track: boolean) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let disk = { text: tracked(track), revision: "r0" };
    const writes: { text: string; finish: () => void }[] = [];
    const source = async (): Promise<DocumentSource> => ({ text: disk.text, revision: disk.revision, format_id: "docx", source_kind: "text", text_kind: "source" });
    const api: DocumentSessionApi = {
      readDocument: vi.fn(source),
      openDocument: vi.fn(source),
      writeDocument: vi.fn((_id: string, text: string, base: WriteBase) => new Promise<string>((resolve, reject) => {
        writes.push({
          text,
          finish: () => {
            if (base.kind === "descends_from" && base.value !== disk.revision) return reject({ kind: "conflict", message: "superata" });
            disk = { text, revision: `r${writes.length}` };
            resolve(disk.revision);
          },
        });
      })),
      resourceWrite: vi.fn(async () => ({ revision: "byte" })),
      saveDraft: vi.fn(async () => {}),
      discardDraft: vi.fn(async () => {}),
      documentClosed: vi.fn(async () => {}),
    };
    const sessions = new DocumentSessionCollection(api, () => null);
    const text = await sessions.read(DOC);
    const parent = document.createElement("div");
    document.body.append(parent);
    const refused: string[] = [];
    const e = new RichEngine(parent, {
      label: () => "documento",
      onChange: (change) => {
        const outcome = sessions.acceptSurfaceChange(DOC, "riquadro", change);
        if (outcome.kind !== "accepted") refused.push(outcome.kind);
      },
      onSelectionChange: () => {},
    });
    engines.push(e);
    e.setDoc(text);
    const { side: panel, host } = side(e);
    panel.show("revisions");
    // Il tasto parte da dove sta il fuoco, come nell'app.
    const undo = () => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ctrlKey: true, key: "z" });
      (document.activeElement ?? document.body).dispatchEvent(event);
    };
    const one = (label: "rich.rev.reject.one" | "rich.rev.accept.one") => {
      const button = pressed(host.querySelector(".rich-side-change")!, t(label));
      button.focus();
      button.click();
    };
    const all = (label: "rich.rev.reject_all.short" | "rich.rev.accept_all.short") => {
      const button = pressed(host, t(label));
      button.focus();
      button.click();
    };
    /// Passa l'attesa di un salvataggio dopo una battuta: torna il testo
    /// dell'ultima scrittura chiesta al disco.
    const saved = async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      return writes[writes.length - 1]?.text;
    };
    return { e, sessions, writes, refused, disk: () => disk, undo, one, all, saved };
  }

  for (const track of [true, false]) {
    it(`Rifiuta, Ctrl+Z, Ctrl+Z, Rifiuta tutte: ogni gesto parte verso il disco, che alla chiusura è il foglio (registra: ${track})`, async () => {
      const doc = await opened(track);
      const sheet = () => doc.e.getDoc();
      const words = () => doc.e.state.doc.textContent;
      const start = words();

      doc.one("rich.rev.reject.one");
      expect(words()).toBe("resta  e vecchio e altro");
      expect(doc.sessions.isDirty(DOC)).toBe(true);
      expect(await doc.saved()).toBe(sheet());
      // La prima scrittura resta lenta: i gesti dopo aspettano in coda.
      doc.undo();
      expect(words()).toBe(start);
      doc.undo();
      expect(words()).toBe(start);
      doc.all("rich.rev.reject_all.short");
      expect(words()).toBe("resta  e vecchio e ");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(doc.writes).toHaveLength(1);
      expect(doc.sessions.inspect(DOC)?.saveState).toBe("in_corso");
      doc.writes[0]!.finish();
      // Finita la scrittura lenta, il buffer resta sporco del testo nuovo: la
      // prossima parte da sé, sulla revisione appena scritta.
      expect(await doc.saved()).toBe(sheet());
      expect(doc.writes).toHaveLength(2);

      // La chiusura aspetta la scrittura in corso; il disco è il foglio.
      const closing = doc.sessions.flushPendingSave();
      doc.writes[1]!.finish();
      expect(await closing).toEqual([]);
      expect(doc.writes).toHaveLength(2);
      expect(doc.disk().text).toBe(sheet());
      expect(doc.sessions.inspect(DOC)).toMatchObject({ dirty: false, saveState: "salvato" });
      expect(doc.refused).toEqual([]);
    });
  }

  it("Accetta e Accetta tutte partono verso il disco allo stesso modo", async () => {
    const doc = await opened(true);
    doc.one("rich.rev.accept.one");
    expect(await doc.saved()).toBe(doc.e.getDoc());
    doc.writes[0]!.finish();
    doc.all("rich.rev.accept_all.short");
    expect(await doc.saved()).toBe(doc.e.getDoc());
    doc.writes[1]!.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(doc.disk().text).toBe(doc.e.getDoc());
    expect(doc.e.state.doc.textContent).toBe("resta nuovo e  e altro");
    expect(doc.sessions.inspect(DOC)).toMatchObject({ dirty: false, saveState: "salvato" });
    expect(doc.refused).toEqual([]);
  });
});
