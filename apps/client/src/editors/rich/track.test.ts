// @vitest-environment happy-dom
//
// La registrazione delle modifiche nella superficie ricca: ciò che si scrive
// diventa una revisione tracciata, il resto non entra.
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../i18n/strings";
import { chainCommands } from "prosemirror-commands";
import { backspace as joinBack, deleteForward as joinForward, splitParagraph } from "./commands";
import { RichEngine } from "./engine";
import { parseProjection, type Block, type Para } from "./projection";
import { replaceAll, resolveAll } from "./review";
import { mountRichRibbon } from "./ribbon";
import { mountRichSide } from "./side";
import { deleteChar, setReviewAuthor, setTracking, trackTransaction } from "./track";
import { addComment } from "./comments";

let engines: RichEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  setReviewAuthor("");
  document.body.replaceChildren();
});

const para = (c: unknown[], extra: object = {}): Block => ({ t: "para", role: { kind: "body" }, ...extra, c }) as Block;

function engine(blocks: readonly Block[], track = true): RichEngine {
  const parent = document.createElement("div");
  document.body.append(parent);
  const made = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  made.setDoc(JSON.stringify({ format: "fub-rich", version: 1, ...(track ? { track: true } : {}), blocks }));
  engines.push(made);
  return made;
}

/// I paragrafi come testo: `+(…)` inserito, `-(…)` eliminato, col nome di
/// chi; `¶+` e `¶-` il segno di fine.
function shown(e: RichEngine): string[] {
  return parseProjection(e.getDoc()).blocks.map((block) => {
    const p = block as Para;
    let out = "";
    for (const inline of p.c ?? []) {
      const x = inline.t === "text" ? inline.x : "□";
      if (inline.del) out += `-(${x}:${inline.del.by ?? ""})`;
      else if (inline.ins) out += `+(${x}:${inline.ins.by ?? ""})`;
      else out += x;
    }
    if (p.ins) out += `¶+${p.ins.by ?? ""}`;
    if (p.del) out += `¶-${p.del.by ?? ""}`;
    return out;
  });
}

function at(e: RichEngine, needle: string): number {
  let found = -1;
  e.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(needle)) found = pos + node.text!.indexOf(needle);
    return found < 0;
  });
  return found;
}

/// I tasti come li lega il motore.
const backspace = chainCommands(joinBack, deleteChar(-1));
const deleteForward = chainCommands(joinForward, deleteChar(1));

const type = (e: RichEngine, text: string) => e.dispatch(e.state.tr.insertText(text));

describe("registra modifiche", () => {
  it("si legge e si scrive nella testa della proiezione", () => {
    const e = engine([para([{ t: "text", x: "testo" }])]);
    expect(e.tracking()).toBe(true);
    expect(e.getDoc()).toContain(`"version":1,"track":true,"blocks"`);
    expect(e.apply(setTracking(false))).toBe(true);
    expect(e.tracking()).toBe(false);
    expect(parseProjection(e.getDoc()).track).toBeUndefined();
    // Smettere non è una revisione, e si disfa.
    expect(shown(e)).toEqual(["testo"]);
    e.run("text.undo");
    expect(e.tracking()).toBe(true);
  });

  it("ciò che si batte entra con la revisione di chi scrive, una sola per parola", () => {
    setReviewAuthor("Bea");
    const e = engine([para([{ t: "text", x: "il gatto" }])]);
    e.select(at(e, "gatto"));
    type(e, "n");
    type(e, "e");
    type(e, "ro ");
    expect(shown(e)).toEqual(["il +(nero :Bea)gatto"]);
    expect(e.state.selection.head).toBe(at(e, "gatto"));
  });

  it("ciò che si cancella resta barrato, e Backspace e Canc ci passano sopra", () => {
    setReviewAuthor("Bea");
    const e = engine([para([{ t: "text", x: "abcde" }])]);
    e.select(at(e, "d"));
    e.apply(backspace);
    e.apply(backspace);
    expect(shown(e)).toEqual(["a-(bc:Bea)de"]);
    // Il cursore resta prima di ciò che esce.
    expect(e.state.selection.head).toBe(at(e, "bc"));
    e.select(at(e, "d"));
    e.apply(deleteForward);
    // Accanto a ciò che ha eliminato poco fa, è la stessa modifica.
    expect(shown(e)).toEqual(["a-(bcd:Bea)e"]);
    expect(e.state.selection.head).toBe(at(e, "e"));
    // Ciò che è già eliminato non si elimina due volte: si scavalca.
    e.apply(backspace);
    expect(shown(e)).toEqual(["-(abcd:Bea)e"]);
    expect(e.state.selection.head).toBe(1);
  });

  it("ciò che chi scrive ha inserito si toglie davvero", () => {
    setReviewAuthor("Bea");
    const e = engine([para([{ t: "text", x: "ab" }, { t: "text", x: "XY", ins: { by: "Ada", at: "2026-01-01T00:00:00Z" } }])]);
    e.select(at(e, "b"));
    type(e, "123");
    e.apply(backspace);
    expect(shown(e)).toEqual(["a+(12:Bea)b+(XY:Ada)"]);
    // L'inserimento di un altro, invece, si elimina come revisione.
    e.select(at(e, "Y") + 1);
    e.apply(backspace);
    expect(shown(e)).toEqual(["a+(12:Bea)b+(X:Ada)-(Y:Bea)"]);
  });

  it("scrivere su una selezione la elimina e scrive dopo", () => {
    setReviewAuthor("Bea");
    const e = engine([para([{ t: "text", x: "il gatto nero" }])]);
    const from = at(e, "gatto");
    e.select(from, from + 5);
    type(e, "cane");
    expect(shown(e)).toEqual(["il -(gatto:Bea)+(cane:Bea) nero"]);
  });

  it("Invio fa un paragrafo nuovo col segno inserito, e unirli lo elimina", () => {
    setReviewAuthor("Bea");
    const e = engine([para([{ t: "text", x: "primo" }]), para([{ t: "text", x: "secondo" }])]);
    e.select(at(e, "mo"));
    e.apply(splitParagraph);
    expect(shown(e)).toEqual(["pri¶+Bea", "mo", "secondo"]);
    // Il segno nuovo è suo: Backspace lo toglie davvero.
    e.apply(backspace);
    expect(shown(e)).toEqual(["primo", "secondo"]);
    // Quello che c'era resta, eliminato.
    e.select(at(e, "secondo"));
    e.apply(backspace);
    expect(shown(e)).toEqual(["primo¶-Bea", "secondo"]);
    expect(e.state.selection.head).toBe(at(e, "primo") + "primo".length);
  });

  it("una selezione fra due paragrafi resta barrata, con il segno di fine", () => {
    setReviewAuthor("Bea");
    const e = engine([para([{ t: "text", x: "uno due" }]), para([{ t: "text", x: "tre quattro" }])]);
    e.select(at(e, "due"), at(e, "quattro"));
    e.apply(backspace);
    expect(shown(e)).toEqual(["uno -(due:Bea)¶-Bea", "-(tre :Bea)quattro"]);
  });

  it("trova e sostituisci registra ogni occorrenza", () => {
    setReviewAuthor("Bea");
    const e = engine([para([{ t: "text", x: "re e re" }])]);
    expect(e.apply(replaceAll({ text: "re", matchCase: false, wholeWord: true }, "regina"))).toBe(true);
    expect(shown(e)).toEqual(["-(re:Bea)+(regina:Bea) e -(re:Bea)+(regina:Bea)"]);
  });

  it("un incolla entra come inserimento, senza le revisioni che portava", () => {
    setReviewAuthor("Bea");
    const source = engine([para([{ t: "text", x: "fuori", del: { by: "Ada" } }])], false);
    const e = engine([para([{ t: "text", x: "dentro" }])]);
    e.select(at(e, "tro"));
    e.paste(source.state.doc.slice(1, 6));
    expect(shown(e)).toEqual(["den+(fuori:Bea)tro"]);
  });

  it("il formato non si cambia mentre si registra, e la barra lo spegne", () => {
    setReviewAuthor("Bea");
    const e = engine([para([{ t: "text", x: "testo" }])]);
    e.select(1, 3);
    e.apply(setTracking(false));
    expect(e.actionState("markdown.bold").enabled).toBe(true);
    e.apply(setTracking(true));
    e.select(1, 3);
    const before = e.getDoc();
    expect(e.actionState("markdown.bold").enabled).toBe(false);
    // Le azioni che scrivono testo restano.
    expect(e.actionState("rich.break.page").enabled).toBe(true);
    e.run("markdown.bold");
    expect(e.getDoc()).toBe(before);
    // Una tabella o uno stile di paragrafo nemmeno.
    expect(trackTransaction(e.state, e.state.tr.setNodeAttribute(0, "align", "center"), "Bea")).toBeNull();
    // I commenti e le revisioni accettate non sono modifiche da registrare.
    expect(e.apply(addComment("Nota", "Bea", "2026-10-18T13:00:00Z"))).toBe(true);
    expect(parseProjection(e.getDoc()).comments).toHaveLength(1);
    e.select(e.state.doc.child(0).nodeSize - 1);
    type(e, "!");
    expect(e.apply(resolveAll(true))).toBe(true);
    expect(shown(e)).toEqual(["□te□sto!"]);
  });

  it("Annulla disfa la revisione intera", () => {
    setReviewAuthor("Bea");
    const e = engine([para([{ t: "text", x: "abc" }])]);
    e.select(3);
    e.apply(backspace);
    expect(shown(e)).toEqual(["a-(b:Bea)c"]);
    e.run("text.undo");
    expect(shown(e)).toEqual(["abc"]);
  });

  it("la barra registra con il nome di chi scrive, e smette", () => {
    const e = engine([para([{ t: "text", x: "testo" }])], false);
    const host = document.createElement("div");
    document.body.append(host);
    const side = mountRichSide(e, { review: true }, (viewId) => {
      if (host.childElementCount === 0) side.panels.find((panel) => panel.id === viewId)!.mount(host);
    });
    const ribbon = mountRichRibbon(e, () => null, { review: true }, { side });
    document.body.append(ribbon.element);
    const button = [...ribbon.element.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.getAttribute("aria-label")?.startsWith(t("rich.track")),
    )!;
    expect(button.closest<HTMLElement>("[data-command]")!.hidden).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    // Senza un nome non comincia: la barra apre Revisioni, sul nome.
    setReviewAuthor("");
    button.click();
    expect(e.tracking()).toBe(false);
    const author = document.activeElement as HTMLInputElement;
    expect(author.tagName).toBe("INPUT");
    expect(host.contains(author)).toBe(true);
    // L'interruttore senza nome non accende, e dice perché.
    const toggle = host.querySelector<HTMLInputElement>('[role="switch"]')!;
    toggle.click();
    expect(e.tracking()).toBe(false);
    expect(host.textContent).toContain(t("rich.track.need_author"));
    author.value = "Bea";
    author.dispatchEvent(new Event("input"));
    // Invio sull'interruttore lo preme, come lo Spazio.
    toggle.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(e.tracking()).toBe(true);
    expect(toggle.checked).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    e.select(6);
    type(e, "!");
    expect(shown(e)).toEqual(["testo+(!:Bea)"]);
    // La modifica è nell'elenco, con chi l'ha fatta.
    expect(host.querySelector(".rich-side-change .rich-side-head")?.textContent).toContain("Bea");
    button.click();
    expect(e.tracking()).toBe(false);
    ribbon.destroy();
  });

  it("in un formato che non registra la barra non lo offre", () => {
    const e = engine([para([{ t: "text", x: "testo" }])], false);
    const ribbon = mountRichRibbon(e, () => null);
    document.body.append(ribbon.element);
    const button = [...ribbon.element.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.getAttribute("aria-label")?.startsWith(t("rich.track")),
    )!;
    expect(button.closest<HTMLElement>("[data-command]")!.hidden).toBe(true);
    ribbon.destroy();
  });
});
