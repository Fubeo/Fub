// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { history, undo } from "@codemirror/commands";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownGrammar } from "../../grammar";
import { livePreview } from "../../livepreview";
import { liveReveal } from "../../../../live-reveal";
import { propertiesDisplay } from "../../../../properties-display";
import { blocksMode } from "../../blocks/index";
import type { BlocksOptions } from "../../blocks/handles";
import { loadLazyParts } from "../../../../../../ui/lazy-part";
import { parsedView } from "../../test-support";

// I pezzi che arrivano con un `import()` (`ui/lazy-part.ts`) qui ci sono già,
// come dopo il riscaldamento: i gesti si guardano col loro codice.
beforeAll(loadLazyParts);

// Il menu di una proprietà (T8), dal suo nome: Rinomina, Tipo, In evidenza,
// Togli dalla nota. Da tastiera e col puntatore.

const views: EditorView[] = [];
beforeEach(() => vi.stubGlobal("navigator", { language: "it" }));
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function mount(doc: string, options: Partial<BlocksOptions> = {}): { view: EditorView; notices: string[] } {
  const notices: string[] = [];
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        markdown({ base: markdownGrammar }),
        livePreview({ openWikilink() {}, searchTag() {} }),
        Prec.highest(liveReveal.of("mai")),
        propertiesDisplay.of("visible"),
        blocksMode({ page: () => "Nota", notify: (message) => notices.push(message), ...options }),
      ],
    }),
  });
  parsedView(view);
  views.push(view);
  return { view, notices };
}

const text = (view: EditorView) => view.state.doc.toString();
const keyButton = (view: EditorView, key: string) => view.dom.querySelector<HTMLElement>(`.cm-fub-page-prop[data-key="${key}"] .cm-fub-page-prop-key`)!;
const menu = () => document.querySelector<HTMLElement>(".cm-fub-prop-menu")!;
const item = (label: string) => [...menu().querySelectorAll<HTMLElement>("[role^=menuitem]")].find((row) => row.textContent?.includes(label))!;
const press = (target: Element, key: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const shown = (view: EditorView) => [...view.dom.querySelectorAll<HTMLElement>(".cm-fub-page-prop")].map((row) => row.dataset.key);

const NOTE = "---\nstato: aperto\nluogo: Torino\nfatto: true\nanno: 2026\nfonte: archivio\n---\nTesto";

describe("il menu della proprietà", () => {
  it("dice nome e tipo, e si apre dal nome", () => {
    const { view } = mount(NOTE);
    const key = keyButton(view, "anno");
    expect(key.getAttribute("aria-haspopup")).toBe("menu");
    key.click();
    expect(menu().textContent).toContain("anno · Numero");
    expect(key.getAttribute("aria-expanded")).toBe("true");
  });

  it("Rinomina, da tastiera: ↓ fino alla voce, Invio, il nome nuovo, Invio; un nome già preso lo dice", () => {
    const { view } = mount(NOTE);
    keyButton(view, "luogo").click();
    const rename = item("Rinomina");
    rename.focus();
    press(rename, "Enter");
    const field = document.querySelector<HTMLInputElement>(".cm-fub-prop-rename input")!;
    expect(field.value).toBe("luogo");
    field.value = "stato";
    press(field, "Enter");
    expect(document.querySelector(".cm-fub-prop-rename .cm-fub-prop-note")!.textContent).toContain("C'è già una proprietà «stato»");
    expect(text(view)).toBe(NOTE);
    field.value = "città";
    press(field, "Enter");
    expect(text(view)).toBe(NOTE.replace("luogo: Torino", "città: Torino"));
    undo(view);
    expect(text(view)).toBe(NOTE);
  });

  it("Tipo dichiara il tipo nel registro del vault, e lo dice", async () => {
    const declared: [string, string][] = [];
    const { view, notices } = mount(NOTE, {
      setPropertyType: async (key, type) => {
        declared.push([key, type]);
        return null;
      },
    });
    keyButton(view, "luogo").click();
    item("Tipo").click();
    expect(menu().querySelector("[role=menuitemradio][aria-checked=true]")).toBeNull();
    item("Data e ora").click();
    await Promise.resolve();
    await Promise.resolve();
    expect(declared).toEqual([["luogo", "date_time"]]);
    expect(notices[notices.length - 1]).toContain("in tutto il vault");
    expect(text(view)).toBe(NOTE);
  });

  it("un registro che rifiuta con un errore tipizzato lo dice con la specie, mai «[object Object]»", async () => {
    const { view, notices } = mount(NOTE, {
      setPropertyType: async () => {
        throw { kind: "internal", message: "parse failed: yaml codec" };
      },
    });
    keyButton(view, "luogo").click();
    item("Tipo").click();
    item("Data e ora").click();
    await vi.waitFor(() => expect(notices.length).toBeGreaterThan(0));
    const said = notices[notices.length - 1]!;
    expect(said).toContain("luogo");
    expect(said).toContain("si è verificato un problema imprevisto");
    expect(said).not.toContain("[object");
    expect(said).not.toContain("parse failed");
  });

  it("senza chi scrive il registro, «Tipo» non c'è", () => {
    const { view } = mount(NOTE);
    keyButton(view, "luogo").click();
    expect(item("Tipo")).toBeUndefined();
  });

  it("Metti in evidenza: la voce va fra le prime quattro; Togli dall'evidenza: in fondo", () => {
    const { view } = mount(NOTE);
    expect(shown(view)).toEqual(["stato", "luogo", "fatto", "anno"]);
    // «fonte» sta fra le altre: «Altre 1 proprietà» la mostra.
    view.dom.querySelector<HTMLElement>(".cm-fub-page-props-more")!.click();
    keyButton(view, "fonte").click();
    item("Metti in evidenza").click();
    expect(text(view)).toBe("---\nstato: aperto\nluogo: Torino\nfatto: true\nfonte: archivio\nanno: 2026\n---\nTesto");
    keyButton(view, "stato").click();
    item("Togli dall'evidenza").click();
    expect(text(view)).toBe("---\nluogo: Torino\nfatto: true\nfonte: archivio\nanno: 2026\nstato: aperto\n---\nTesto");
    undo(view);
    expect(text(view)).toBe("---\nstato: aperto\nluogo: Torino\nfatto: true\nfonte: archivio\nanno: 2026\n---\nTesto");
  });

  it("con ancore e alias nel frontmatter non sposta righe: apre lo YAML sulla voce (revisione #421)", () => {
    const doc = "---\nbase: &b x\nb: 2\nc: 3\nd: 4\naltro: *b\n---\nTesto";
    const { view } = mount(doc);
    view.dom.querySelector<HTMLElement>(".cm-fub-page-props-more")!.click();
    keyButton(view, "altro").click();
    item("Metti in evidenza").click();
    expect(text(view)).toBe(doc);
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("altro: *b");
  });

  it("con quattro voci o meno sono tutte in evidenza: il menu non offre lo spostamento", () => {
    const { view } = mount("---\na: 1\nb: 2\n---\n");
    keyButton(view, "a").click();
    expect(item("evidenza")).toBeUndefined();
  });

  it("Togli dalla nota toglie la voce con le sue righe, e un annullo la rimette", () => {
    const { view } = mount("---\nluoghi:\n  - Torino\n  - Roma\nanno: 2026\n---\nTesto");
    keyButton(view, "luoghi").click();
    const remove = item("Togli dalla nota");
    expect(remove.dataset.danger).toBe("true");
    remove.click();
    expect(text(view)).toBe("---\nanno: 2026\n---\nTesto");
    undo(view);
    expect(text(view)).toBe("---\nluoghi:\n  - Torino\n  - Roma\nanno: 2026\n---\nTesto");
  });
});
