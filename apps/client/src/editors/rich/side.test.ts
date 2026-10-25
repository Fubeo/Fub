// @vitest-environment happy-dom
//
// Il pannello del documento: le schede che la superficie porta
// nell'ispettore. Qui le monta un ispettore finto, come fa la shell.
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../i18n/strings";
import { RichEngine } from "./engine";
import { parseProjection, type Block, type CommentView } from "./projection";
import { mountRichSide, RICH_SIDE_VIEWS, type RichSide } from "./side";

let engines: RichEngine[] = [];
let sides: RichSide[] = [];
afterEach(() => {
  for (const side of sides) side.destroy();
  for (const engine of engines) engine.destroy();
  sides = [];
  engines = [];
  document.body.replaceChildren();
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

/// Il pannello con un ispettore che monta la scheda chiesta.
function side(e: RichEngine, review = true) {
  const host = document.createElement("div");
  document.body.append(host);
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
    // Un clic sul testo lo seleziona nel documento.
    items()[1]!.querySelector<HTMLButtonElement>(".rich-side-quote")!.click();
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe("vecchio");
    // Accettare l'inserimento lo tiene, e la sua voce se ne va; l'altra resta
    // la stessa voce, anche se il testo prima di lei è cambiato.
    const second = items()[1];
    pressed(items()[0]!, t("rich.rev.accept.one")).click();
    expect(items()).toEqual([second]);
    expect(e.state.doc.textContent).toBe("resta nuovo e vecchio");
    pressed(host, t("rich.rev.reject_all.short")).click();
    expect(e.state.doc.textContent).toBe("resta nuovo e vecchio");
    expect(items()).toHaveLength(0);
    expect(host.textContent).toContain(t("rich.rev.none"));
    expect(pressed(host, t("rich.rev.accept_all.short")).hidden).toBe(true);
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
