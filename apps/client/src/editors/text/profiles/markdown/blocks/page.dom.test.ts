// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { history, undo } from "@codemirror/commands";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { markdownGrammar } from "../grammar";
import { livePreview } from "../livepreview";
import { liveReveal } from "../../../live-reveal";
import { propertyList, setProperty } from "../properties";
import { blocksMode, type BlocksOptions } from "./index";
import { pageClassesWith, pageData, subpageLink } from "./page";

// La testata della pagina in Blocchi (H12) e il suo menu «…» (H13).

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

function mount(doc: string, options: BlocksOptions = {}, readOnly = false): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        markdown({ base: markdownGrammar }),
        livePreview({ openWikilink() {}, searchTag() {} }),
        Prec.highest(liveReveal.of("mai")),
        EditorState.readOnly.of(readOnly),
        blocksMode({ page: () => "Nota", ...options }),
      ],
    }),
  });
  ensureSyntaxTree(view.state, view.state.doc.length, 1000);
  view.dispatch({});
  views.push(view);
  return view;
}

const title = (view: EditorView) => view.dom.querySelector<HTMLInputElement>(".cm-fub-page-title")!;
const key = (target: HTMLElement, name: string) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("le proprietà che la testata scrive", () => {
  const state = (doc: string) => EditorState.create({ doc });
  const apply = (doc: string, key: string, value: string | readonly string[] | null) => {
    const before = state(doc);
    const change = setProperty(before, key, value);
    return change ? before.update({ changes: change }).state.doc.toString() : null;
  };

  it("crea il frontmatter in cima quando non c'è", () => {
    expect(apply("Testo", "icon", "🌱")).toBe("---\nicon: 🌱\n---\nTesto");
  });

  it("sostituisce la voce che c'era, con tutte le sue righe", () => {
    expect(apply("---\ncssclasses:\n  - wide\n  - serif\ntags: a\n---\nX", "cssclasses", ["wide"]))
      .toBe("---\ncssclasses: [wide]\ntags: a\n---\nX");
  });

  it("aggiunge la voce prima della riga di chiusura, e la toglie con null", () => {
    expect(apply("---\ntags: a\n---\nX", "cover", "img/mare.png")).toBe("---\ntags: a\ncover: img/mare.png\n---\nX");
    expect(apply("---\ntags: a\ncover: x.png\n---\nX", "cover", null)).toBe("---\ntags: a\n---\nX");
    expect(apply("Testo", "cover", null)).toBeNull();
  });

  it("mette fra virgolette ciò che YAML leggerebbe come altro", () => {
    expect(apply("X", "cover", "#rosso")).toBe("---\ncover: \"#rosso\"\n---\nX");
    expect(apply("X", "icon", "true")).toBe("---\nicon: \"true\"\n---\nX");
  });

  it("legge una classe a elenco in ogni forma", () => {
    expect(propertyList(state("---\ncssclasses: [wide, mono]\n---\n"), "cssclasses")).toEqual(["wide", "mono"]);
    expect(propertyList(state("---\ncssclasses:\n  - small\n---\n"), "cssclasses")).toEqual(["small"]);
    expect(propertyList(state("---\ncssclasses: wide\n---\n"), "cssclasses")).toEqual(["wide"]);
    expect(propertyList(state("Testo"), "cssclasses")).toEqual([]);
  });
});

describe("le classi del menu «…»", () => {
  it("accende e spegne larghezza e testo piccolo, lasciando le altre", () => {
    expect(pageClassesWith(["mia"], { toggle: "wide" })).toEqual(["mia", "wide"]);
    expect(pageClassesWith(["wide", "mia"], { toggle: "wide" })).toEqual(["mia"]);
  });

  it("tiene un carattere solo, o quello del tema", () => {
    expect(pageClassesWith(["serif", "wide"], { font: "mono" })).toEqual(["wide", "mono"]);
    expect(pageClassesWith(["sans", "mia"], { font: null })).toEqual(["mia"]);
  });
});

describe("la testata della pagina", () => {
  it("mostra il nome del file come titolo, prima del testo", () => {
    const view = mount("# Uno\n\nTesto");
    const header = view.dom.querySelector(".cm-fub-page")!;
    expect(header).not.toBeNull();
    expect(header.compareDocumentPosition(view.dom.querySelector(".cm-line")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title(view).value).toBe("Nota");
    // Senza chi rinomina, il titolo non si cambia.
    expect(title(view).readOnly).toBe(true);
  });

  it("legge icona, copertina e classi dal frontmatter", () => {
    const view = mount("---\nicon: 🌱\ncover: mare.png\ncssclasses: [wide, mono]\n---\nTesto", { folderPage: () => true });
    expect(pageData(view.state)).toMatchObject({ title: "Nota", folder: true, icon: "🌱", cover: "mare.png", classes: ["wide", "mono"] });
    expect(view.dom.querySelector(".cm-fub-page-icon")?.textContent).toBe("🌱");
    expect(title(view).title).toContain("cartella");
  });

  it("Invio rinomina col titolo scritto e porta al testo", async () => {
    const rename = vi.fn(async () => null);
    const view = mount("---\ntags: a\n---\nTesto", { rename });
    const field = title(view);
    expect(field.readOnly).toBe(false);
    field.focus();
    field.value = "Nota nuova";
    key(field, "Enter");
    await settle();
    expect(rename).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledWith("Nota nuova");
    // Il cursore va sulla prima riga dopo il frontmatter.
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("Testo");
  });

  it("un nome rifiutato torna indietro e dice perché", async () => {
    const notify = vi.fn();
    const rename = vi.fn(async () => "C'è già una nota con quel nome");
    const view = mount("Testo", { rename, notify });
    const field = title(view);
    field.value = "Altra";
    key(field, "Enter");
    await settle();
    expect(field.value).toBe("Nota");
    expect(notify).toHaveBeenCalledWith("C'è già una nota con quel nome", "guasto");
  });

  it("Esc lascia il nome di prima, e un titolo vuoto non rinomina", async () => {
    const rename = vi.fn(async () => null);
    const view = mount("Testo", { rename });
    const field = title(view);
    field.value = "Altro";
    key(field, "Escape");
    expect(field.value).toBe("Nota");
    field.value = "   ";
    field.dispatchEvent(new FocusEvent("blur"));
    await settle();
    expect(rename).not.toHaveBeenCalled();
  });

  it("↑ sulla prima riga porta al titolo", () => {
    const view = mount("Testo\n\nAltro", { rename: async () => null });
    view.focus();
    const handled = runScopeHandlers(view, new KeyboardEvent("keydown", { key: "ArrowUp" }), "editor");
    expect(handled).toBe(true);
    expect(document.activeElement).toBe(title(view));
  });

  it("il menu «…» scrive cssclasses con un passo d'annullamento", () => {
    const view = mount("---\ncssclasses: [mia]\n---\nTesto");
    view.dom.querySelector<HTMLButtonElement>(".cm-fub-page-more")!.click();
    const wide = [...document.querySelectorAll<HTMLElement>("[role=menuitemcheckbox]")].find((item) => item.textContent?.endsWith("Larghezza piena"))!;
    expect(wide.getAttribute("aria-checked")).toBe("false");
    wide.click();
    expect(view.state.doc.toString()).toBe("---\ncssclasses: [mia, wide]\n---\nTesto");
    view.dom.querySelector<HTMLButtonElement>(".cm-fub-page-more")!.click();
    const mono = [...document.querySelectorAll<HTMLElement>("[role=menuitemradio]")].find((item) => item.textContent?.endsWith("Monospaziato"))!;
    mono.click();
    expect(propertyList(view.state, "cssclasses")).toEqual(["mia", "wide", "mono"]);
    undo(view);
    expect(propertyList(view.state, "cssclasses")).toEqual(["mia", "wide"]);
  });

  it("la copertina si scrive dal suo riquadro e si toglie", () => {
    const view = mount("Testo");
    const add = [...view.dom.querySelectorAll<HTMLButtonElement>(".cm-fub-page-tool")].find((button) => button.textContent === "Aggiungi una copertina")!;
    add.click();
    const field = document.querySelector<HTMLInputElement>(".cm-fub-page-popover input")!;
    field.value = "img/mare.png";
    key(field, "Enter");
    expect(view.state.doc.toString()).toBe("---\ncover: img/mare.png\n---\nTesto");
  });

  it("in sola lettura non offre strumenti", () => {
    const view = mount("---\nicon: 🌱\n---\nTesto", { rename: async () => null }, true);
    expect(view.dom.querySelector(".cm-fub-page-tools")).toBeNull();
    expect(title(view).readOnly).toBe(true);
    expect(view.dom.querySelector<HTMLButtonElement>(".cm-fub-page-icon")!.disabled).toBe(true);
  });

  it("«Nuova sottopagina» dice che cosa succede, crea e scrive il link", async () => {
    const subpage = vi.fn(async () => null);
    const view = mount("Testo\n\nAltro", { subpage });
    view.dispatch({ selection: { anchor: 2 } });
    [...view.dom.querySelectorAll<HTMLButtonElement>(".cm-fub-page-tool")].find((button) => button.textContent === "Nuova sottopagina")!.click();
    expect(document.querySelector(".cm-fub-page-popover .cm-fub-page-note")?.textContent).toContain("diventa la pagina della cartella «Nota»");
    const field = document.querySelector<HTMLInputElement>(".cm-fub-page-popover input")!;
    field.value = "Tappe";
    key(field, "Enter");
    await settle();
    expect(subpage).toHaveBeenCalledWith("Tappe");
    expect(view.state.doc.toString()).toBe("Testo\n\n[[Tappe]]\n\nAltro");
  });

  it("una sottopagina rifiutata non scrive niente e dice perché", async () => {
    const notify = vi.fn();
    const view = mount("Testo", { subpage: async () => "C'è già", notify, folderPage: () => true });
    [...view.dom.querySelectorAll<HTMLButtonElement>(".cm-fub-page-tool")].find((button) => button.textContent === "Nuova sottopagina")!.click();
    expect(document.querySelector(".cm-fub-page-popover .cm-fub-page-note")?.textContent).toContain("nasce nella cartella");
    const field = document.querySelector<HTMLInputElement>(".cm-fub-page-popover input")!;
    field.value = "Tappe";
    key(field, "Enter");
    await settle();
    expect(view.state.doc.toString()).toBe("Testo");
    expect(notify).toHaveBeenCalledWith("C'è già", "guasto");
  });
});

describe("dove va il link della sottopagina", () => {
  const at = (doc: string, head: number) => {
    const state = EditorState.create({ doc, selection: { anchor: head } });
    const place = subpageLink(state, "Tappe");
    return state.update({ changes: { from: place.from, insert: place.insert } }).state.doc.toString();
  };

  it("in una riga vuota, o in un paragrafo dopo il blocco del cursore", () => {
    expect(at("Uno\n\nDue", 4)).toBe("Uno\n[[Tappe]]\nDue");
    expect(at("Uno\nancora\n\nDue", 1)).toBe("Uno\nancora\n\n[[Tappe]]\n\nDue");
  });

  it("mai dentro il frontmatter", () => {
    expect(at("---\ntags: a\n---\nTesto", 5)).toBe("---\ntags: a\n---\nTesto\n\n[[Tappe]]");
  });
});
