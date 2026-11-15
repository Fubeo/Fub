// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { history } from "@codemirror/commands";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { markdownGrammar } from "../grammar";
import { livePreview } from "../livepreview";
import { liveReveal } from "../../../live-reveal";
import { propertiesDisplay, type PropertiesDisplay } from "../../../properties-display";
import { renderMarkdown } from "../render";
import { blocksMode } from "../blocks/index";
import { mountReadingHeader } from "./header";
import { mountMarkdown } from "../mount";
import type { MarkdownResourceChange, MarkdownResources } from "../../../../../ui/markdown-resources";
import corpus from "../../../../../__fixtures__/corpus-syntax.json";
import skin from "../../../../../theme/scrittoio/skin.css?raw";

// La testata della pagina (T6, E3): la stessa in Scrittura e in Lettura.
// Copertina, icona, titolo, proprietà in evidenza, «Altre N», «Aggiungi una
// proprietà»; il file non cambia finché non si scrive.

const views: EditorView[] = [];
beforeEach(() => vi.stubGlobal("navigator", { language: "it" }));
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const NOTE = [
  "---",
  "icon: 🌱",
  "cover: img/mare.png",
  "tipo: Progetto",
  "stato: In corso",
  "scadenza: 2027-03-20",
  "persone: [Anna, Luca]",
  "luogo: Biblioteca",
  "budget:",
  "---",
  "Primo paragrafo.",
  "",
  "Secondo.",
].join("\n");

function mount(doc: string, display: PropertiesDisplay = "visible", readOnly = false): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        markdown({ base: markdownGrammar }),
        livePreview({ openWikilink() {}, searchTag() {} }),
        Prec.highest(liveReveal.of("mai")),
        propertiesDisplay.of(display),
        EditorState.readOnly.of(readOnly),
        blocksMode({ page: () => "Nota", rename: async () => null }),
      ],
    }),
  });
  ensureSyntaxTree(view.state, view.state.doc.length, 1000);
  view.dispatch({});
  views.push(view);
  return view;
}

const header = (view: EditorView) => view.dom.querySelector<HTMLElement>(".cm-fub-page")!;
const rows = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>(".cm-fub-page-prop")].map((row) => row.dataset.key);
const toggle = (root: ParentNode) => root.querySelector<HTMLButtonElement>(".cm-fub-page-props-more");
const press = (target: HTMLElement, key: string) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

describe("la testata in Scrittura", () => {
  it("mette in ordine copertina, icona, titolo, proprietà e poi il testo", () => {
    const view = mount(NOTE);
    const root = header(view);
    const order = [...root.children].map((child) => child.className.split(" ")[0]);
    expect(order).toEqual(["cm-fub-page-cover", "cm-fub-page-icon", "cm-fub-page-tools", "cm-fub-page-title", "cm-fub-page-props"]);
    expect(rows(root)).toEqual(["tipo", "stato", "scadenza", "persone"]);
    expect(toggle(root)?.textContent).toBe("Altre 2 proprietà");
    expect(root.querySelector(".cm-fub-page-props-add")?.textContent).toBe("Aggiungi una proprietà");
    // Il frontmatter sta tutto nella testata: lo YAML non si vede.
    expect(view.contentDOM.textContent).not.toContain("tipo: Progetto");
    expect(view.contentDOM.textContent).toContain("Primo paragrafo.");
  });

  it("«Altre N» apre il resto, e resta aperto quando la testata si rifà", () => {
    const view = mount(NOTE);
    toggle(header(view))!.click();
    expect(rows(header(view))).toEqual(["tipo", "stato", "scadenza", "persone", "luogo", "budget"]);
    expect(toggle(header(view))?.getAttribute("aria-expanded")).toBe("true");
    expect(header(view).querySelector("[data-key=budget] .cm-fub-page-prop-value")?.textContent).toBe("Vuoto");
    // Una modifica al frontmatter (da un altro riquadro) rifà la testata.
    const at = view.state.doc.toString().indexOf("Biblioteca");
    view.dispatch({ changes: { from: at, to: at + "Biblioteca".length, insert: "Archivio" } });
    expect(header(view).querySelector("[data-key=luogo] .cm-fub-page-prop-value")?.textContent).toBe("Archivio");
    expect(toggle(header(view))?.getAttribute("aria-expanded")).toBe("true");
  });

  it("in `hidden` le proprietà stanno tutte dietro «Altre N»", () => {
    const view = mount(NOTE, "hidden");
    expect(rows(header(view))).toEqual([]);
    expect(toggle(header(view))?.textContent).toBe("Altre 6 proprietà");
    toggle(header(view))!.click();
    expect(rows(header(view))).toHaveLength(6);
  });

  it("in `source` lo YAML resta sotto il titolo, e nessuna riga di proprietà", () => {
    const view = mount(NOTE, "source");
    expect(header(view).querySelector(".cm-fub-page-props")).toBeNull();
    expect(view.contentDOM.textContent).toContain("tipo: Progetto");
  });

  it("un valore apre lo YAML sulla sua riga, e la testata cede il posto", () => {
    const view = mount(NOTE);
    header(view).querySelector<HTMLElement>("[data-key=stato] .cm-fub-page-prop-value")!.click();
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    expect(line.text).toBe("stato: In corso");
    expect(view.state.selection.main.head).toBe(line.to);
    expect(header(view).querySelector(".cm-fub-page-props")).toBeNull();
    expect(view.contentDOM.textContent).toContain("stato: In corso");
  });

  it("«Aggiungi una proprietà» e «Aggiungi una descrizione» scrivono la voce e ci portano dentro", () => {
    const view = mount("---\nstato: aperto\n---\nTesto");
    header(view).querySelector<HTMLElement>(".cm-fub-page-props-add")!.click();
    expect(view.state.doc.toString()).toBe("---\nstato: aperto\n\n---\nTesto");
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(3);
    // Lo YAML è aperto: si torna al testo, si toglie la riga vuota.
    view.dispatch({ changes: { from: 18, to: 19 }, selection: { anchor: view.state.doc.length - 1 } });
    const add = [...header(view).querySelectorAll<HTMLElement>(".cm-fub-page-tool")]
      .find((button) => button.textContent === "Aggiungi una descrizione");
    add!.click();
    expect(view.state.doc.toString()).toContain("description: \n---\nTesto");
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("description: ");
  });

  it("la copertina riposizionata scrive `cover-y:`, e le righe `---` restano protette", () => {
    const view = mount(NOTE);
    const cover = header(view).querySelector<HTMLElement>(".cm-fub-page-cover")!;
    [...cover.querySelectorAll<HTMLElement>(".cm-fub-page-cover-tool")].find((b) => b.textContent === "Riposiziona")!.click();
    press(cover, "ArrowUp");
    press(cover, "Enter");
    expect(view.state.doc.toString()).toContain("budget:\ncover-y: 55\n---\n");
    // Una battuta prima dell'apertura scende sotto la chiusura, come prima.
    view.dispatch({ changes: { from: 0, insert: "x" }, userEvent: "input.type" });
    expect(view.state.doc.toString()).toMatch(/^---\n[^]*\n---\nxPrimo paragrafo\./);
  });

  it("↓ dal titolo passa per le proprietà e arriva al testo; ↑ dalla prima riga torna su", () => {
    const view = mount(NOTE);
    const root = header(view);
    const title = root.querySelector<HTMLInputElement>(".cm-fub-page-title")!;
    title.focus();
    press(title, "ArrowDown");
    expect(document.activeElement?.closest("[data-key]")?.getAttribute("data-key")).toBe("tipo");
    for (let i = 0; i < 3; i++) press(document.activeElement as HTMLElement, "ArrowDown");
    expect(document.activeElement?.closest("[data-key]")?.getAttribute("data-key")).toBe("persone");
    press(document.activeElement as HTMLElement, "ArrowDown");
    expect(document.activeElement).toBe(toggle(root));
    press(document.activeElement as HTMLElement, "ArrowDown");
    expect(document.activeElement?.classList.contains("cm-fub-page-props-add")).toBe(true);
    press(document.activeElement as HTMLElement, "ArrowDown");
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("Primo paragrafo.");
    // ↑ dalla prima riga del testo: l'ultima voce della testata.
    const up = new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true });
    expect(runScopeHandlers(view, up, "editor")).toBe(true);
    expect(document.activeElement?.classList.contains("cm-fub-page-props-add")).toBe(true);
    press(document.activeElement as HTMLElement, "ArrowUp");
    expect(document.activeElement).toBe(toggle(header(view)));
  });

  it("senza frontmatter: il titolo, «Aggiungi una proprietà» e il testo", () => {
    const view = mount("Solo testo.");
    const root = header(view);
    expect(rows(root)).toEqual([]);
    expect(toggle(root)).toBeNull();
    expect(root.querySelector(".cm-fub-page-props-add")).not.toBeNull();
    expect(root.querySelector(".cm-fub-page-cover")).toBeNull();
  });

  it("un frontmatter illeggibile resta YAML sotto il titolo, e la testata lo dice", () => {
    const view = mount("---\ntitolo senza due punti\nstato: aperto\n---\nTesto");
    const root = header(view);
    expect(root.querySelector(".cm-fub-page-unreadable")?.getAttribute("role")).toBe("note");
    expect(rows(root)).toEqual([]);
    expect(view.contentDOM.textContent).toContain("titolo senza due punti");
  });

  it("in sola lettura si guarda: niente strumenti, niente «Aggiungi», valori non cliccabili", () => {
    const view = mount(NOTE, "visible", true);
    const root = header(view);
    expect(root.querySelector(".cm-fub-page-tools")).toBeNull();
    expect(root.querySelector(".cm-fub-page-props-add")).toBeNull();
    expect(root.querySelector("button.cm-fub-page-prop-value")).toBeNull();
    expect(root.querySelector(".cm-fub-page-cover-tools")).toBeNull();
    expect(toggle(root)).not.toBeNull();
  });

  it("una battuta nel testo non rifà la testata", () => {
    const view = mount(NOTE);
    const before = header(view);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "x" }, userEvent: "input.type" });
    expect(header(view)).toBe(before);
  });

  it("il titolo che si sta scrivendo resta quando il frontmatter cambia da fuori", () => {
    const view = mount(NOTE);
    const title = header(view).querySelector<HTMLInputElement>(".cm-fub-page-title")!;
    title.focus();
    title.value = "Nota nuova";
    title.setSelectionRange(2, 4);
    const at = view.state.doc.toString().indexOf("Biblioteca");
    view.dispatch({ changes: { from: at, to: at + "Biblioteca".length, insert: "Archivio" } });
    const after = header(view).querySelector<HTMLInputElement>(".cm-fub-page-title")!;
    expect(after.value).toBe("Nota nuova");
    expect(document.activeElement).toBe(after);
    expect([after.selectionStart, after.selectionEnd]).toEqual([2, 4]);
    // L'uscita del campo vecchio non ha rinominato: il titolo aspetta Invio.
    expect(view.state.doc.toString()).toContain("luogo: Archivio");
  });

  it("un riquadro aperto resta aperto quando il frontmatter cambia, e la testata si rifà alla chiusura", () => {
    const view = mount(NOTE);
    header(view).querySelector<HTMLElement>(".cm-fub-page-icon")!.click();
    const picker = () => document.querySelector(".cm-fub-page-popover");
    expect(picker()).not.toBeNull();
    const at = view.state.doc.toString().indexOf("Biblioteca");
    view.dispatch({ changes: { from: at, to: at + "Biblioteca".length, insert: "Archivio" } });
    expect(picker()).not.toBeNull();
    press(document.activeElement as HTMLElement, "Escape");
    expect(picker()).toBeNull();
    toggle(header(view))!.click();
    expect(header(view).querySelector("[data-key=luogo] .cm-fub-page-prop-value")?.textContent).toBe("Archivio");
  });

  it("riposizionata la copertina, il fuoco torna a «Riposiziona», con Invio e con Esc", () => {
    const view = mount(NOTE);
    const reposition = () => [...header(view).querySelectorAll<HTMLElement>(".cm-fub-page-cover-tool")].find((b) => b.textContent === "Riposiziona")!;
    reposition().click();
    const cover = header(view).querySelector<HTMLElement>(".cm-fub-page-cover")!;
    expect(cover.getAttribute("role")).toBe("slider");
    expect(cover.getAttribute("aria-orientation")).toBe("vertical");
    press(cover, "Escape");
    expect(document.activeElement).toBe(reposition());
    reposition().click();
    press(header(view).querySelector<HTMLElement>(".cm-fub-page-cover")!, "ArrowDown");
    press(header(view).querySelector<HTMLElement>(".cm-fub-page-cover")!, "Enter");
    expect(view.state.doc.toString()).toContain("cover-y: 45");
    // La testata si è rifatta con la posizione nuova: il fuoco è sul pulsante nuovo.
    expect(document.activeElement).toBe(reposition());
  });

  it("«Usa» con la copertina che c'era non riscrive niente, nemmeno col commento in coda", () => {
    const doc = "---\ncover: foto.jpg # dalla gita\n---\nTesto";
    const view = mount(doc);
    [...header(view).querySelectorAll<HTMLElement>(".cm-fub-page-cover-tool")].find((b) => b.textContent === "Cambia copertina")!.click();
    const use = [...document.querySelectorAll<HTMLElement>(".cm-fub-page-popover .cm-fub-page-tool")].find((b) => b.textContent === "Usa")!;
    use.click();
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("una voce con un'ancora o un commento non si riscrive: il gesto apre lo YAML su di lei", () => {
    const doc = "---\ncover: &img foto.jpg\nog: *img\ncssclasses: [wide] # mie\n---\nTesto";
    const view = mount(doc);
    [...header(view).querySelectorAll<HTMLElement>(".cm-fub-page-cover-tool")].find((b) => b.textContent === "Cambia copertina")!.click();
    const field = document.querySelector<HTMLInputElement>(".cm-fub-page-popover input")!;
    field.value = "altra.jpg";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    [...document.querySelectorAll<HTMLElement>(".cm-fub-page-popover .cm-fub-page-tool")].find((b) => b.textContent === "Usa")!.click();
    expect(view.state.doc.toString()).toBe(doc);
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("cover: &img foto.jpg");
    // Il menu «⋯» con le classi commentate: lo stesso.
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    header(view).querySelector<HTMLElement>(".cm-fub-page-more")!.click();
    const small = [...document.querySelectorAll<HTMLElement>(".cm-fub-block-menu [role=menuitemcheckbox]")].find((row) => row.textContent?.includes("Testo piccolo"))!;
    small.click();
    expect(view.state.doc.toString()).toBe(doc);
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("cssclasses: [wide] # mie");
  });

  it("un frontmatter illeggibile: nessuno strumento scrive, e lo dice anche con `source`", () => {
    const doc = "---\nicon: 🌱\ncover: mare.png\ntitolo: a: b\n---\nTesto";
    const view = mount(doc);
    const root = header(view);
    expect(root.querySelector(".cm-fub-page-unreadable")).not.toBeNull();
    expect(root.querySelector(".cm-fub-page-tools")).toBeNull();
    expect(root.querySelector(".cm-fub-page-cover-tools")).toBeNull();
    expect(root.querySelector<HTMLButtonElement>("button.cm-fub-page-icon")?.disabled).toBe(true);
    expect(root.querySelector(".cm-fub-page-props-add")).toBeNull();
    const source = mount(doc, "source");
    expect(header(source).querySelector(".cm-fub-page-unreadable")).not.toBeNull();
    // Un blocco `---` che non è una mappa: il modello lo tiene com'è, la
    // testata non ne scrive un altro sopra.
    const bare = mount("---\nsolo del testo\n---\nTesto");
    expect(header(bare).querySelector(".cm-fub-page-unreadable")).not.toBeNull();
    expect(header(bare).querySelector(".cm-fub-page-tools")).toBeNull();
  });

  it("senza la riga dei dati le etichette sono una proprietà, e una chiave doppia una riga sola", () => {
    const view = mount("---\ntags: [mostra]\nstato: a\nstato: b\n---\nTesto");
    expect(rows(header(view))).toEqual(["tags", "stato"]);
    expect(header(view).querySelector("[data-key=stato] .cm-fub-page-prop-value")?.textContent).toBe("b");
  });

  it("una copertina a tinta unita: il colore, e niente «Riposiziona»", () => {
    const view = mount("---\ncover: \"#a3c4f3\"\n---\nTesto");
    const cover = header(view).querySelector<HTMLElement>(".cm-fub-page-cover")!;
    expect(cover.dataset.color).toBe("true");
    expect(cover.style.backgroundColor).not.toBe("");
    expect(cover.querySelector("img")).toBeNull();
    expect([...cover.querySelectorAll(".cm-fub-page-cover-tool")].map((b) => b.textContent)).toEqual(["Cambia copertina"]);
  });
});

function reading(doc: string, display: PropertiesDisplay = "visible") {
  const element = document.createElement("div");
  element.innerHTML = renderMarkdown(doc).html;
  document.body.append(element);
  const before = element.innerHTML;
  const state = EditorState.create({ doc, extensions: [EditorState.readOnly.of(false)] });
  let open = false;
  const unmount = mountReadingHeader(element, state, { page: () => "Nota" }, display, {
    get open() { return open; },
    set: (value) => { open = value; },
  });
  return { element, before, unmount };
}

describe("la testata in Lettura", () => {
  it("è la stessa: in cima, col titolo come intestazione e le stesse proprietà", () => {
    const { element } = reading(NOTE);
    const root = element.firstElementChild as HTMLElement;
    expect(root.classList.contains("cm-fub-page")).toBe(true);
    const title = root.querySelector(".cm-fub-page-title")!;
    expect(title.getAttribute("role")).toBe("heading");
    expect(title.textContent).toBe("Nota");
    expect(rows(root)).toEqual(["tipo", "stato", "scadenza", "persone"]);
    expect(root.querySelector("button.cm-fub-page-prop-value")).toBeNull();
    expect(root.querySelector(".cm-fub-page-props-add")).toBeNull();
    expect(root.querySelector(".cm-fub-page-tools")).toBeNull();
    toggle(root)!.click();
    expect(rows(root)).toHaveLength(6);
    // Lo YAML reso non si ripete sotto: lo nasconde la pelle, con
    // l'attributo del contenitore.
    expect(element.dataset.pageProps).toBe("header");
    expect(element.querySelector(":scope > .block-frontmatter-unparsed")).not.toBeNull();
  });

  it("in `source` e quando non si legge, lo YAML resta sotto il titolo", () => {
    expect(reading(NOTE, "source").element.dataset.pageProps).toBeUndefined();
    const bad = reading("---\ntitolo senza due punti\nstato: aperto\n---\nTesto");
    expect(bad.element.querySelector(".cm-fub-page-unreadable")).not.toBeNull();
    expect(bad.element.dataset.pageProps).toBeUndefined();
  });

  it("resta in cima quando la resa si rifà da sé, con la riga dei dati", () => {
    const doc = `${NOTE}\n\n![[Altra nota]]`;
    let changed: ((change: MarkdownResourceChange) => void) | null = null;
    const resources = {
      documentId: "nota.md",
      match: () => undefined,
      embed: () => new Promise(() => {}),
      subscribe: (listener: (change: MarkdownResourceChange) => void) => {
        changed = listener;
        return () => { changed = null; };
      },
      invalidate: () => {},
      release: () => {},
    } as unknown as MarkdownResources;
    const element = document.createElement("div");
    document.body.append(element);
    const unmountBody = mountMarkdown(element, renderMarkdown(doc).html, { resources });
    const state = EditorState.create({ doc });
    const unmountHeader = mountReadingHeader(element, state, { page: () => "Nota" }, "visible", { open: false, set: () => {} });
    const root = element.querySelector(":scope > .cm-fub-page")!;
    const facts = document.createElement("div");
    facts.className = "note-facts";
    root.append(facts);
    expect(element.querySelector(".embed[data-embed-page]")).not.toBeNull();
    changed!("embeds");
    expect(element.firstElementChild).toBe(root);
    expect(root.querySelector(".note-facts")).toBe(facts);
    expect(element.dataset.pageProps).toBe("header");
    unmountHeader();
    unmountBody();
  });

  it("smontata, la resa torna com'era", () => {
    const { element, before, unmount } = reading(NOTE);
    unmount();
    expect(element.innerHTML).toBe(before);
  });
});

describe("sul corpus", () => {
  const cases = (corpus as { name: string; source: string }[]);

  it("la testata non cambia un byte del file, in Scrittura e in Lettura", () => {
    for (const { name, source } of cases) {
      for (const display of ["visible", "hidden", "source"] as const) {
        const view = mount(source, display);
        // Il buffer tiene gli a capo LF: è il confronto della sessione col file.
        const buffer = EditorState.create({ doc: source }).doc.toString();
        toggle(header(view))?.click();
        expect(view.state.doc.toString(), `${name} (${display})`).toBe(buffer);
        view.destroy();
        views.splice(views.indexOf(view), 1);
        const { element, before, unmount } = reading(source, display);
        element.querySelector<HTMLElement>(".cm-fub-page-props-more")?.click();
        unmount();
        expect(element.innerHTML, `${name} (${display})`).toBe(before);
        element.remove();
      }
    }
  });
});

describe("la testata misurata da CodeMirror", () => {
  // CodeMirror misura un widget di blocco col suo riquadro, senza margini: un
  // margine di un figlio che uscisse dalla testata (il filo sotto la riga dei
  // dati, la copertina nel margine di cima) le toglierebbe altezza nella
  // mappa, e `posAtCoords` darebbe la riga dopo quella sotto il puntatore.
  it("tiene dentro di sé i margini dei figli", () => {
    const rule = /(?:^|\n)\.cm-fub-page \{([^}]*)\}/.exec(skin.replace(/\/\*[\s\S]*?\*\//g, ""));
    expect(rule?.[1]).toMatch(/display:\s*flow-root;/);
  });
});

describe("la riga degli strumenti della testata", () => {
  // Una riga sola (28 px, come nel prototipo): ciò che non ci sta si nasconde
  // dalla fine e il menu «⋯» lo offre. La larghezza è finta: 300 px di riga,
  // 120 per strumento, 30 per «⋯», 2 di spazio fra l'uno e l'altro.
  function fakeWidths(row: number): () => void {
    const proto = HTMLElement.prototype;
    const scroll = Object.getOwnPropertyDescriptor(proto, "scrollWidth");
    const client = Object.getOwnPropertyDescriptor(proto, "clientWidth");
    const used = (tools: Element) => {
      const shown = [...tools.children].filter((child) => !(child as HTMLElement).hidden);
      return shown.reduce((sum, child) => sum + (child.classList.contains("cm-fub-page-more") ? 30 : 120), 0) + 2 * Math.max(0, shown.length - 1);
    };
    Object.defineProperty(proto, "scrollWidth", { configurable: true, get(this: HTMLElement) { return this.classList.contains("cm-fub-page-tools") ? Math.max(row, used(this)) : 0; } });
    Object.defineProperty(proto, "clientWidth", { configurable: true, get(this: HTMLElement) { return this.classList.contains("cm-fub-page-tools") ? row : 0; } });
    return () => {
      if (scroll) Object.defineProperty(proto, "scrollWidth", scroll);
      else Reflect.deleteProperty(proto, "scrollWidth");
      if (client) Object.defineProperty(proto, "clientWidth", client);
      else Reflect.deleteProperty(proto, "clientWidth");
    };
  }

  it("nasconde dalla fine ciò che non ci sta, e «⋯» lo offre e lo fa", () => {
    const restore = fakeWidths(300);
    try {
      const view = mount("---\nstato: aperto\n---\nTesto");
      const tools = [...header(view).querySelectorAll<HTMLButtonElement>(".cm-fub-page-tool")];
      expect(tools.map((button) => [button.getAttribute("aria-label") ?? button.textContent, button.hidden])).toEqual([
        ["Aggiungi un'icona", false],
        ["Aggiungi una copertina", false],
        ["Aggiungi una descrizione", true],
        ["Le opzioni della pagina", false],
      ]);
      header(view).querySelector<HTMLButtonElement>(".cm-fub-page-more")!.click();
      const items = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")];
      expect(items.map((item) => item.textContent)).toEqual(["Aggiungi una descrizione"]);
      expect(items[0]!.hasAttribute("aria-checked")).toBe(false);
      items[0]!.click();
      expect(view.state.doc.toString()).toContain("description: \n---\nTesto");
    } finally {
      restore();
    }
  });

  it("con posto per tutti non nasconde niente, e il menu ha solo le opzioni della pagina", () => {
    const restore = fakeWidths(600);
    try {
      const view = mount("---\nstato: aperto\n---\nTesto");
      expect([...header(view).querySelectorAll<HTMLButtonElement>(".cm-fub-page-tool")].some((button) => button.hidden)).toBe(false);
      header(view).querySelector<HTMLButtonElement>(".cm-fub-page-more")!.click();
      expect(document.querySelectorAll("[role=menuitem]")).toHaveLength(0);
      expect(document.querySelectorAll("[role=menuitemcheckbox]").length).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });
});
