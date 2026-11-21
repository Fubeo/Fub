// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { history, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, Prec, Transaction } from "@codemirror/state";
import { Decoration, EditorView, runScopeHandlers, WidgetType } from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { getCM, Vim, vim } from "@replit/codemirror-vim";
import { markdownGrammar } from "../grammar";
import { livePreview } from "../livepreview";
import { liveReveal } from "../../../live-reveal";
import { blockIdMarks } from "../block-id";
import { blocksMode, plainMode, type BlocksOptions } from "./index";
import { blockSelection, selectCursorBlock } from "./selection";
import { addBelow, colorRanges, gripLabel, handleSpan, handlesView, visibleLeft } from "./handles";
import { setContentColor } from "../color";
import { blockModel } from "./model";
import { dragPose, LIFT_SCALE, selectedMarkers } from "./motion";
import { closeContextMenu } from "../../../../../ui/menu";
import { createManualDriver, liveState, setMotionDriver } from "../../../../../moto";
import { openSlashMenu, slashMenuExtension, type SlashMenuSource } from "../slash";
import { propertiesDisplay } from "../../../properties-display";
import { dropOffersChanged, offerDropTargets } from "../../../../core/registry";
import { parsedView } from "../test-support";

// I Blocchi nell'editor vero: maniglie, menu, selezione di blocchi, tasti.

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

function mount(doc: string, anchor = 0, notify = vi.fn(), extra: Extension = [], options: BlocksOptions = {}): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        history(),
        markdown({ base: markdownGrammar }),
        livePreview({ openWikilink() {}, searchTag() {} }),
        Prec.highest(liveReveal.of("mai")),
        blockIdMarks,
        blocksMode({ page: () => "Nota", notify, ...options }),
        extra,
      ],
    }),
  });
  parsedView(view);
  views.push(view);
  return view;
}

const press = (view: EditorView, key: string, extra: KeyboardEventInit = {}) =>
  runScopeHandlers(view, new KeyboardEvent("keydown", { key, ...extra }), "editor");

describe("la selezione di blocchi", () => {
  it("Esc seleziona il blocco, Shift-↓ allarga, e lo dice", () => {
    const view = mount("Uno\n\nDue\n\nTre", 1);
    expect(press(view, "Escape")).toBe(true);
    expect(view.state.field(blockSelection)).not.toBeNull();
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("Uno");
    expect(view.dom.classList.contains("cm-fub-blocks-selecting")).toBe(true);
    press(view, "ArrowDown", { shiftKey: true });
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("Uno\n\nDue");
    expect(view.dom.querySelectorAll(".cm-fub-block-selected")).toHaveLength(3);
    expect(view.dom.querySelector(".cm-announced")?.textContent).toBe("2 blocchi selezionati");
  });

  it("Canc elimina i blocchi e le loro righe vuote, in un passo", () => {
    const view = mount("Uno\n\nDue\n\nTre", 6);
    press(view, "Escape");
    press(view, "Delete");
    expect(view.state.doc.toString()).toBe("Uno\n\nTre");
    expect(view.state.field(blockSelection)).toBeNull();
  });

  it("Mod-d duplica e seleziona la copia; Esc torna al testo", () => {
    const view = mount("- a\n- b", 1);
    press(view, "Escape");
    press(view, "d", { ctrlKey: true });
    expect(view.state.doc.toString()).toBe("- a\n- a\n- b");
    expect(view.state.field(blockSelection)).not.toBeNull();
    press(view, "Escape");
    expect(view.state.field(blockSelection)).toBeNull();
    expect(view.state.selection.main.empty).toBe(true);
  });

  it("una battuta, o un clic altrove, la fanno tornare testo", () => {
    const view = mount("Uno\n\nDue", 1);
    press(view, "Escape");
    view.dispatch({ selection: EditorSelection.cursor(7) });
    expect(view.state.field(blockSelection)).toBeNull();
  });

  it("Mod-Shift-↑ sposta la selezione intera e la tiene", () => {
    const view = mount("Uno\n\nDue\n\nTre", 6);
    press(view, "Escape");
    press(view, "ArrowDown", { shiftKey: true });
    press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString()).toBe("Due\n\nTre\n\nUno");
    expect(view.state.field(blockSelection)).not.toBeNull();
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("Due\n\nTre");
  });

  it("Esc sceglie soltanto il blocco del cursore, mai il frontmatter, e Canc toglie solo lui (IMP-6106)", () => {
    const doc = "---\ntags: [a]\n---\nParagrafo uno.\n\nParagrafo due da cancellare.";
    const view = mount(doc, doc.length);
    expect(press(view, "Escape")).toBe(true);
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("Paragrafo due da cancellare.");
    press(view, "Backspace");
    expect(view.state.doc.toString()).toBe("---\ntags: [a]\n---\nParagrafo uno.");
    // Nel frontmatter, o su una riga vuota, Esc non sceglie niente.
    for (const at of [5, doc.indexOf("\n\n") + 1]) {
      const other = mount(doc, at);
      expect(press(other, "Escape")).toBe(false);
      expect(other.state.field(blockSelection)).toBeNull();
      expect(other.state.selection.main.empty).toBe(true);
    }
  });

  it("il velo della selezione copre la riga del blocco, non la testata attaccata sopra (IMP-6106)", () => {
    class Tall extends WidgetType {
      override get estimatedHeight() { return 300; }
      toDOM() { return document.createElement("div"); }
    }
    const header = EditorView.decorations.of(Decoration.set([Decoration.widget({ widget: new Tall(), block: true, side: -1 }).range(0)]));
    const view = mount("Paragrafo uno.\nParagrafo due da cancellare.", 30, vi.fn(), header);
    press(view, "Escape");
    const markers = selectedMarkers(view) as unknown as readonly { top: number; height: number }[];
    expect(markers).toHaveLength(1);
    const text = view.lineBlockAt(0);
    expect(markers[0]!.top).toBeGreaterThanOrEqual(300);
    expect(markers[0]!.top + markers[0]!.height).toBeCloseTo(view.lineBlockAt(view.state.doc.length).bottom, 5);
    expect(markers[0]!.height).toBeLessThan(text.bottom);
  });

  it("con più cursori Esc non fa una selezione di blocchi da uno solo", () => {
    const view = mount("Uno\n\nDue", 1);
    view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(6)]) });
    press(view, "Escape");
    // La selezione di blocchi è una: si prende il cursore principale.
    expect(view.state.selection.ranges).toHaveLength(1);
  });
});

describe("le maniglie", () => {
  it("il «+» e la maniglia stanno fuori dal contenuto, coi loro nomi", () => {
    const view = mount("## Cose da fare\n\nTesto", 3);
    const root = view.scrollDOM.querySelector(".cm-fub-block-handles")!;
    expect(root).not.toBeNull();
    expect(view.contentDOM.contains(root)).toBe(false);
    const buttons = root.querySelectorAll("button");
    expect([...buttons].map((button) => button.getAttribute("aria-label"))[0]).toBe("Aggiungi un blocco sotto");
    expect(gripLabel(view.state, view.state.field(blockModel).blocks, 0)).toBe("Blocco: Titolo 2, Cose da fare");
  });

  it("il «+» aggiunge una voce sorella sotto una voce, un paragrafo sotto il resto", () => {
    const state = mount("1. uno\n2. due\n\nTesto").state;
    const blocks = state.field(blockModel).blocks;
    expect(addBelow(state, blocks, 0).changes).toEqual({ from: 6, insert: "\n2. " });
    expect(addBelow(state, blocks, 2).changes).toEqual({ from: state.doc.length, insert: "\n\n" });
  });

  it("il «+» mette un blocco vuoto e ci apre il «/»; senza il «/» resta il paragrafo vuoto", () => {
    const source: SlashMenuSource = {
      enabled: () => true,
      panel: () => ({ dom: document.createElement("div"), listId: "lista", update() {}, key: () => false, placed() {}, close() {} }),
      choose() {},
    };
    const add = (view: EditorView) => {
      const handles = view.plugin(handlesView)!;
      const block = view.state.field(blockModel).blocks[0]!;
      handles.shown = { from: block.from, depth: block.depth };
      handles.addBlock();
    };
    const view = mount("Testo", 2, vi.fn(), slashMenuExtension(source));
    add(view);
    expect(view.state.doc.toString()).toBe("Testo\n\n/");
    expect(openSlashMenu(view.state)).toMatchObject({ from: 7, query: "" });
    const plain = mount("Testo", 2, vi.fn(), slashMenuExtension({ ...source, enabled: () => false }));
    add(plain);
    expect(plain.state.doc.toString()).toBe("Testo\n\n");
    expect(openSlashMenu(plain.state)).toBeNull();
  });

  it("«Colore» colora il paragrafo intero e la prima riga di titoli e voci (K1)", () => {
    const view = mount("## Titolo\n\nuna\nriga\n\n- voce\n  segue\n\n```\ncodice\n```");
    const blocks = view.state.field(blockModel).blocks;
    const texts = (index: number) => colorRanges(view.state, blocks, index).map((range) => view.state.sliceDoc(range.from, range.to));
    expect(texts(0)).toEqual(["Titolo"]);
    expect(texts(1)).toEqual(["una\nriga"]);
    expect(texts(2)[0]).toBe("voce");
    expect(texts(blocks.findIndex((block) => block.kind === "code"))).toEqual([]);
    for (const range of colorRanges(view.state, blocks, 1)) {
      setContentColor("fill", "yellow", range)({ state: view.state, dispatch: (tr) => view.dispatch(tr) });
    }
    expect(view.state.doc.toString()).toContain('<mark class="fub-bg-yellow">una\nriga</mark>');
  });

  it("stanno a sinistra del riquadro di una citazione, di un riquadro e del codice, non del loro testo rientrato", () => {
    // La riga comincia a 412 px; il testo, rientrato dal filo o dal fondo, a 430.
    const row = (className: string) => {
      const el = document.createElement("div");
      el.className = className;
      vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ left: 412, right: 900, top: 0, bottom: 30, width: 488, height: 30, x: 412, y: 0, toJSON: () => ({}) });
      return el;
    };
    expect(visibleLeft(row("cm-line cm-fub-quote"), 430), "il filo della citazione").toBe(412);
    expect(visibleLeft(row("cm-line cm-fub-codeblock"), 428), "il fondo del codice").toBe(412);
    expect(visibleLeft(row("cm-line cm-fub-callout-line"), 428), "il fondo del riquadro").toBe(412);
    expect(visibleLeft(row("cm-line"), 436), "una voce rientrata resta accanto al suo segno").toBe(436);
    expect(visibleLeft(null, 412)).toBe(412);
  });

  it("su un blocco alto stanno in testa, non a metà altezza", () => {
    expect(handleSpan(150, 150, true), "una tabella alta 150 px: conta la testa").toBe(36);
    expect(handleSpan(0, 150, true), "un widget senza un carattere da misurare").toBe(36);
    expect(handleSpan(24, 24, true), "un widget basso resta centrato").toBe(24);
    expect(handleSpan(18, 30, false), "il testo: la prima riga").toBe(18);
    expect(handleSpan(0, 30, false), "una riga senza carattere: il blocco di riga").toBe(30);
  });

  it("smontare l'editor toglie le maniglie", () => {
    const view = mount("Testo");
    view.destroy();
    views.splice(views.indexOf(view), 1);
    expect(document.querySelector(".cm-fub-block-handles")).toBeNull();
  });
});

describe("gli id di blocco", () => {
  it("con `mai` non si vedono, in coda e su una riga loro", () => {
    const view = mount("Testo ^abc\n\n```\nx\n```\n\n^cod\n\nDopo");
    expect(view.contentDOM.textContent).not.toContain("^abc");
    expect(view.contentDOM.textContent).not.toContain("^cod");
    expect(view.contentDOM.textContent).toContain("Dopo");
  });
});

describe("il codice", () => {
  const doc = "```js\nconst a = 1;\nconst b = 2;\n```";

  it("Tab rientra il codice", () => {
    const view = mount(doc, doc.indexOf("const b"));
    expect(press(view, "Tab")).toBe(true);
    expect(view.state.doc.line(3).text.startsWith("\t") || view.state.doc.line(3).text.startsWith("  ")).toBe(true);
  });

  it("Mod-a prende prima il codice, poi tutti i blocchi", () => {
    const view = mount(`Prima\n\n${doc}`, 15);
    press(view, "a", { ctrlKey: true });
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("const a = 1;\nconst b = 2;");
    expect(press(view, "a", { ctrlKey: true })).toBe(true);
    expect(view.state.field(blockSelection)).not.toBeNull();
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(`Prima\n\n${doc}`);
  });

  it("fuori dal codice Tab resta quello di sempre", () => {
    const view = mount("Testo", 2);
    expect(press(view, "Tab")).toBe(false);
  });
});

describe("Esc in una scheda della lavagna", () => {
  it("sul testo Esc resta all'ospite, che ne esce; una selezione di blocchi la chiude ancora", () => {
    const view = mount("Uno\n\nDue", 1, vi.fn(), [], { escapeLeaves: true });
    expect(press(view, "Escape")).toBe(false);
    expect(view.state.field(blockSelection)).toBeNull();
    // Una selezione di blocchi fatta in altro modo (dalla maniglia): il
    // primo Esc torna al testo, il secondo esce.
    expect(selectCursorBlock(view)).toBe(true);
    expect(view.state.field(blockSelection)).not.toBeNull();
    expect(press(view, "Escape")).toBe(true);
    expect(view.state.field(blockSelection)).toBeNull();
    expect(press(view, "Escape")).toBe(false);
  });
});

describe("Vim e composizione (H15)", () => {
  it("con Vim nel modo normale i tasti dei Blocchi sono di Vim", () => {
    const view = mount("Uno\n\nDue", 6, vi.fn(), vim());
    expect(view.scrollDOM.classList.contains("cm-vimMode")).toBe(true);
    expect(press(view, "Escape")).toBe(false);
    expect(view.state.field(blockSelection)).toBeNull();
    press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString()).toBe("Uno\n\nDue");
    // Le maniglie ci sono anche con Vim: si usano col mouse.
    expect(view.scrollDOM.querySelector(".cm-fub-block-handles")).not.toBeNull();
  });

  it("durante una composizione nessun tasto dei Blocchi agisce", () => {
    const view = mount("Uno\n\nDue", 6);
    Object.defineProperty(view, "composing", { configurable: true, get: () => true });
    press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString()).toBe("Uno\n\nDue");
    expect(press(view, "Escape")).toBe(false);
  });
});

describe("il menu della maniglia", () => {
  const labels = () => [...document.querySelectorAll<HTMLElement>("#context-menu [role^=menuitem] .menu-label")].map((label) => label.textContent);
  const open = (doc: string, at = 0) => {
    const view = mount(doc, 1);
    const handles = view.plugin(handlesView)!;
    const block = view.state.field(blockModel).blocks[at]!;
    handles.shown = { from: block.from, depth: block.depth };
    return { view, handles };
  };
  afterEach(() => closeContextMenu());

  it("col tasto destro è il menu del blocco, senza anello su una voce, e parla coi nomi dei comandi", () => {
    const { view } = open("Uno\n\nDue");
    let textMenus = 0;
    const count = () => textMenus++;
    document.body.addEventListener("contextmenu", count);
    const grip = view.dom.querySelector<HTMLElement>(".cm-fub-block-grip")!;
    const right = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 3, clientY: 3 });
    grip.dispatchEvent(right);
    expect(right.defaultPrevented).toBe(true);
    document.body.removeEventListener("contextmenu", count);
    expect(textMenus, "il menu del testo non si apre").toBe(0);
    const menu = document.querySelector<HTMLElement>("#context-menu")!;
    // Come nel prototipo: il campo «Cerca un'azione…» col fuoco, il nome del
    // blocco, le voci con le loro figure e il piede dei tasti.
    expect(menu.querySelector(".menu-head"), "niente testata").toBeNull();
    const field = menu.querySelector<HTMLInputElement>(".menu-field-input")!;
    expect(field.placeholder).toBe("Cerca un'azione…");
    expect(document.activeElement, "il fuoco è nel campo").toBe(field);
    expect(menu.querySelector(".menu-title")?.textContent).toBe("Testo");
    expect(menu.getAttribute("aria-label")).toBe("Blocco · Testo");
    expect(labels()).toEqual(["Trasforma in", "Colore", "Duplica", "Copia il link al blocco", "Elimina"]);
    const hints = [...menu.querySelectorAll<HTMLElement>("[role^=menuitem] .menu-hint")].map((hint) => hint.textContent).filter((hint) => hint !== "›");
    expect(hints).toEqual(["Ctrl D", "Canc"]);
    expect(menu.querySelectorAll("[role^=menuitem] .menu-icon").length, "ogni voce ha la sua figura").toBe(5);
    expect(menu.querySelector(".menu-foot-keys")?.textContent).toBe("↵ sceglie→ apreEsc chiude");
    // «Sposta su/giù» e «Affianca in colonne» si trovano scrivendo.
    field.value = "affianca";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(labels()).toEqual(["Affianca in colonne"]);
    field.value = "sposta";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(labels(), "il primo blocco non sale").toEqual(["Sposta giù"]);
    expect(grip.getAttribute("aria-expanded")).toBe("true");
    closeContextMenu();
    expect(grip.getAttribute("aria-expanded")).toBe("false");
  });

  it("seleziona la tratta dopo che il menu è al suo posto e ha il fuoco", () => {
    // Selezionare prima riscriveva l'editor e `placeBeside` ne forzava il
    // layout dentro il gesto (17–18 ms sulla WebView, giro 5 della fluidità).
    const { view, handles } = open("Uno\n\nDue", 1);
    const seen: { menu: boolean; field: boolean }[] = [];
    const dispatch = view.dispatch.bind(view);
    const spy = vi.spyOn(view, "dispatch").mockImplementation(((...args: Parameters<EditorView["dispatch"]>) => {
      const menu = document.querySelector("#context-menu");
      seen.push({ menu: menu !== null, field: menu !== null && menu.contains(document.activeElement) });
      dispatch(...args);
    }) as EditorView["dispatch"]);
    handles.openMenu();
    spy.mockRestore();
    expect(seen, "una sola transazione: la selezione").toEqual([{ menu: true, field: true }]);
    const blocks = view.state.field(blockModel).blocks;
    expect(view.state.field(blockSelection)?.anchor, "la tratta è selezionata quando il menu è aperto").toBe(blocks[1]!.from);
    // Riaperto sulla stessa tratta, la selezione c'è già: nessuna transazione.
    closeContextMenu();
    const again = vi.spyOn(view, "dispatch");
    handles.openMenu();
    expect(again).not.toHaveBeenCalled();
    again.mockRestore();
  });

  it("il frontmatter resta il primo: il testo sotto non offre «Sposta su», lui non offre «Sposta giù»", () => {
    const doc = "---\nicon: 🌿\n---\nUno\n\nDue";
    const text = open(doc, 1);
    const up = text.handles.moreItems(text.handles.shown!, (run) => run).map((item) => item.label);
    expect(up, "il primo testo non sale sopra il frontmatter").not.toContain("Sposta su");
    expect(up, "il testo può ancora scendere").toContain("Sposta giù");
    const front = open(doc, 0);
    const own = front.handles.moreItems(front.handles.shown!, (run) => run).map((item) => item.label);
    expect(own, "il frontmatter non scende").not.toContain("Sposta giù");
    expect(own).not.toContain("Sposta su");
  });

  it("aperto da Invio ha il fuoco nel campo e la prima voce accesa; ↓ porta alla seconda", () => {
    const { view } = open("Uno\n\nDue");
    view.dom.querySelector<HTMLElement>(".cm-fub-block-grip")!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    const field = document.querySelector<HTMLInputElement>("#context-menu .menu-field-input")!;
    expect(document.activeElement).toBe(field);
    expect(document.querySelector("#context-menu .menu-items .menu-lit .menu-label")?.textContent).toBe("Trasforma in");
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(document.activeElement?.getAttribute("role")).toBe("menuitem");
    expect(document.activeElement?.querySelector(".menu-label")?.textContent).toBe("Colore");
  });

  it("«Trasforma in ▸» dice Riquadro, Elenco di attività e Blocco di codice, e Duplica dice Mod-d", () => {
    const { handles, view } = open("Uno\n\nDue");
    const items = handles.mainItems(handles.shown!, (run) => run);
    const transform = items.find((item) => item.label === "Trasforma in")!;
    expect((transform.items as { label: string }[]).map((item) => item.label)).toEqual(expect.arrayContaining(["Riquadro", "Elenco di attività", "Blocco di codice"]));
    expect(items.find((item) => item.label === "Duplica")?.hint).toBeTruthy();
    const colors = items.find((item) => item.label === "Colore")!.items as { label: string; items: { label: string; checked?: boolean }[] }[];
    expect(colors.map((item) => item.label)).toEqual(["Testo", "Fondo"]);
    expect(colors[1]!.items[0]).toMatchObject({ label: "Nessuno", checked: true });
    expect(colors[0]!.items.map((item) => item.label)).toContain("Arancione");
    items.find((item) => item.label === "Duplica")!.run!();
    expect(view.state.doc.toString()).toBe("Uno\n\nUno\n\nDue");
  });
});

describe("il trascinamento solleva soltanto il blocco", () => {
  /// Trascina la maniglia del blocco `index` quanto basta a sollevarlo, e dà
  /// la parte dell'immagine sollevata che contiene le righe clonate.
  function lifted(view: EditorView, index: number): HTMLElement {
    const handles = view.plugin(handlesView)!;
    const block = view.state.field(blockModel).blocks[index]!;
    handles.shown = { from: block.from, depth: block.depth };
    const grip = view.dom.querySelector<HTMLElement>(".cm-fub-block-grip")!;
    grip.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: 0, clientY: 0 }));
    grip.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 0, clientY: 40 }));
    const el = view.scrollDOM.querySelector<HTMLElement>(".cm-fub-block-lift");
    expect(el, "il blocco si solleva").not.toBeNull();
    return el!.querySelector<HTMLElement>(".cm-fub-block-lift-card")!.firstElementChild as HTMLElement;
  }
  /// Il testo di ogni riga o widget che l'immagine porta.
  const rows = (inner: HTMLElement) => Array.from(inner.children, (row) => row.textContent?.trim());

  it("il primo blocco di una nota senza frontmatter non porta la testata", () => {
    const view = mount("Uno\n\nDue", 0);
    expect(view.contentDOM.querySelector(".cm-fub-page")).not.toBeNull();
    const inner = lifted(view, 0);
    expect(inner.querySelector(".cm-fub-page"), "la testata resta ferma").toBeNull();
    expect(rows(inner)).toEqual(["Uno"]);
  });

  it("il frontmatter, primo blocco di una nota con frontmatter, non porta la testata", () => {
    const doc = "---\nicon: 🌿\n---\nUno\n\nDue";
    const view = mount(doc, doc.indexOf("Due"), undefined, propertiesDisplay.of("visible"));
    const inner = lifted(view, 0);
    expect(inner.querySelector(".cm-fub-page"), "la testata resta ferma").toBeNull();
    // Le proprietà le mostra la testata (T6): restano ferme con lei, e il
    // frontmatter coperto non porta un widget suo.
    expect(inner.querySelector(".cm-fub-properties, .cm-fub-page-props")).toBeNull();
    expect(view.contentDOM.querySelector(".cm-fub-page .cm-fub-page-props")).not.toBeNull();
    expect(rows(inner).join("|")).not.toContain("Uno");
  });

  it("col frontmatter scritto come righe, il primo blocco non porta la testata", () => {
    const view = mount("---\nicon: 🌿\n---\nUno\n\nDue", 0);
    const inner = lifted(view, 0);
    expect(inner.querySelector(".cm-fub-page"), "la testata resta ferma").toBeNull();
    expect(rows(inner).join("|")).not.toContain("Uno");
  });

  it("il primo blocco di testo dopo il frontmatter non porta la testata né le proprietà", () => {
    const doc = "---\nicon: 🌿\n---\nUno\n\nDue";
    const view = mount(doc, doc.indexOf("Due"), undefined, propertiesDisplay.of("visible"));
    const inner = lifted(view, 1);
    expect(inner.querySelector(".cm-fub-page"), "la testata resta ferma").toBeNull();
    expect(inner.querySelector(".cm-fub-properties"), "le proprietà restano ferme").toBeNull();
    expect(rows(inner)).toEqual(["Uno"]);
  });

  it("ultimo blocco, voce annidata, codice, tabella e riquadro portano soltanto le loro righe", () => {
    const last = mount("Uno\n\nDue", 6);
    expect(rows(lifted(last, 1))).toEqual(["Due"]);

    const nested = mount("- uno\n  - due\n- tre", 0);
    const due = lifted(nested, 1);
    expect(due.querySelector(".cm-fub-page")).toBeNull();
    expect(rows(due).join("|")).toContain("due");
    expect(rows(due).join("|")).not.toContain("tre");

    const code = mount("Prima\n\n```\ncodice\n```\n\nDopo", 0);
    const block = code.state.field(blockModel).blocks.findIndex((b) => b.kind === "code");
    const fenced = lifted(code, block);
    expect(fenced.querySelector(".cm-fub-page")).toBeNull();
    expect(rows(fenced).join("|")).toContain("codice");
    expect(rows(fenced).join("|")).not.toContain("Dopo");

    const table = mount("| a | b |\n| - | - |\n| 1 | 2 |\n\nDopo", 0);
    const grid = lifted(table, 0);
    expect(grid.querySelector(".cm-fub-page")).toBeNull();
    expect(rows(grid).join("|")).not.toContain("Dopo");

    const callout = mount("> [!note] Titolo\n> testo\n\nDopo", 0);
    const box = lifted(callout, 0);
    expect(box.querySelector(".cm-fub-page")).toBeNull();
    expect(rows(box).join("|")).toContain("testo");
    expect(rows(box).join("|")).not.toContain("Dopo");
  });
});

/// happy-dom non impagina: ogni riga è alta 20 px, come nel test del moto,
/// così il posto è deciso dalle righe vere.
function rowsOf20(view: EditorView): void {
  vi.spyOn(view, "lineBlockAt").mockImplementation((pos: number) => {
    const top = (view.state.doc.lineAt(pos).number - 1) * 20;
    return { from: 0, to: 0, top, bottom: top + 20, height: 20, type: 0, widget: null, widgetLineBreaks: 0 } as ReturnType<EditorView["lineBlockAt"]>;
  });
}

/// Prende la maniglia del blocco `index` col puntatore in `y`.
function grab(view: EditorView, index: number, y: number) {
  const handles = view.plugin(handlesView)!;
  const block = view.state.field(blockModel).blocks[index]!;
  handles.shown = { from: block.from, depth: block.depth };
  const grip = view.dom.querySelector<HTMLElement>(".cm-fub-block-grip")!;
  grip.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: 0, clientY: y }));
  return {
    grip,
    handles,
    move: (toY: number, toX = 0) => grip.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: toX, clientY: toY })),
    up: (toY: number) => grip.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 0, clientY: toY })),
    slot: () => view.scrollDOM.querySelector<HTMLElement>(".cm-fub-block-slot"),
    lift: () => view.scrollDOM.querySelector<HTMLElement>(".cm-fub-block-lift"),
  };
}

describe("il frontmatter resta il primo blocco", () => {
  const DOC = "---\nicon: 🌿\n---\nUno\n\nDue";

  it("trascinando sopra il frontmatter, il posto più alto è subito dopo di lui", () => {
    const view = mount(DOC, 0, undefined, propertiesDisplay.of("visible"));
    rowsOf20(view);
    // Due trascinato fin sopra il frontmatter: il posto si apre dove stava
    // «Uno», cioè subito sotto il frontmatter (che finisce a 60 px).
    let hand = grab(view, 2, 100);
    hand.move(10);
    expect(hand.slot()?.hidden, "il posto si vede").toBe(false);
    expect(hand.slot()?.style.top).toBe("60px");
    expect(hand.slot()?.dataset.home, "non è più l'origine").toBeUndefined();
    hand.handles.endDrag(false);
    expect(view.state.doc.toString()).toBe(DOC);

    // Rilasciato lì, Due va fra il frontmatter e Uno: il frontmatter resta primo.
    hand = grab(view, 2, 100);
    hand.move(10);
    hand.up(10);
    const blocks = view.state.field(blockModel).blocks;
    expect(blocks[0]!.kind).toBe("frontmatter");
    expect(view.state.sliceDoc(blocks[1]!.from, blocks[1]!.to)).toBe("Due");
    expect(view.state.doc.toString()).toBe("---\nicon: 🌿\n---\n\nDue\n\nUno");
  });

  it("trascinato giù, il frontmatter non si sposta: il posto resta l'origine", () => {
    const view = mount(DOC, 0, undefined, propertiesDisplay.of("visible"));
    rowsOf20(view);
    const hand = grab(view, 0, 30);
    hand.move(200);
    expect(hand.slot()?.dataset.home, "il posto resta quello d'origine").toBe("true");
    hand.up(200);
    expect(view.state.doc.toString()).toBe(DOC);
    expect(view.state.field(blockModel).blocks[0]!.kind).toBe("frontmatter");
  });

  it("Mod-Shift-↑/↓ dalla tastiera: il primo testo non sale, il frontmatter non scende, Due va sotto di lui", () => {
    const view = mount(DOC, DOC.indexOf("Uno"), undefined, propertiesDisplay.of("visible"));
    press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString(), "il primo testo non sale").toBe(DOC);
    view.dispatch({ selection: { anchor: 2 } });
    press(view, "ArrowDown", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString(), "il frontmatter non scende").toBe(DOC);
    view.dispatch({ selection: { anchor: DOC.indexOf("Due") } });
    press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString(), "Due sale fin sotto il frontmatter").toBe("---\nicon: 🌿\n---\n\nDue\n\nUno");
    press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString(), "un altro passo non trova posto").toBe("---\nicon: 🌿\n---\n\nDue\n\nUno");
    expect(view.state.field(blockModel).blocks[0]!.kind).toBe("frontmatter");
  });
});

describe("il blocco in mano (E2)", () => {
  // Uno (0–20), Due (40–60), il titolo (80–100), Tre (120–140).
  const DOC = "Uno\n\nDue\n\n# I conti\n\nTre";
  const live = (view: EditorView) => view.dom.querySelector(".cm-fub-block-live")?.textContent?.trim() ?? "";

  it("si prende dopo 4 px di movimento, con gli occhi socchiusi; un clic resta un clic", () => {
    const view = mount(DOC, 0);
    rowsOf20(view);
    const hand = grab(view, 0, 10);
    expect(hand.grip.dataset.held, "premuta, la maniglia socchiude gli occhi").toBe("true");
    hand.move(13);
    expect(hand.lift(), "3 px non bastano").toBeNull();
    hand.move(14);
    expect(hand.lift(), "4 px sì").not.toBeNull();
    expect(hand.slot()?.dataset.home, "il posto, grigio, è l'origine").toBe("true");
    expect(view.dom.classList.contains("cm-fub-blocks-dragging")).toBe(true);
    hand.handles.endDrag(false);
    expect(hand.grip.dataset.held).toBeUndefined();
    expect(hand.lift(), "torna a casa volando").not.toBeNull();
    hand.handles.returning!.land();
    expect(hand.lift()).toBeNull();
    expect(hand.slot()).toBeNull();
  });

  it("il rilascio sul posto sposta il blocco in un solo passo d'annullamento, e lo dice", () => {
    const view = mount(DOC, 0);
    rowsOf20(view);
    const hand = grab(view, 0, 10);
    hand.move(150);
    // Fuori dalla sua sezione: l'etichetta e l'annuncio dicono dove cade.
    expect(view.scrollDOM.querySelector(".cm-fub-block-lift-to")?.textContent).toBe("in «I conti»");
    expect(live(view)).toBe("Posizione 4 di 4, in «I conti»");
    hand.up(150);
    expect(view.state.doc.toString()).toBe("Due\n\n# I conti\n\nTre\n\nUno");
    expect(hand.lift(), "il blocco in mano se ne va").toBeNull();
    undo(view);
    expect(view.state.doc.toString(), "un Ctrl+Z e torna tutto").toBe(DOC);
  });

  it("annuncia ogni cambio di posto, non la presa", () => {
    const view = mount(DOC, 0);
    rowsOf20(view);
    const before = live(view);
    const hand = grab(view, 0, 10);
    hand.move(16);
    expect(live(view), "alla presa il blocco è al suo posto").toBe(before);
    hand.move(70);
    expect(live(view)).toBe("Posizione 2 di 4");
    hand.handles.endDrag(false);
  });

  it("Esc lo riporta dov'era, senza toccare il testo", () => {
    const view = mount(DOC, 0);
    rowsOf20(view);
    const hand = grab(view, 0, 10);
    hand.move(150);
    const lift = hand.lift()!;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(view.dom.classList.contains("cm-fub-blocks-dragging")).toBe(false);
    // Torna a casa da dov'è: la copia resta in pagina e vola, alla fine
    // nella grandezza vera; ombra, posto ed etichette svaniscono; le righe
    // vere restano nascoste e i vicini tornano al loro posto.
    expect(hand.lift()).toBe(lift);
    expect(lift.style.transform, "il volo parte dalla posa, non dal riposo").toBe("");
    expect(lift.querySelector<HTMLElement>(".cm-fub-block-lift-card")!.style.transform).toBe(`scale(${1 / LIFT_SCALE})`);
    expect(lift.querySelector<HTMLElement>(".cm-fub-block-lift-shade")!.style.opacity).toBe("0");
    expect(lift.querySelector<HTMLElement>(".cm-fub-block-lift-tags")!.style.opacity).toBe("0");
    expect(hand.slot()!.style.opacity).toBe("0");
    expect(view.state.field(dragPose).lifted, "le righe vere aspettano la copia").not.toBeNull();
    expect(view.state.field(dragPose).parted).toEqual([]);
    hand.handles.returning!.land();
    expect(hand.lift()).toBeNull();
    expect(hand.slot()).toBeNull();
    expect(view.state.field(dragPose).lifted, "arrivata, le righe vere riappaiono").toBeNull();
    hand.up(150);
    expect(view.state.doc.toString()).toBe(DOC);
  });

  it("una presa nuova posa subito il blocco che sta tornando a casa", () => {
    const view = mount(DOC, 0);
    rowsOf20(view);
    let hand = grab(view, 0, 10);
    hand.move(150);
    hand.handles.endDrag(false);
    expect(hand.handles.returning).not.toBeNull();
    hand = grab(view, 0, 10);
    expect(hand.handles.returning).toBeNull();
    expect(view.scrollDOM.querySelectorAll(".cm-fub-block-lift")).toHaveLength(0);
    hand.handles.endDrag(false);
  });

  it("a puntatore fermo il blocco in mano arriva e il ciclo dei fotogrammi si spegne", () => {
    const view = mount(DOC, 0);
    rowsOf20(view);
    const hand = grab(view, 0, 10);
    hand.move(150);
    const drag = hand.handles.drag!;
    expect(drag.hold!.frames, "acceso mentre corre").not.toBeNull();
    expect(drag.hold!.el.style.willChange, "uno strato suo mentre corre").toBe("transform");
    for (let frame = 0; frame < 120 && drag.hold!.frames; frame += 1) hand.handles.follow(drag);
    expect(drag.hold!.frames, "spento all'arrivo").toBeNull();
    expect(drag.hold!.el.style.willChange, "fermo, il testo si ridisegna nitido").toBe("");
    expect(drag.hold!.cy).toBe(drag.hold!.ty);
    hand.move(70);
    expect(drag.hold!.frames, "riacceso al movimento").not.toBeNull();
    hand.handles.endDrag(false);
    expect(drag.hold!.frames).toBeNull();
    hand.handles.returning?.land();
  });

  it("la finestra che perde il fuoco riporta il blocco al suo posto", () => {
    const view = mount(DOC, 0);
    rowsOf20(view);
    const hand = grab(view, 0, 10);
    hand.move(150);
    window.dispatchEvent(new Event("blur"));
    hand.handles.returning!.land();
    expect(hand.lift()).toBeNull();
    expect(view.state.doc.toString()).toBe(DOC);
  });

  it("il testo cambiato da fuori durante il gesto lo annulla: vince il testo nuovo", async () => {
    const view = mount(DOC, 0);
    rowsOf20(view);
    const hand = grab(view, 0, 10);
    hand.move(150);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\n\nQuattro" } });
    await Promise.resolve();
    expect(hand.lift()).toBeNull();
    hand.up(150);
    expect(view.state.doc.toString()).toBe(`${DOC}\n\nQuattro`);
  });

  it("un blocco alto si fa compatto: al più 104 px, tagliato, col suo tipo", () => {
    const tall = "```\n1\n2\n3\n4\n5\n6\n7\n8\n```\n\nDopo";
    const view = mount(tall, tall.length);
    rowsOf20(view);
    const hand = grab(view, 0, 10);
    hand.move(30);
    const lift = hand.lift()!;
    expect(lift.style.height).toBe("104px");
    expect(lift.querySelector<HTMLElement>(".cm-fub-block-lift-card")?.dataset.clipped).toBe("true");
    expect(lift.querySelector(".cm-fub-block-lift-more")?.textContent).toBeTruthy();
    expect(hand.slot()?.style.height).toBe("104px");
    hand.handles.endDrag(false);
  });
});

describe("il blocco in mano (E2), i casi limite", () => {
  const DOC = "Uno\n\nDue\n\n# I conti\n\nTre";
  const live = (view: EditorView) => view.dom.querySelector(".cm-fub-block-live")?.textContent?.trim() ?? "";

  it("a riposo carta e ombra sono più grandi dell'1,5%: la presa cresce, non cala", () => {
    const view = mount(DOC, 0);
    rowsOf20(view);
    const hand = grab(view, 0, 10);
    hand.move(30);
    expect(hand.lift()).not.toBeNull();
    // La regola del tema: la scala a riposo è LIFT_SCALE, e la presa parte da
    // 1/LIFT_SCALE (cioè dalla grandezza vera) verso quella.
    const css = Array.from(document.querySelectorAll("style"), (style) => style.textContent ?? "").join("\n");
    const rule = /\.cm-fub-block-lift-shade,\s*\.cm-fub-block-lift-card[^{]*\{([^}]*)\}/.exec(css.replace(/\.ͼ\w+ /g, ""));
    expect(rule, "la regola della carta in mano").not.toBeNull();
    expect(rule![1]).toContain(`scale: ${LIFT_SCALE}`);
    expect(LIFT_SCALE).toBeGreaterThan(1);
    hand.handles.endDrag(false);
  });

  it("la copia in mano non ha id né fuoco", () => {
    const view = mount("Uno ^abc123\n\nDue", 0);
    rowsOf20(view);
    view.contentDOM.querySelector(".cm-line")?.setAttribute("id", "riga");
    const hand = grab(view, 0, 10);
    hand.move(30);
    const lift = hand.lift()!;
    expect(lift.hasAttribute("inert")).toBe(true);
    expect(lift.getAttribute("aria-hidden")).toBe("true");
    expect(lift.querySelector("[id]")).toBeNull();
    hand.handles.endDrag(false);
  });

  it("la misura rifatta dentro l'aggiornamento di CodeMirror non spedisce una transazione lì dentro", async () => {
    const view = mount(DOC, 0);
    rowsOf20(view);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const hand = grab(view, 0, 10);
    hand.move(150);
    // Le righe cambiano altezza (la finestra si stringe): la posa cambia.
    vi.spyOn(view, "lineBlockAt").mockImplementation((pos: number) => {
      const top = (view.state.doc.lineAt(pos).number - 1) * 30;
      return { from: 0, to: 0, top, bottom: top + 30, height: 30, type: 0, widget: null, widgetLineBreaks: 0 } as ReturnType<EditorView["lineBlockAt"]>;
    });
    const before = view.state.field(dragPose).parted;
    hand.handles.remeasure(hand.handles.drag!);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await Promise.resolve();
    expect(errors.mock.calls.flat().join(" ")).not.toMatch(/update is in progress/);
    expect(view.state.field(dragPose).parted, "la posa nuova è scritta, appena dopo").not.toEqual(before);
    errors.mockRestore();
    hand.handles.endDrag(false);
  });

  it("Mod-Shift-↓ dice il posto come il trascinamento", () => {
    const view = mount("# I conti\n\nUno\n\nDue", 12);
    press(view, "ArrowDown", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString()).toBe("# I conti\n\nDue\n\nUno");
    expect(live(view)).toBe("Posizione 3 di 3, in «I conti»");
  });

  it("il testo cambiato prima della presa annulla il gesto", async () => {
    const view = mount(DOC, 0);
    rowsOf20(view);
    const hand = grab(view, 0, 10);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\n\nQuattro" } });
    await Promise.resolve();
    expect(hand.handles.drag).toBeNull();
    hand.move(150);
    expect(hand.lift()).toBeNull();
  });

  it("durante un gesto il tasto destro (la pressione lunga) non apre il menu", () => {
    const view = mount(DOC, 0);
    rowsOf20(view);
    const hand = grab(view, 0, 10);
    hand.grip.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 5, clientY: 5 }));
    expect(document.querySelector("#context-menu")).toBeNull();
    hand.handles.endDrag(false);
    closeContextMenu();
  });

  it("in una vista scalata (la lavagna con lo zoom) il posto si conta in px di CodeMirror", () => {
    const view = mount(DOC, 0);
    rowsOf20(view);
    Object.defineProperty(view, "scaleX", { value: 2, configurable: true });
    Object.defineProperty(view, "scaleY", { value: 2, configurable: true });
    // Il puntatore a 150 px di schermo è a 75 px di CodeMirror: dopo «Due»,
    // non in fondo come sarebbe a scala 1.
    let hand = grab(view, 0, 20);
    hand.move(150);
    expect(live(view)).toBe("Posizione 2 di 4");
    hand.handles.endDrag(false);
    // A 300 px di schermo, 150 di CodeMirror: in fondo.
    hand = grab(view, 0, 20);
    hand.move(300);
    hand.up(300);
    expect(view.state.doc.toString()).toBe("Due\n\n# I conti\n\nTre\n\nUno");
  });

  it("«Accanto» a sinistra chiede il puntatore ben oltre il bordo: una deriva non basta", () => {
    const view = mount(DOC, 0);
    rowsOf20(view);
    const hand = grab(view, 0, 10);
    hand.move(70, -24);
    expect(view.scrollDOM.querySelector<HTMLElement>(".cm-fub-block-drop")?.hidden, "nessuna barra").toBe(true);
    expect(live(view)).toBe("Posizione 2 di 4");
    hand.handles.endDrag(false);
  });
});

describe("fuori dalla colonna (E2)", () => {
  // Uno (0–20), «I conti» (40–60), Due (80–100), «Fine» (120–140), Tre (160–180).
  const DOC = "Uno\n\n## I conti\n\nDue\n\n## Fine\n\nTre";
  const live = (view: EditorView) => view.dom.querySelector(".cm-fub-block-live")?.textContent?.trim() ?? "";
  const tag = (view: EditorView) => view.dom.querySelector<HTMLElement>(".cm-fub-block-lift-to");

  /// La Struttura della nota: un titolo, «I conti», nella riga 400–600 × 100–128.
  /// `at.top` sposta la riga (la Struttura che scorre); `asked` conta le misure.
  function structure(hover = vi.fn(), vault: string | undefined = undefined) {
    const start = DOC.indexOf("## I conti");
    const at = { top: 100 };
    const asked = vi.fn();
    const stop = offerDropTargets({
      offers: (doc) => {
        asked();
        return doc.documentId === "nota.md"
          ? [{ kind: "place", document: { documentId: "nota.md", vault }, span: { start, end: start + 10 }, title: "I conti", rect: { left: 400, top: at.top, right: 600, bottom: at.top + 28 }, hover }]
          : [];
      },
    });
    return { hover, stop, at, asked };
  }
  const NOTE = { documentId: "nota.md", vault: undefined };
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  it("oltre 90 px dal testo il blocco si stacca; sul titolo della Struttura va in fondo alla sezione, e un annulla lo rimette", () => {
    const { hover, stop } = structure();
    try {
      const view = mount(DOC, 0, vi.fn(), [], { document: () => NOTE });
      rowsOf20(view);
      const hand = grab(view, 0, 10);
      hand.move(14);
      hand.move(60, 90);
      expect(hand.lift()?.dataset.free, "a 90 px resta nel testo").toBeUndefined();
      expect(hand.slot()?.dataset.home, "il posto segue il puntatore").toBeUndefined();
      hand.move(60, 91);
      expect(hand.lift()?.dataset.free, "a 91 px si stacca: è il cartellino").toBe("true");
      expect(hand.slot()?.dataset.home, "il posto torna all'origine").toBe("true");
      const scale = Number(hand.lift()!.style.getPropertyValue("--fub-block-free-scale"));
      expect(scale, "largo al più 250 px, mai più dell'86%").toBeGreaterThan(0);
      expect(scale).toBeLessThanOrEqual(0.86);
      expect(tag(view)?.hidden, "senza bersaglio, nessuna etichetta").toBe(true);
      expect(live(view)).toBe("Fuori dal testo: lasciato qui torna al suo posto");
      // Sul titolo della Struttura: il cartellino e l'annuncio dicono dove va.
      hand.move(110, 500);
      expect(tag(view)?.textContent).toBe("In fondo a «I conti»");
      expect(live(view)).toBe("In fondo a «I conti»");
      expect(hover).toHaveBeenLastCalledWith(true);
      // Il cartellino è appeso sotto il puntatore, in coordinate dello schermo.
      hand.handles.follow(hand.handles.drag!, true);
      expect(hand.lift()!.style.transform).toBe("translate(514.00px, 126.00px)");
      hand.up(110);
      expect(hover).toHaveBeenLastCalledWith(false);
      expect(view.state.doc.toString()).toBe("## I conti\n\nDue\n\nUno\n\n## Fine\n\nTre");
      expect(hand.lift(), "nessun volo: il blocco è già al suo posto nuovo").toBeNull();
      undo(view);
      expect(view.state.doc.toString(), "un Ctrl+Z e torna tutto").toBe(DOC);
    } finally {
      stop();
    }
  });

  it("fuori dal titolo, o con la Struttura chiusa, il cartellino torna indietro al rilascio", () => {
    const view = mount(DOC, 0, vi.fn(), [], { document: () => NOTE });
    rowsOf20(view);
    const hand = grab(view, 0, 10);
    hand.move(14);
    hand.move(110, 500);
    expect(hand.lift()?.dataset.free).toBe("true");
    expect(tag(view)?.hidden, "nessun bersaglio: nessuna etichetta").toBe(true);
    const lift = hand.lift()!;
    hand.up(110);
    expect(view.state.doc.toString()).toBe(DOC);
    // Torna a casa volando, dalla sua scala, di nuovo dentro lo scorrimento.
    expect(hand.lift()).toBe(lift);
    expect(lift.dataset.free).toBeUndefined();
    expect(lift.querySelector<HTMLElement>(".cm-fub-block-lift-card")!.style.transformOrigin).toBe("0 0");
    hand.handles.returning!.land();
    expect(hand.lift()).toBeNull();
  });

  it("il titolo che è il blocco in mano non è un bersaglio", () => {
    const { hover, stop } = structure();
    try {
      const view = mount(DOC, 0, vi.fn(), [], { document: () => NOTE });
      rowsOf20(view);
      const hand = grab(view, 1, 50);
      hand.move(54);
      hand.move(110, 500);
      expect(tag(view)?.hidden).toBe(true);
      expect(hover).not.toHaveBeenCalled();
      hand.handles.endDrag(false);
      hand.handles.returning?.land();
      expect(view.state.doc.toString()).toBe(DOC);
    } finally {
      stop();
    }
  });

  it("tornato verso il testo, il blocco riprende a cercare il posto fra i vicini", () => {
    const { stop } = structure();
    try {
      const view = mount(DOC, 0, vi.fn(), [], { document: () => NOTE });
      rowsOf20(view);
      const hand = grab(view, 0, 10);
      hand.move(14);
      hand.move(110, 500);
      hand.move(110, 0);
      expect(hand.lift()?.dataset.free).toBeUndefined();
      expect(tag(view)?.textContent, "di nuovo l'etichetta della sezione").toBe("in «I conti»");
      hand.up(110);
      expect(view.state.doc.toString()).toBe("## I conti\n\nDue\n\nUno\n\n## Fine\n\nTre");
    } finally {
      stop();
    }
  });

  it("la Struttura che scorre o si ridisegna a metà gesto: i bersagli si rimisurano, non a ogni movimento", async () => {
    const { hover, stop, at, asked } = structure();
    try {
      const view = mount(DOC, 0, vi.fn(), [], { document: () => NOTE });
      rowsOf20(view);
      const hand = grab(view, 0, 10);
      hand.move(14);
      hand.move(110, 500);
      expect(tag(view)?.textContent).toBe("In fondo a «I conti»");
      const measured = asked.mock.calls.length;
      hand.move(112, 500);
      hand.move(114, 502);
      expect(asked.mock.calls.length, "nessuna misura per movimento").toBe(measured);
      // La rotella scorre la Struttura: la riga va 200 px più giù.
      at.top = 300;
      document.body.dispatchEvent(new Event("scroll"));
      document.body.dispatchEvent(new Event("scroll"));
      await frame();
      expect(asked.mock.calls.length, "una misura per fotogramma").toBe(measured + 1);
      expect(hover).toHaveBeenLastCalledWith(false);
      expect(tag(view)?.hidden, "sotto il puntatore non c'è più la riga").toBe(true);
      expect(live(view)).toBe("Fuori dal testo: lasciato qui torna al suo posto");
      hand.move(310, 500);
      expect(tag(view)?.textContent, "la riga dov'è adesso").toBe("In fondo a «I conti»");
      // La shell ridisegna: la riga torna su, e il bersaglio la segue.
      at.top = 100;
      dropOffersChanged();
      await frame();
      expect(tag(view)?.hidden).toBe(true);
      hand.move(110, 500);
      expect(tag(view)?.textContent).toBe("In fondo a «I conti»");
      hand.up(110);
      expect(view.state.doc.toString()).toBe("## I conti\n\nDue\n\nUno\n\n## Fine\n\nTre");
      // Finito il gesto, niente ascolti rimasti accesi.
      const after = asked.mock.calls.length;
      document.body.dispatchEvent(new Event("scroll"));
      dropOffersChanged();
      await frame();
      expect(asked.mock.calls.length).toBe(after);
    } finally {
      stop();
    }
  });

  it("i posti di un altro vault, con lo stesso percorso, non sono bersagli", () => {
    const { hover, stop } = structure(vi.fn(), "/altro-vault");
    try {
      const view = mount(DOC, 0, vi.fn(), [], { document: () => ({ documentId: "nota.md", vault: "/questo-vault" }) });
      rowsOf20(view);
      const hand = grab(view, 0, 10);
      hand.move(14);
      hand.move(110, 500);
      expect(hand.lift()?.dataset.free).toBe("true");
      expect(tag(view)?.hidden).toBe(true);
      expect(hover).not.toHaveBeenCalled();
      hand.up(110);
      hand.handles.returning?.land();
      expect(view.state.doc.toString()).toBe(DOC);
    } finally {
      stop();
    }
  });
});

// ── «Sposta in…» (E13, T32) ─────────────────────────────────────────────────
//
// Il menu del blocco e il blocco lasciato su una nota del cassetto: l'editor
// non tocca il documento, chiede lo spostamento al comando del nucleo (qui una
// porta finta) coi byte del blocco e il testo letto lì.

describe("«Sposta in…» (E13)", () => {
  const DOC = "Uno\n\n## I conti\n\nDue\n\n## Fine\n\nTre";
  const NOTE = { documentId: "nota.md", vault: undefined };
  const tag = (view: EditorView) => view.dom.querySelector<HTMLElement>(".cm-fub-block-lift-to");
  const live = (view: EditorView) => view.dom.querySelector(".cm-fub-block-live")?.textContent?.trim() ?? "";
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  function port() {
    return {
      notes: vi.fn(async () => [{ id: "nota.md", title: "nota" }, { id: "Progetto.md", title: "Progetto" }]),
      headings: vi.fn(async (doc: string) => doc === "Progetto.md"
        ? [{ slug: "idee", text: "Idee", level: 2, start: 10 }]
        : [{ slug: "i-conti", text: "I conti", level: 2, start: 5 }]),
      move: vi.fn(async () => null as string | null),
    };
  }

  /// Il cassetto: la nota «Progetto» nella riga 0–240 × 300–328.
  function drawer(hover = vi.fn()) {
    const stop = offerDropTargets({
      offers: (doc) => [{ kind: "note", document: { documentId: "Progetto.md", vault: doc.vault }, title: "Progetto", rect: { left: 0, top: 300, right: 240, bottom: 328 }, hover }],
    });
    return { hover, stop };
  }

  afterEach(() => closeContextMenu());

  it("trascinato su una nota del cassetto, il cartellino la nomina e il rilascio la chiede al comando: in fondo, col link", async () => {
    const { hover, stop } = drawer();
    try {
      const move = port();
      const view = mount(DOC, 0, vi.fn(), [], { document: () => NOTE, move });
      rowsOf20(view);
      const hand = grab(view, 0, 10);
      hand.move(14);
      hand.move(314, 120);
      expect(hand.lift()?.dataset.free, "fuori dalla colonna").toBe("true");
      expect(tag(view)?.textContent).toBe("Sposta in «Progetto»");
      expect(live(view)).toBe("Sposta in «Progetto»");
      expect(hover).toHaveBeenLastCalledWith(true);
      hand.up(314);
      await settle();
      expect(hover).toHaveBeenLastCalledWith(false);
      expect(move.move).toHaveBeenCalledWith({ doc: "nota.md", at: [0, 3], text: "Uno", to: "Progetto.md", heading: null, leave: "link" });
      expect(view.state.doc.toString(), "il documento lo cambia la ricarica dopo le due scritture").toBe(DOC);
      expect(view.state.field(dragPose).lifted, "il blocco si è posato").toBeNull();
    } finally {
      stop();
    }
  });

  it("senza chi sposta fra le note, le note del cassetto non sono bersagli", () => {
    const { hover, stop } = drawer();
    try {
      const view = mount(DOC, 0, vi.fn(), [], { document: () => NOTE });
      rowsOf20(view);
      const hand = grab(view, 0, 10);
      hand.move(14);
      hand.move(314, 120);
      expect(tag(view)?.hidden).toBe(true);
      expect(hover).not.toHaveBeenCalled();
      hand.up(314);
      hand.handles.returning?.land();
      expect(view.state.doc.toString()).toBe(DOC);
    } finally {
      stop();
    }
  });

  it("un rifiuto del comando si dice, e il documento resta com'era", async () => {
    const { stop } = drawer();
    try {
      const move = port();
      move.move.mockResolvedValue("«Progetto» è cambiata");
      const notify = vi.fn();
      const view = mount(DOC, 0, notify, [], { document: () => NOTE, move });
      rowsOf20(view);
      const hand = grab(view, 0, 10);
      hand.move(14);
      hand.move(314, 120);
      hand.up(314);
      await settle();
      expect(notify).toHaveBeenCalledWith("Il blocco non si è spostato: «Progetto» è cambiata", "guasto");
      expect(view.state.doc.toString()).toBe(DOC);
    } finally {
      stop();
    }
  });

  /// Il menu della maniglia del blocco `at`, aperto col tasto destro.
  function openMenu(view: EditorView, at: number): void {
    const handles = view.plugin(handlesView)!;
    const block = view.state.field(blockModel).blocks[at]!;
    handles.shown = { from: block.from, depth: block.depth };
    view.dom.querySelector<HTMLElement>(".cm-fub-block-grip")!
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 3, clientY: 3 }));
  }
  const item = (label: string) => [...document.querySelectorAll<HTMLElement>("#context-menu [role^=menuitem]")]
    .find((each) => each.querySelector(".menu-label")?.textContent === label);

  it("dal menu del blocco: la nota, poi dove e che cosa resta; il comando riceve i byte del blocco", async () => {
    const move = port();
    const view = mount(DOC, 0, vi.fn(), [], { document: () => NOTE, move });
    openMenu(view, 4);
    const labels = [...document.querySelectorAll<HTMLElement>("#context-menu [role^=menuitem] .menu-label")].map((label) => label.textContent);
    expect(labels, "dopo Duplica, come nel prototipo").toEqual(["Trasforma in", "Colore", "Duplica", "Sposta in…", "Copia il link al blocco", "Elimina"]);
    item("Sposta in…")!.click();
    await settle();
    // La nota: l'elenco filtrabile, col percorso; la nota stessa lo dice.
    const dialog = document.querySelector<HTMLElement>(".modale[role=dialog]")!;
    expect(dialog.querySelector(".palette-heading")?.textContent).toBe("Sposta in…");
    expect(dialog.querySelector<HTMLInputElement>(".palette-input")?.placeholder).toBe("Cerca una nota…");
    const options = [...dialog.querySelectorAll<HTMLElement>("[role=option]")];
    expect(options.map((option) => option.textContent), "la nota stessa per ultima").toEqual(["ProgettoProgetto.md", "notaquesta nota · nota.md"]);
    options[0]!.click();
    await settle();
    // Dove e che cosa resta: in fondo e il link sono già scelti.
    const form = document.querySelector<HTMLFormElement>(".modale .palette-form")!;
    expect(document.querySelector(".modale .palette-heading")?.textContent).toBe("Sposta in «Progetto»");
    const where = form.querySelector<HTMLSelectElement>("select[name=where]")!;
    const leave = form.querySelector<HTMLSelectElement>("select[name=leave]")!;
    expect(document.activeElement, "il fuoco sulla prima domanda").toBe(where);
    expect([...where.options].map((option) => option.text)).toEqual(["In fondo alla nota", " In fondo a «Idee»"]);
    expect([...leave.options].map((option) => option.text)).toEqual(["Un link alla nota", "Niente", "Una trasclusione del blocco"]);
    where.value = "idee";
    leave.value = "embed";
    form.requestSubmit();
    await settle();
    const tre = DOC.indexOf("Tre");
    expect(move.move).toHaveBeenCalledWith({ doc: "nota.md", at: [tre, tre + 3], text: "Tre", to: "Progetto.md", heading: "idee", leave: "embed" });
    expect(document.querySelector(".modale"), "le finestre si sono chiuse").toBeNull();
  });

  it("nella stessa nota non chiede che cosa resta, e non offre i titoli dentro ciò che si sposta", async () => {
    const move = port();
    move.headings.mockResolvedValue([{ slug: "i-conti", text: "I conti", level: 2, start: DOC.indexOf("## I conti") }, { slug: "fine", text: "Fine", level: 2, start: DOC.indexOf("## Fine") }]);
    const view = mount(DOC, 0, vi.fn(), [], { document: () => NOTE, move });
    openMenu(view, 1);
    item("Sposta in…")!.click();
    await settle();
    [...document.querySelectorAll<HTMLElement>(".modale [role=option]")][1]!.click();
    await settle();
    const form = document.querySelector<HTMLFormElement>(".modale .palette-form")!;
    const where = form.querySelector<HTMLSelectElement>("select[name=where]")!;
    expect([...where.options].map((option) => option.text), "il titolo in mano non è una destinazione").toEqual(["In fondo alla nota", " In fondo a «Fine»"]);
    expect(form.querySelector<HTMLSelectElement>("select[name=leave]")!.closest("label")!.hidden).toBe(true);
    form.requestSubmit();
    await settle();
    const start = new TextEncoder().encode(DOC.slice(0, DOC.indexOf("## I conti"))).length;
    // Un titolo è un blocco solo: la sua riga (la sezione resta dov'è).
    expect(move.move).toHaveBeenCalledWith({ doc: "nota.md", at: [start, start + "## I conti".length], text: "## I conti", to: "nota.md", heading: null, leave: "none" });
  });

  it("una tratta di più blocchi si sposta intera, e non offre la trasclusione", async () => {
    const move = port();
    const view = mount("Uno\n\nDue\n\nTre", 1, vi.fn(), [], { document: () => NOTE, move });
    press(view, "Escape");
    press(view, "ArrowDown", { shiftKey: true });
    openMenu(view, 0);
    item("Sposta in…")!.click();
    await settle();
    [...document.querySelectorAll<HTMLElement>(".modale [role=option]")][0]!.click();
    await settle();
    const form = document.querySelector<HTMLFormElement>(".modale .palette-form")!;
    expect([...form.querySelector<HTMLSelectElement>("select[name=leave]")!.options].map((option) => option.value)).toEqual(["link", "none"]);
    form.requestSubmit();
    await settle();
    expect(move.move).toHaveBeenCalledWith({ doc: "nota.md", at: [0, 8], text: "Uno\n\nDue", to: "Progetto.md", heading: null, leave: "link" });
  });

  it("il testo cambiato mentre si sceglie: non si sposta niente, e lo dice", async () => {
    const move = port();
    const notify = vi.fn();
    const view = mount(DOC, 0, notify, [], { document: () => NOTE, move });
    openMenu(view, 0);
    item("Sposta in…")!.click();
    await settle();
    [...document.querySelectorAll<HTMLElement>(".modale [role=option]")][0]!.click();
    await settle();
    view.dispatch({ changes: { from: 0, insert: "Prima\n\n" } });
    document.querySelector<HTMLFormElement>(".modale .palette-form")!.requestSubmit();
    await settle();
    expect(move.move).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("La nota è cambiata mentre sceglievi: non si è spostato niente.", "guasto");
  });

  it("chiusa la scelta della nota, non si sposta niente", async () => {
    const move = port();
    const view = mount(DOC, 0, vi.fn(), [], { document: () => NOTE, move });
    openMenu(view, 0);
    item("Sposta in…")!.click();
    await settle();
    document.querySelector<HTMLElement>(".modale")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle();
    expect(document.querySelector(".modale")).toBeNull();
    expect(move.headings).not.toHaveBeenCalled();
    expect(move.move).not.toHaveBeenCalled();
  });
});

// ── «Porta su una lavagna» (E25, T48) ───────────────────────────────────────
//
// Il menu del blocco e il blocco lasciato su una lavagna aperta a lato:
// l'editor non tocca il documento, chiede al comando del nucleo (qui una porta
// finta) di fare dei blocchi le schede di una lavagna; con Ctrl li copia.

describe("«Porta su una lavagna» (E25)", () => {
  const DOC = "Uno\n\n## I conti\n\nDue\n\n## Fine\n\nTre";
  const NOTE = { documentId: "nota.md", vault: undefined };
  const tag = (view: EditorView) => view.dom.querySelector<HTMLElement>(".cm-fub-block-lift-to");
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  const port = () => ({ carry: vi.fn(async () => null as string | null) });

  /// Una lavagna aperta a lato, nel riquadro 400–900 × 0–600.
  function beside(hover = vi.fn()) {
    const stop = offerDropTargets({
      offers: (doc) => [{ kind: "board", document: { documentId: "Idee.canvas", vault: doc.vault }, title: "Idee", rect: { left: 400, top: 0, right: 900, bottom: 600 }, hover }],
    });
    return { hover, stop };
  }

  afterEach(() => closeContextMenu());

  it("trascinato sulla lavagna a lato, il cartellino la nomina e il rilascio la chiede al comando: sposta", async () => {
    const { hover, stop } = beside();
    try {
      const board = port();
      const view = mount(DOC, 0, vi.fn(), [], { document: () => NOTE, board });
      rowsOf20(view);
      const hand = grab(view, 0, 10);
      hand.move(14);
      hand.move(200, 600);
      expect(tag(view)?.textContent).toBe("Porta sulla lavagna «Idee»");
      expect(hover).toHaveBeenLastCalledWith(true);
      hand.up(200);
      await settle();
      expect(board.carry).toHaveBeenCalledWith({ doc: "nota.md", at: [0, 3], text: "Uno", to: "Idee.canvas", keep: false });
      expect(view.state.doc.toString(), "il documento lo cambia la ricarica dopo le due scritture").toBe(DOC);
      expect(view.state.field(dragPose).lifted, "il blocco si è posato").toBeNull();
    } finally {
      stop();
    }
  });

  it("con Ctrl al rilascio, il blocco si copia", async () => {
    const { stop } = beside();
    try {
      const board = port();
      const view = mount(DOC, 0, vi.fn(), [], { document: () => NOTE, board });
      rowsOf20(view);
      const hand = grab(view, 0, 10);
      hand.move(14);
      hand.move(200, 600);
      hand.grip.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 600, clientY: 200, ctrlKey: true }));
      await settle();
      expect(board.carry).toHaveBeenCalledWith(expect.objectContaining({ to: "Idee.canvas", keep: true }));
    } finally {
      stop();
    }
  });

  it("senza chi porta i blocchi, le lavagne a lato non sono bersagli; un rifiuto si dice", async () => {
    const { hover, stop } = beside();
    try {
      let view = mount(DOC, 0, vi.fn(), [], { document: () => NOTE });
      rowsOf20(view);
      let hand = grab(view, 0, 10);
      hand.move(14);
      hand.move(200, 600);
      expect(tag(view)?.hidden).toBe(true);
      expect(hover).not.toHaveBeenCalled();
      hand.up(200);
      hand.handles.returning?.land();
      expect(view.state.doc.toString()).toBe(DOC);

      const board = port();
      board.carry.mockResolvedValue("«nota» è cambiata");
      const notify = vi.fn();
      view = mount(DOC, 0, notify, [], { document: () => NOTE, board });
      rowsOf20(view);
      hand = grab(view, 0, 10);
      hand.move(14);
      hand.move(200, 600);
      hand.up(200);
      await settle();
      expect(notify).toHaveBeenCalledWith("I blocchi non sono andati sulla lavagna: «nota» è cambiata", "guasto");
      expect(view.state.doc.toString()).toBe(DOC);
    } finally {
      stop();
    }
  });

  it("dal menu di una scheda viva: «Porta su una lavagna», con la frase del prototipo, chiede una lavagna nuova", async () => {
    const board = port();
    const cards = "Uno\n\n## I conti\n\nDue\n\n## Fine\n\n![[Conti.xlsx]]";
    const view = mount(cards, 0, vi.fn(), [], { document: () => NOTE, board });
    const handles = view.plugin(handlesView)!;
    const block = view.state.field(blockModel).blocks[4]!;
    handles.shown = { from: block.from, depth: block.depth };
    view.dom.querySelector<HTMLElement>(".cm-fub-block-grip")!
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 3, clientY: 3 }));
    const items = [...document.querySelectorAll<HTMLElement>("#context-menu [role^=menuitem]")];
    expect(items.map((each) => each.querySelector(".menu-label")?.textContent))
      .toEqual(["Trasforma in", "Colore", "Porta su una lavagna", "Duplica", "Copia il link al blocco", "Elimina"]);
    const entry = items.find((each) => each.querySelector(".menu-label")?.textContent === "Porta su una lavagna")!;
    expect(entry.textContent).toContain("le schede scelte diventano una lavagna, e viceversa");
    entry.click();
    await settle();
    // Tutto ASCII: i byte sono i caratteri.
    const at = cards.indexOf("![[");
    expect(board.carry).toHaveBeenCalledWith({ doc: "nota.md", at: [at, cards.length], text: "![[Conti.xlsx]]", to: null, keep: false });
    closeContextMenu();

    // Su un blocco di testo la voce non c'è, come nel prototipo.
    const plain = mount(DOC, 0, vi.fn(), [], { document: () => NOTE, board });
    const grip = plain.dom.querySelector<HTMLElement>(".cm-fub-block-grip")!;
    const tre = plain.state.field(blockModel).blocks[4]!;
    plain.plugin(handlesView)!.shown = { from: tre.from, depth: tre.depth };
    grip.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 3, clientY: 3 }));
    expect([...document.querySelectorAll<HTMLElement>("#context-menu [role^=menuitem] .menu-label")].map((label) => label.textContent))
      .not.toContain("Porta su una lavagna");
  });
});

// ── I gesti ai bordi (E2, T2) ───────────────────────────────────────────────
//
// Ogni caso limite di E2 coi gesti che spostano un blocco: il trascinamento
// (presa, posto, rilascio, Esc) e Mod-Shift-↑/↓. Il testo che resta è quello
// di prima, a meno delle righe vuote fra i blocchi.

describe("i gesti ai bordi (E2): primo e ultimo blocco", () => {
  const PLAIN = "Uno\n\nDue\n\nTre";
  const FRONT = "---\nicon: 🌿\n---\nUno\n\nDue\n\nTre";
  const texts = (view: EditorView) => view.state.field(blockModel).blocks.map((block) => view.state.sliceDoc(block.from, block.to));

  it("senza frontmatter: il primo va in fondo, l'ultimo in cima, ognuno in un passo d'annullamento", () => {
    const view = mount(PLAIN, 0);
    rowsOf20(view);
    let hand = grab(view, 0, 10);
    hand.move(200);
    hand.up(200);
    expect(view.state.doc.toString()).toBe("Due\n\nTre\n\nUno");
    undo(view);
    expect(view.state.doc.toString()).toBe(PLAIN);
    hand = grab(view, 2, 90);
    hand.move(-40);
    hand.up(-40);
    expect(view.state.doc.toString()).toBe("Tre\n\nUno\n\nDue");
    undo(view);
    expect(view.state.doc.toString()).toBe(PLAIN);
  });

  it("senza frontmatter: Mod-Shift-↑ sul primo e Mod-Shift-↓ sull'ultimo non cambiano niente, e il tasto si ferma lì", () => {
    const view = mount(PLAIN, 1);
    expect(press(view, "ArrowUp", { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe(PLAIN);
    view.dispatch({ selection: { anchor: PLAIN.length } });
    expect(press(view, "ArrowDown", { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe(PLAIN);
    // L'ultimo sale, col suo cursore.
    press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString()).toBe("Uno\n\nTre\n\nDue");
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("Tre");
  });

  it("senza frontmatter: il primo e l'ultimo, lasciati al loro posto o con Esc, tornano dov'erano senza un passo d'annullamento", () => {
    const view = mount(PLAIN, 0);
    rowsOf20(view);
    for (const [index, y] of [[0, 10], [2, 90]] as const) {
      const hand = grab(view, index, y);
      hand.move(y + 6);
      expect(hand.slot()?.dataset.home, "il posto è l'origine").toBe("true");
      hand.up(y + 6);
      hand.handles.returning?.land();
      const again = grab(view, index, y);
      again.move(index === 0 ? y + 100 : y - 100);
      expect(again.slot()?.dataset.home, "il posto si è spostato").toBeUndefined();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      again.handles.returning?.land();
      again.up(y + 100);
    }
    expect(view.state.doc.toString()).toBe(PLAIN);
    expect(undo(view), "niente da annullare").toBe(false);
  });

  it("con frontmatter: l'ultimo sale fin sotto il frontmatter, il primo testo scende in fondo", () => {
    const view = mount(FRONT, FRONT.length, undefined, propertiesDisplay.of("visible"));
    rowsOf20(view);
    // Il frontmatter (0–60), Uno (60–80), Due (100–120), Tre (140–160).
    let hand = grab(view, 3, 150);
    hand.move(-40);
    hand.up(-40);
    expect(texts(view)).toEqual(["---\nicon: 🌿\n---", "Tre", "Uno", "Due"]);
    undo(view);
    expect(view.state.doc.toString()).toBe(FRONT);
    hand = grab(view, 1, 70);
    hand.move(300);
    hand.up(300);
    expect(texts(view)).toEqual(["---\nicon: 🌿\n---", "Due", "Tre", "Uno"]);
    undo(view);
    expect(view.state.doc.toString()).toBe(FRONT);
  });

  it("con frontmatter: Mod-Shift-↓ sull'ultimo non cambia niente, Mod-Shift-↑ lo porta fin sotto il frontmatter e non oltre", () => {
    const view = mount(FRONT, FRONT.length, undefined, propertiesDisplay.of("visible"));
    press(view, "ArrowDown", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString()).toBe(FRONT);
    for (let step = 0; step < 4; step += 1) press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(texts(view)).toEqual(["---\nicon: 🌿\n---", "Tre", "Uno", "Due"]);
  });
});

describe("i gesti ai bordi (E2): una nota di un blocco solo", () => {
  it("la presa non trova un altro posto: il rilascio non cambia niente, i tasti nemmeno, Esc lo sceglie", () => {
    const view = mount("Solo", 0);
    rowsOf20(view);
    const hand = grab(view, 0, 10);
    for (const y of [60, -60, 10]) {
      hand.move(y);
      expect(hand.slot()?.dataset.home, `a ${y} px il posto è l'origine`).toBe("true");
    }
    hand.up(10);
    hand.handles.returning?.land();
    expect(view.state.doc.toString()).toBe("Solo");
    expect(undo(view)).toBe(false);
    press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
    press(view, "ArrowDown", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString()).toBe("Solo");
    press(view, "Escape");
    expect(view.state.field(blockSelection)).not.toBeNull();
  });
});

describe("i gesti ai bordi (E2): la voce annidata", () => {
  // - a (0–20), - b (20–40), - c (40–60).
  it("24 px a destra annidano la voce sotto quella sopra, e lo dicono", () => {
    const view = mount("- a\n- b\n- c", 0);
    rowsOf20(view);
    const hand = grab(view, 2, 50);
    hand.move(50, 23);
    expect(hand.slot()?.dataset.home, "23 px non bastano").toBe("true");
    hand.move(50, 24);
    expect(hand.slot()?.dataset.home, "con 24 il posto si sposta di un rientro").toBeUndefined();
    expect(view.dom.querySelector(".cm-fub-block-live")?.textContent).toContain("b");
    hand.up(50);
    expect(view.state.doc.toString()).toBe("- a\n- b\n  - c");
    undo(view);
    expect(view.state.doc.toString()).toBe("- a\n- b\n- c");
  });

  it("24 px a sinistra portano fuori la voce annidata, subito dopo la sua", () => {
    const view = mount("- a\n  - b\n- c", 0);
    rowsOf20(view);
    const hand = grab(view, 1, 30);
    hand.move(30, -24);
    hand.up(30);
    expect(view.state.doc.toString()).toBe("- a\n- b\n- c");
  });

  it("la voce annidata si sposta fra le sue sorelle, e col trascinamento verticale non esce dal suo elenco", () => {
    const doc = "- a\n  - b\n  - c\n- d";
    const view = mount(doc, doc.indexOf("c"));
    press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString()).toBe("- a\n  - c\n  - b\n- d");
    press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString(), "la prima sorella non sale oltre la sua voce").toBe("- a\n  - c\n  - b\n- d");
    undo(view);
    expect(view.state.doc.toString()).toBe(doc);
    rowsOf20(view);
    // b (20–40) portata giù fin oltre «d»: resta l'ultima sorella di «a».
    const hand = grab(view, 1, 30);
    hand.move(200);
    hand.up(200);
    expect(view.state.doc.toString()).toBe("- a\n  - c\n  - b\n- d");
  });

  it("una voce col suo sottoalbero si sposta tutta, in fondo all'elenco", () => {
    const view = mount("- a\n  - a1\n- b", 0);
    rowsOf20(view);
    const hand = grab(view, 0, 10);
    hand.move(200);
    hand.up(200);
    expect(view.state.doc.toString()).toBe("- b\n- a\n  - a1");
  });
});

describe("i gesti ai bordi (E2): dentro e fuori dalle colonne", () => {
  const COLUMNS = "> [!columns]\n> > [!column]\n> > Sinistra\n>\n> > [!column]\n> > Destra";
  /// La colonna del testo larga 400 px: «Accanto» sta sull'ultimo ottavo, da 350.
  const wide = (view: EditorView) =>
    vi.spyOn(view.contentDOM, "getBoundingClientRect").mockReturnValue({ left: 0, right: 400, top: 0, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  const bar = (view: EditorView) => view.scrollDOM.querySelector<HTMLElement>(".cm-fub-block-drop")!;

  it("lasciato sul bordo destro di un vicino, un blocco ci fa le colonne", () => {
    const view = mount("Uno\n\nDue", 0);
    rowsOf20(view);
    wide(view);
    const hand = grab(view, 1, 50);
    hand.move(10, 360);
    expect(bar(view).hidden, "la barra verticale di «Accanto»").toBe(false);
    expect(bar(view).dataset.beside).toBe("true");
    expect(hand.slot()?.hidden, "al posto della barra, niente posto").toBe(true);
    hand.up(10);
    expect(view.state.doc.toString()).toBe("> [!columns]\n> > [!column]\n> > Uno\n>\n> > [!column]\n> > Due");
    undo(view);
    expect(view.state.doc.toString()).toBe("Uno\n\nDue");
  });

  it("delle colonne sono un blocco solo: si prendono, si spostano e si lasciano intere", () => {
    const doc = `${COLUMNS}\n\nDopo`;
    const view = mount(doc, doc.length);
    rowsOf20(view);
    expect(view.state.field(blockModel).blocks.map((block) => block.kind)).toEqual(["callout", "paragraph"]);
    const hand = grab(view, 0, 10);
    hand.move(300);
    hand.up(300);
    expect(view.state.doc.toString()).toBe(`Dopo\n\n${COLUMNS}`);
    press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("un blocco lasciato accanto alle colonne ne aggiunge una; delle colonne non vanno accanto a un blocco", () => {
    const doc = `${COLUMNS}\n\nTerza`;
    const view = mount(doc, 0);
    rowsOf20(view);
    wide(view);
    // «Terza» (riga 8, 140–160) sul bordo destro delle colonne (0–120).
    let hand = grab(view, 1, 150);
    hand.move(30, 360);
    expect(bar(view).hidden).toBe(false);
    hand.up(30);
    expect(view.state.doc.toString()).toBe(`${COLUMNS}\n>\n> > [!column]\n> > Terza`);
    undo(view);
    expect(view.state.doc.toString()).toBe(doc);
    // Le colonne sul bordo di «Terza»: nessuna barra, il posto fra i vicini.
    hand = grab(view, 0, 10);
    hand.move(150, 360);
    expect(bar(view).hidden).toBe(true);
    hand.handles.endDrag(false);
    hand.handles.returning?.land();
    expect(view.state.doc.toString()).toBe(doc);
  });
});

describe("i gesti ai bordi (E2): codice, tabella e riquadro", () => {
  const CODE = "```js\nconst a = 1;\n\nconst b = 2;\n```";
  const TABLE = "| a | b |\n| - | - |\n| 1 | 2 |";
  const CALLOUT = "> [!note] Titolo\n> testo\n>\n> altro";

  for (const [name, block] of [["il codice", CODE], ["la tabella", TABLE], ["il riquadro", CALLOUT]] as const) {
    it(`${name} va in fondo e torna su coi suoi byte, anche con righe vuote dentro; Esc lo sceglie intero`, () => {
      const doc = `${block}\n\nDopo`;
      const view = mount(doc, doc.length);
      rowsOf20(view);
      const hand = grab(view, 0, 10);
      hand.move(400);
      hand.up(400);
      expect(view.state.doc.toString()).toBe(`Dopo\n\n${block}`);
      // Il rilascio dà il fuoco all'editor: happy-dom manda allora la
      // `selectionchange` dentro l'aggiornamento, cosa che un browser non fa.
      view.contentDOM.blur();
      // Mod-Shift-↑ col cursore dentro il blocco lo riporta su.
      view.dispatch({ selection: { anchor: view.state.doc.length - 2 } });
      press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
      expect(view.state.doc.toString()).toBe(doc);
      press(view, "Escape");
      expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(block);
    });
  }

  it("fra un codice e una tabella il blocco ritrova le righe vuote che il Markdown vuole", () => {
    const doc = `Uno\n\n${CODE}\n\n${TABLE}`;
    const view = mount(doc, 0);
    rowsOf20(view);
    const hand = grab(view, 0, 10);
    // Fra il codice (righe 3–7, 40–140) e la tabella (righe 9–11, 160–220).
    hand.move(150);
    hand.up(150);
    expect(view.state.doc.toString()).toBe(`${CODE}\n\nUno\n\n${TABLE}`);
  });
});

describe("i gesti ai bordi (E2): Vim e composizione", () => {
  it("con Vim nel modo normale il trascinamento c'è ancora, e Esc a metà gesto rimette il blocco senza arrivare a Vim", () => {
    const view = mount("Uno\n\nDue", 0, vi.fn(), vim());
    rowsOf20(view);
    const seen = vi.fn();
    view.contentDOM.addEventListener("keydown", seen);
    let hand = grab(view, 0, 10);
    hand.move(100);
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(seen, "Esc è del gesto").not.toHaveBeenCalled();
    hand.handles.returning?.land();
    hand.up(100);
    expect(view.state.doc.toString()).toBe("Uno\n\nDue");
    hand = grab(view, 0, 10);
    hand.move(100);
    hand.up(100);
    expect(view.state.doc.toString()).toBe("Due\n\nUno");
    view.contentDOM.removeEventListener("keydown", seen);
  });

  it("con Vim nel modo inserimento i tasti dei Blocchi tornano, ma Esc resta di Vim", () => {
    const view = mount("Uno\n\nDue", 6, vi.fn(), vim());
    Vim.handleKey(getCM(view)!, "i", "test");
    expect((getCM(view)!.state as { vim?: { insertMode?: boolean } }).vim?.insertMode).toBe(true);
    press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString()).toBe("Due\n\nUno");
    expect(press(view, "Escape")).toBe(false);
    expect(view.state.field(blockSelection)).toBeNull();
  });

  it("durante una composizione ogni tasto dei Blocchi si fa da parte", () => {
    const doc = "Uno\n\n```\nx\n```\n\nDue";
    const view = mount(doc, doc.indexOf("Due"));
    Object.defineProperty(view, "composing", { configurable: true, get: () => true });
    for (const [key, extra] of [
      ["ArrowUp", { ctrlKey: true, shiftKey: true }],
      ["ArrowDown", { ctrlKey: true, shiftKey: true }],
      ["a", { ctrlKey: true }],
      ["d", { ctrlKey: true }],
      ["Backspace", {}],
      ["Escape", {}],
    ] as const) {
      expect(press(view, key, extra), key).toBe(false);
    }
    view.dispatch({ selection: { anchor: doc.indexOf("x") } });
    expect(press(view, "Tab"), "Tab nel codice").toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
    expect(view.state.field(blockSelection)).toBeNull();
  });
});

describe("i gesti ai bordi (E2): blocchi spenti", () => {
  function plain(doc: string, anchor = 0): EditorView {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        selection: { anchor },
        extensions: [history(), markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {} }), plainMode({ page: () => "Nota" })],
      }),
    });
    views.push(view);
    return view;
  }

  it("niente maniglie da prendere, e Mod-Shift-↑/↓ spostano la riga, fermi sulla prima e sull'ultima", () => {
    const view = plain("Uno\nDue\nTre", 0);
    expect(view.scrollDOM.querySelector(".cm-fub-block-grip")).toBeNull();
    expect(view.plugin(handlesView)).toBeNull();
    press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString(), "la prima riga non sale").toBe("Uno\nDue\nTre");
    press(view, "ArrowDown", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString()).toBe("Due\nUno\nTre");
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    press(view, "ArrowDown", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString(), "l'ultima riga non scende").toBe("Due\nUno\nTre");
  });

  it("con frontmatter la prima riga del corpo non sale nella testata, e Esc non sceglie blocchi", () => {
    const doc = "---\na: 1\n---\nUno\nDue";
    const view = plain(doc, doc.indexOf("Uno"));
    press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString()).toBe(doc);
    expect(press(view, "Escape")).toBe(false);
  });
});

describe("i gesti ai bordi (E2): due riquadri sulla stessa nota", () => {
  it("il trascinamento in uno non tocca l'altro finché dura; al rilascio l'altro riceve il testo nuovo, una volta", () => {
    const doc = "Uno\n\nDue\n\nTre";
    const other = mount(doc, 0);
    const received = vi.fn();
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        extensions: [history(), markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {} }), blocksMode({ page: () => "Nota" })],
      }),
      // La sessione del documento: ogni cambio del testo arriva all'altro
      // riquadro come cambio sincronizzato, non come una sua battuta.
      dispatchTransactions: (trs, self) => {
        self.update(trs);
        for (const tr of trs) {
          if (!tr.docChanged) continue;
          received();
          other.dispatch({ changes: tr.changes, annotations: Transaction.remote.of(true) });
        }
      },
    });
    views.push(view);
    parsedView(view);
    rowsOf20(view);
    const hand = grab(view, 0, 10);
    hand.move(60);
    hand.move(200);
    expect(received, "durante il gesto il testo non cambia").not.toHaveBeenCalled();
    expect(other.state.doc.toString()).toBe(doc);
    expect(other.scrollDOM.querySelector(".cm-fub-block-lift, .cm-fub-block-slot"), "l'altro riquadro non mostra il gesto").toBeNull();
    hand.up(200);
    expect(received).toHaveBeenCalledTimes(1);
    expect(other.state.doc.toString()).toBe("Due\n\nTre\n\nUno");
    expect(view.state.doc.toString()).toBe("Due\n\nTre\n\nUno");
  });
});

describe("i gesti ai bordi (E2): dentro una scheda di nota della lavagna (A-6, regola 3)", () => {
  it("con lo zoom il gesto si conta in px suoi; Esc a metà gesto rimette il blocco e non esce dalla scheda", () => {
    const view = mount("Uno\n\nDue\n\nTre", 0, vi.fn(), [], { escapeLeaves: true });
    rowsOf20(view);
    Object.defineProperty(view, "scaleX", { value: 0.5, configurable: true });
    Object.defineProperty(view, "scaleY", { value: 0.5, configurable: true });
    const host = vi.fn();
    view.dom.addEventListener("keydown", host);
    let hand = grab(view, 0, 5);
    hand.move(60);
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(host, "l'ospite non vede l'Esc del gesto").not.toHaveBeenCalled();
    hand.handles.returning?.land();
    hand.up(60);
    expect(view.state.doc.toString()).toBe("Uno\n\nDue\n\nTre");
    // A 60 px di schermo, 120 di CodeMirror: in fondo.
    hand = grab(view, 0, 5);
    hand.move(60);
    hand.up(60);
    expect(view.state.doc.toString()).toBe("Due\n\nTre\n\nUno");
    // Fuori dal gesto Esc è di nuovo dell'ospite.
    expect(press(view, "Escape")).toBe(false);
    view.dom.removeEventListener("keydown", host);
  });
});

describe("i gesti ai bordi (E2): il posto interrotto a metà corsa", () => {
  afterEach(() => setMotionDriver(null));

  it("il posto che torna indietro mentre scivola riparte da dove lo si vede, senza salti", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    // Uno (0–20), Due (40–60), Tre (80–100), Quattro (120–140).
    const view = mount("Uno\n\nDue\n\nTre\n\nQuattro", 0);
    rowsOf20(view);
    const hand = grab(view, 0, 10);
    hand.move(14);
    // Oltre Due e Tre: il posto scivola giù.
    hand.move(95);
    const slot = hand.slot()!;
    expect(slot.dataset.home).toBeUndefined();
    driver.advance(80);
    const seen = () => parseFloat(slot.style.top) + (liveState(slot)?.pose.y ?? 0);
    const before = seen();
    const top = slot.style.top;
    // Di nuovo verso l'origine, a metà corsa.
    hand.move(14);
    expect(slot.style.top, "il posto è cambiato").not.toBe(top);
    expect(Math.abs(seen() - before), "il posto prosegue da dov'era").toBeLessThan(0.5);
    hand.handles.endDrag(false);
  });

  it("a posto fermo la corsa del posto non riparte, anche se il browser arrotonda la sua posizione", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    // Righe di 20 px che partono da 1000,3125: posizioni con più di sei cifre,
    // come quelle di una nota vera. Uno (1000–1020), Due (1040–1060), …
    const view = mount("Uno\n\nDue\n\nTre\n\nQuattro", 0);
    vi.spyOn(view, "lineBlockAt").mockImplementation((pos: number) => {
      const top = 1000.3125 + (view.state.doc.lineAt(pos).number - 1) * 20;
      return { from: 0, to: 0, top, bottom: top + 20, height: 20, type: 0, widget: null, widgetLineBreaks: 0 } as ReturnType<EditorView["lineBlockAt"]>;
    });
    const hand = grab(view, 0, 1010);
    hand.move(1014);
    const slot = hand.slot()!;
    // Chromium scrive le lunghezze dello stile in linea con sei cifre
    // significative (1080.3125 diventa «1080.31px»); happy-dom no.
    const style = slot.style;
    Object.defineProperty(slot, "style", {
      configurable: true,
      value: new Proxy(style, {
        get: (target, key) => {
          const value: unknown = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
        set: (target, key, value: string) => Reflect.set(target, key, key === "top" ? `${Number(parseFloat(value).toPrecision(6))}px` : value),
      }),
    });
    // Oltre Due e Tre: il posto scivola giù, una volta.
    hand.move(1095);
    expect(parseFloat(slot.style.top), "la posizione riletta è arrotondata").toBe(1080.31);
    driver.advance(150);
    expect(liveState(slot), "a metà corsa").not.toBeNull();
    // Il puntatore si muove ancora, il posto no: la corsa non deve ripartire.
    hand.move(1096);
    hand.move(1097);
    hand.move(1098);
    driver.advance(160);
    expect(liveState(slot), "310 ms dopo il cambio di posto la corsa di 300 ms è finita").toBeNull();
    hand.handles.endDrag(false);
  });

  it("il cartellino che torna nel testo mentre ancora rimpicciolisce riparte dalla grandezza che si vede", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    const view = mount("Uno\n\nDue\n\nTre", 0);
    rowsOf20(view);
    const hand = grab(view, 0, 10);
    hand.move(14);
    const card = view.scrollDOM.querySelector<HTMLElement>(".cm-fub-block-lift-card")!;
    driver.advance(400);
    // Fuori dal testo: il cartellino cala dalla grandezza di presa alla sua.
    hand.move(14, 200);
    const lift = hand.lift()!;
    expect(lift.dataset.free).toBe("true");
    const free = Number(lift.style.getPropertyValue("--fub-block-free-scale"));
    driver.advance(80);
    const before = free * (liveState(card)?.pose.scaleX ?? 1);
    // Di nuovo nel testo, a metà corsa.
    hand.move(14, 0);
    expect(lift.dataset.free).toBeUndefined();
    const after = LIFT_SCALE * (liveState(card)?.pose.scaleX ?? 1);
    expect(Math.abs(after - before), "la carta prosegue dalla grandezza di adesso").toBeLessThan(0.005);
    hand.handles.endDrag(false);
  });
});

// La regola al tocco (T26a, E18 «Al tocco»): senza un puntatore che passi
// sopra le cose, il «+» e la maniglia stanno sul blocco del cursore.
describe("al tocco", () => {
  /// Un sistema finto: `pointer` dice se c'è un puntatore (`any-hover`), e
  /// `connect` lo cambia come un mouse collegato o staccato.
  function screen(pointer: boolean) {
    const listeners = new Set<() => void>();
    const query = {
      get matches() {
        return pointer;
      },
      media: "(any-hover: hover)",
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    };
    const other = (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal("matchMedia", (media: string) => (media === "(any-hover: hover)" ? query : other(media)));
    return {
      connect(next: boolean) {
        pointer = next;
        for (const listener of [...listeners]) listener();
      },
      listeners,
    };
  }
  afterEach(() => vi.unstubAllGlobals());

  /// Il testo del blocco che le maniglie servono adesso.
  const served = (view: EditorView): string | null => {
    const index = view.plugin(handlesView)!.current();
    if (index < 0) return null;
    const block = view.state.field(blockModel).blocks[index]!;
    return view.state.sliceDoc(block.from, block.to);
  };
  const keyOfText = (view: EditorView, text: string) => {
    const block = view.state.field(blockModel).blocks.find((each) => view.state.sliceDoc(each.from, each.to) === text)!;
    return { from: block.from, depth: block.depth };
  };

  it("la maniglia segue il cursore, e il passaggio non la sposta", () => {
    screen(false);
    const view = mount("Uno\n\nDue\n\nTre", 1);
    view.focus();
    const handles = view.plugin(handlesView)!;
    expect(view.dom.classList.contains("cm-fub-blocks-touch")).toBe(true);
    expect(handles.hoverable).toBe(false);
    expect(served(view)).toBe("Uno");
    view.dispatch({ selection: { anchor: 6 } });
    expect(served(view)).toBe("Due");
    // Dopo un tocco il sistema manda anche gli eventi del mouse: un blocco
    // «sotto il puntatore» non porta via la maniglia dal cursore.
    handles.hovered = keyOfText(view, "Tre");
    expect(served(view)).toBe("Due");
    // Senza il fuoco (il dito è andato altrove) non c'è.
    view.contentDOM.blur();
    expect(served(view)).toBeNull();
  });

  it("col puntatore vale il puntatore, anche se arriva a nota aperta", () => {
    const system = screen(false);
    const view = mount("Uno\n\nDue\n\nTre", 1);
    view.focus();
    const handles = view.plugin(handlesView)!;
    // Un tablet a cui si collega un mouse: la regola cambia subito.
    system.connect(true);
    expect(view.dom.classList.contains("cm-fub-blocks-touch")).toBe(false);
    expect(handles.hoverable).toBe(true);
    handles.hovered = keyOfText(view, "Tre");
    expect(served(view)).toBe("Tre");
    // Staccato, si torna al cursore, e il passaggio di prima non conta più.
    system.connect(false);
    expect(view.dom.classList.contains("cm-fub-blocks-touch")).toBe(true);
    expect(handles.hovered).toBeNull();
    expect(served(view)).toBe("Uno");
    // Chiusa la nota, il sistema non ha più nessuno da avvisare.
    view.destroy();
    views.splice(views.indexOf(view), 1);
    expect(system.listeners.size).toBe(0);
  });

  it("il dito tenuto 300 ms prende il blocco, con un colpetto; un movimento prima scorre", () => {
    vi.useFakeTimers();
    try {
      const vibrate = vi.fn(() => true);
      vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { vibrate }));
      screen(false);
      const view = mount("Uno\n\nDue\n\nTre", 1);
      rowsOf20(view);
      const handles = view.plugin(handlesView)!;
      handles.shown = keyOfText(view, "Uno");
      const grip = view.dom.querySelector<HTMLElement>(".cm-fub-block-grip")!;
      const finger = (type: string, y: number) =>
        grip.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 7, pointerType: "touch", clientX: 0, clientY: y }));
      // Il dito si muove prima dei 300 ms: è uno scorrimento, il gesto non parte.
      finger("pointerdown", 10);
      vi.advanceTimersByTime(100);
      finger("pointermove", 30);
      vi.advanceTimersByTime(400);
      expect(handles.drag).toBeNull();
      expect(view.scrollDOM.querySelector(".cm-fub-block-lift")).toBeNull();
      expect(vibrate).not.toHaveBeenCalled();
      // Tenuto fermo: a 299 ms ancora niente, a 300 il blocco è in mano.
      handles.shown = keyOfText(view, "Uno");
      finger("pointerdown", 10);
      vi.advanceTimersByTime(299);
      expect(handles.drag?.moving).toBe(false);
      vi.advanceTimersByTime(1);
      expect(handles.drag?.moving).toBe(true);
      expect(view.dom.classList.contains("cm-fub-blocks-dragging")).toBe(true);
      expect(vibrate).toHaveBeenCalledTimes(1);
      handles.endDrag(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
