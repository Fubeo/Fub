// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { cursorCharLeft, cursorCharRight, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { markdownGrammar } from "./grammar";
import { createTextEngine } from "../../engine";
import { livePreview, pageIconsChanged } from "./livepreview";
import { liveReveal, type RevealPolicy } from "../../live-reveal";
import { closeContextMenu } from "../../../../ui/menu";

// I diagrammi del test non passano da Mermaid: basta un'immagine qualsiasi.
vi.mock("mermaid", () => ({
  default: {
    initialize() {},
    render: async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>' }),
  },
}));

const source = "Titolo\n\n- [ ] Fare";

function editor(readOnly = false) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const engine = createTextEngine(parent, {
    onChange() {},
    onSelectionChange() {},
    extensions: () => [
      markdown({ base: markdownGrammar }),
      livePreview({ openWikilink() {}, searchTag() {} }),
      EditorState.readOnly.of(readOnly),
    ],
  });
  engine.setDoc(source);
  return {
    engine,
    checkbox: () => parent.querySelector<HTMLInputElement>('input[type="checkbox"]')!,
    destroy() { engine.destroy(); parent.remove(); },
  };
}

function click(box: HTMLInputElement) {
  box.click();
}

describe("checkbox Live Preview", () => {
  it("in sola lettura non cambia né il testo né lo stato visibile", () => {
    const mounted = editor(true);
    try {
      click(mounted.checkbox());
      expect(mounted.engine.getDoc()).toBe(source);
      expect(mounted.checkbox().checked).toBe(false);
    } finally {
      mounted.destroy();
    }
  });

  it("il click aggiorna il documento una volta e partecipa a undo e redo", () => {
    const mounted = editor();
    try {
      click(mounted.checkbox());
      expect(mounted.engine.getDoc()).toBe("Titolo\n\n- [x] Fare");
      expect(mounted.checkbox().checked).toBe(true);
      mounted.engine.undo();
      expect(mounted.engine.getDoc()).toBe(source);
      expect(mounted.checkbox().checked).toBe(false);
      mounted.engine.redo();
      expect(mounted.engine.getDoc()).toBe("Titolo\n\n- [x] Fare");
      expect(mounted.checkbox().checked).toBe(true);
    } finally {
      mounted.destroy();
    }
  });
});

describe("Live ibrida: testo nativo, widget solo non testuali", () => {
  function editorWith(source: string, policy?: RevealPolicy) {
    const parent = document.createElement("div");
    document.body.append(parent);
    const engine = createTextEngine(parent, {
      onChange() {},
      onSelectionChange() {},
      extensions: () => [
        markdown({ base: markdownGrammar }),
        livePreview({ openWikilink() {}, searchTag() {} }),
        ...(policy ? [Prec.highest(liveReveal.of(policy))] : []),
      ],
    });
    engine.setDoc(source);
    return { parent, engine, cleanup: () => { engine.destroy(); parent.remove(); } };
  }
  it("con «mai» un paragrafo di sole immagini resta testo, con l'immagine figura in riga (D8, K10)", () => {
    const { parent, engine, cleanup } = editorWith("Testo sopra\n\n![Schema](schema.png)\n\nTesto sotto ![a](b.png)\n");
    try {
      expect(parent.querySelectorAll(".cm-markdown-block").length).toBe(0);
      expect(parent.querySelector(".cm-fub-image figure figcaption")?.textContent).toBe("Schema");
      engine.revealByteOffset("Testo sopra\n\n![".length);
      expect(parent.querySelectorAll(".cm-fub-image").length).toBe(2);
    } finally {
      cleanup();
    }
  });

  it("con «riga» un paragrafo di sole immagini è reso fuori dal cursore, sorgente col cursore dentro", () => {
    const { parent, engine, cleanup } = editorWith("Testo sopra\n\n![Schema](schema.png)\n\nTesto sotto ![a](b.png)\n", "riga");
    try {
      // Il cursore sta in cima (setDoc): l'immagine sola diventa un blocco,
      // quella in mezzo alla prosa resta testo.
      expect(parent.querySelectorAll(".cm-markdown-block").length).toBe(1);
      engine.revealByteOffset("Testo sopra\n\n![".length);
      expect(parent.querySelectorAll(".cm-markdown-block").length).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("il cursore che entra, gira ed esce da un blocco reso lo segue ogni volta", () => {
    const { parent, engine, cleanup } = editorWith("Testo sopra\n\n![Schema](schema.png)\n\nTesto sotto\n", "riga");
    const blocks = () => parent.querySelectorAll(".cm-markdown-block").length;
    try {
      expect(blocks()).toBe(1);
      // Una selezione che non tocca il blocco non cambia niente.
      engine.revealByteOffset("Testo".length);
      expect(blocks()).toBe(1);
      engine.revealByteOffset("Testo sopra\n\n![".length);
      expect(blocks()).toBe(0);
      engine.revealByteOffset("Testo sopra\n\n![Schema](schema.png)\n\nTesto".length);
      expect(blocks()).toBe(1);
      engine.revealByteOffset("Testo sopra\n\n![Sc".length);
      expect(blocks()).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("titoli, elenchi e codice restano testo: nessun widget di blocco", () => {
    const { parent, cleanup } = editorWith("Titolo uno\n\n- uno\n- due\n\n```bash\necho uno\n```\n");
    try {
      expect(parent.querySelectorAll(".cm-markdown-block").length).toBe(0);
      expect(parent.querySelectorAll(".cm-line").length).toBeGreaterThan(3);
    } finally {
      cleanup();
    }
  });
});

describe("wikilink in Live", () => {
  it("porta il bersaglio nel contratto della Lettura, letto con la grammatica del profilo", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const engine = createTextEngine(parent, {
      onChange() {},
      onSelectionChange() {},
      extensions: () => [
        markdown({ base: markdownGrammar }),
        livePreview({ openWikilink() {}, searchTag() {} }),
      ],
    });
    try {
      engine.setDoc("Primo\n\nVai a [[Nota#Sez^b1|la nota]] e [[Altra]]");
      const links = [...parent.querySelectorAll<HTMLElement>(".cm-fub-wikilink")];
      expect(links.map((link) => [
        link.dataset.wikilinkPage,
        link.dataset.wikilinkHeading,
        link.dataset.wikilinkBlock,
      ])).toEqual([["Nota", "Sez", "b1"], ["Altra", undefined, undefined]]);
    } finally {
      engine.destroy();
      parent.remove();
    }
  });

  it("porta l'icona della pagina nominata, e la cambia quando le icone cambiano (K9)", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const icons = new Map([["Nota", "🌱"]]);
    const engine = createTextEngine(parent, {
      onChange() {},
      onSelectionChange() {},
      extensions: () => [
        markdown({ base: markdownGrammar }),
        livePreview({ openWikilink() {}, searchTag() {}, pageIcon: (page) => icons.get(page) ?? null }),
      ],
    });
    const marks = () => [...parent.querySelectorAll<HTMLElement>(".cm-fub-wikilink")].map((link) => link.dataset.pageIcon);
    try {
      engine.setDoc("Primo\n\nVai a [[Nota|la nota]], [[Altra]] e [[#Sez]]");
      expect(marks()).toEqual(["🌱", undefined, undefined]);
      icons.set("Altra", "📦");
      engine.runViewCommand((view) => {
        view.dispatch({ effects: pageIconsChanged.of(null) });
        return true;
      });
      expect(marks()).toEqual(["🌱", "📦", undefined]);
      // L'icona non è testo: il documento resta quello scritto.
      expect(engine.getDoc()).toBe("Primo\n\nVai a [[Nota|la nota]], [[Altra]] e [[#Sez]]");
    } finally {
      engine.destroy();
      parent.remove();
    }
  });

  it("mostra come pastiglia il link a una persona, e la rifà quando la cartella cambia (K5)", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    let folder = "Persone";
    const engine = createTextEngine(parent, {
      onChange() {},
      onSelectionChange() {},
      extensions: () => [
        markdown({ base: markdownGrammar }),
        livePreview({ openWikilink() {}, searchTag() {}, isPerson: (page) => page.startsWith(`${folder}/`) }),
      ],
    });
    const people = () => [...parent.querySelectorAll<HTMLElement>(".cm-fub-wikilink")].map((link) => link.classList.contains("cm-fub-person"));
    try {
      engine.setDoc("Primo\n\nCon [[Persone/Anna|Anna]] e [[Gente/Lia|Lia]]");
      expect(people()).toEqual([true, false]);
      folder = "Gente";
      engine.runViewCommand((view) => {
        view.dispatch({ effects: pageIconsChanged.of(null) });
        return true;
      });
      expect(people()).toEqual([false, true]);
    } finally {
      engine.destroy();
      parent.remove();
    }
  });

  it("dà al testo colorato le classi del tag e nasconde i tag (K1)", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const engine = createTextEngine(parent, {
      onChange() {},
      onSelectionChange() {},
      extensions: () => [markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {} })],
    });
    try {
      engine.setDoc('Primo\n\nUn <span class="fub-color-red">rosso</span> e <mark class="fub-bg-blue fub-color-gray">blu</mark> e <span class="altro">x</span>');
      const red = parent.querySelector<HTMLElement>("span.fub-color-red");
      expect(red?.textContent).toBe("rosso");
      const blue = parent.querySelector<HTMLElement>("mark.fub-bg-blue");
      expect(blue?.classList.contains("fub-color-gray")).toBe(true);
      expect(blue?.textContent).toBe("blu");
      expect(parent.querySelector(".altro")).toBeNull();
      expect(parent.querySelector(".cm-content")?.textContent).not.toContain("fub-color-red");
    } finally {
      engine.destroy();
      parent.remove();
    }
  });
});

describe("tabelle in Live", () => {
  const table = "Testo\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n";
  function editorWith(doc: string) {
    const parent = document.createElement("div");
    document.body.append(parent);
    const engine = createTextEngine(parent, {
      onChange() {},
      onSelectionChange() {},
      extensions: () => [
        markdown({ base: markdownGrammar }),
        livePreview({ openWikilink() {}, searchTag() {} }),
      ],
    });
    engine.setDoc(doc);
    const cell = (row: number, col: number) =>
      parent.querySelector<HTMLElement>(`.tb-grid [data-row="${row}"][data-col="${col}"]`)!;
    return { parent, engine, cell, cleanup: () => { engine.destroy(); parent.remove(); } };
  }

  it("sono griglie anche col cursore dentro, e non tornano sorgente", () => {
    const { parent, engine, cell, cleanup } = editorWith(table);
    try {
      expect(parent.querySelectorAll(".tb-frame").length).toBe(1);
      expect(cell(1, 1).textContent).toBe("2");
      engine.revealByteOffset("Testo\n\n| a | b |\n| --- | --- |\n| ".length);
      expect(parent.querySelectorAll(".tb-frame").length).toBe(1);
      expect(parent.querySelectorAll(".cm-markdown-block").length).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("scrivere in una cella cambia soltanto quella cella, e annulla la riporta", () => {
    const { parent, engine, cell, cleanup } = editorWith(table);
    try {
      const grid = parent.querySelector<HTMLElement>(".tb-grid")!;
      cell(1, 0).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
      grid.dispatchEvent(new KeyboardEvent("keydown", { key: "u", bubbles: true, cancelable: true }));
      const input = cell(1, 0).querySelector("input")!;
      input.value = "uno";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      expect(engine.getDoc()).toBe("Testo\n\n| a | b |\n| --- | --- |\n| uno | 2 |\n");
      expect(cell(1, 0).textContent).toBe("uno");
      engine.undo();
      expect(engine.getDoc()).toBe(table);
      expect(cell(1, 0).textContent).toBe("1");
    } finally {
      cleanup();
    }
  });

  it("una riga aggiunta dalla griglia riscrive la tabella in forma canonica", () => {
    const { parent, engine, cleanup } = editorWith("|a|b|\n|---|---|\n|1|2|\n\nFine");
    try {
      const add = parent.querySelector<HTMLButtonElement>('.tb-add[data-add="row"]')!;
      add.click();
      expect(engine.getDoc()).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n|  |  |\n\nFine");
      expect(parent.querySelectorAll(".tb-grid tbody tr").length).toBe(3);
    } finally {
      cleanup();
    }
  });
});

describe("un blocco reso spostato da una modifica sopra", () => {
  it("tiene il suo DOM e rimette le coordinate al posto nuovo", () => {
    const note = "Testo\n\n> [!note] Titolo\n> corpo\n\nFine";
    const parent = document.createElement("div");
    document.body.append(parent);
    const engine = createTextEngine(parent, {
      onChange() {},
      onSelectionChange() {},
      extensions: () => [markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {} })],
    });
    try {
      engine.setDoc(note);
      const before = parent.querySelector<HTMLElement>(".cm-markdown-block")!;
      const from = note.indexOf(">");
      expect(before.dataset.sourceFrom).toBe(String(from));
      expect(before.querySelector<HTMLElement>("[data-md-from]")!.dataset.mdFrom).toBe(String(from));
      const view = EditorView.findFromDOM(parent.querySelector(".cm-editor")!)!;
      view.dispatch({ changes: { from: 0, insert: "Più " }, selection: { anchor: 4 } });
      const after = parent.querySelector<HTMLElement>(".cm-markdown-block")!;
      expect(after).toBe(before);
      expect(after.dataset.sourceFrom).toBe(String(from + 4));
      expect(after.querySelector<HTMLElement>("[data-md-from]")!.dataset.mdFrom).toBe(String(from + 4));
    } finally {
      engine.destroy();
      parent.remove();
    }
  });
});

describe("un diagramma in Live", () => {
  const note = "Testo\n\n```mermaid\nflowchart LR\nA-->B\n```\n\nFine";

  function mountNote(readOnly: boolean) {
    const parent = document.createElement("div");
    document.body.append(parent);
    const engine = createTextEngine(parent, {
      onChange() {},
      onSelectionChange() {},
      extensions: () => [
        markdown({ base: markdownGrammar }),
        livePreview({ openWikilink() {}, searchTag() {} }),
        EditorState.readOnly.of(readOnly),
      ],
    });
    engine.setDoc(note);
    return { parent, engine, cleanup: () => { closeContextMenu(); engine.destroy(); parent.remove(); } };
  }

  function openStyleMenu(parent: HTMLElement): void {
    parent.querySelector<HTMLButtonElement>(".mermaid-diagram .mermaid-action")!.click();
  }

  it("«Solo per questo diagramma» scrive la direttiva in cima al recinto, e la toglie", () => {
    const { parent, engine, cleanup } = mountNote(false);
    try {
      expect(parent.querySelector(".mermaid-diagram")).not.toBeNull();
      openStyleMenu(parent);
      document.querySelector<HTMLButtonElement>('#context-menu [role="menuitemcheckbox"]')!.click();
      expect(engine.getDoc()).toBe("Testo\n\n```mermaid\n%% stile: armonia\nflowchart LR\nA-->B\n```\n\nFine");
      // Il widget rinasce dal nuovo sorgente: adesso lo stile è suo.
      openStyleMenu(parent);
      const radios = [...document.querySelectorAll<HTMLButtonElement>('#context-menu [role="menuitemradio"]')];
      radios[2]!.click();
      expect(engine.getDoc()).toBe("Testo\n\n```mermaid\n%% stile: aurora\nflowchart LR\nA-->B\n```\n\nFine");
      openStyleMenu(parent);
      document.querySelector<HTMLButtonElement>('#context-menu [role="menuitemcheckbox"]')!.click();
      expect(engine.getDoc()).toBe(note);
    } finally {
      cleanup();
    }
  });

  it("in sola lettura il sorgente non si scrive", () => {
    const { parent, engine, cleanup } = mountNote(true);
    try {
      openStyleMenu(parent);
      expect(document.querySelector('#context-menu [role="menuitemcheckbox"]')).toBeNull();
      expect(engine.getDoc()).toBe(note);
    } finally {
      cleanup();
    }
  });
});

describe("un'immagine in mezzo al testo, in Live", () => {
  const note = "Il logo ![Marchio|120](Risorse/logo.png) in riga\n\nAltro";

  function mountNote(policy: RevealPolicy = "riga") {
    const parent = document.createElement("div");
    document.body.append(parent);
    const mounted: { html: string; container: HTMLElement; disposed: boolean }[] = [];
    const engine = createTextEngine(parent, {
      onChange() {},
      onSelectionChange() {},
      extensions: () => [
        markdown({ base: markdownGrammar }),
        Prec.highest(liveReveal.of(policy)),
        livePreview({
          openWikilink() {},
          searchTag() {},
          // La resa vera sanifica e idrata; qui basta sapere chi è montato e
          // quando si smonta.
          mountRendered(container, html) {
            const record = { html, container, disposed: false };
            mounted.push(record);
            container.innerHTML = '<img alt="Marchio" data-vault-id="Risorse/logo.png">';
            return () => { record.disposed = true; };
          },
        }),
      ],
    });
    engine.setDoc(note);
    const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
    view.dispatch({ selection: { anchor: note.length } });
    return { parent, engine, view, mounted, cleanup: () => { engine.destroy(); parent.remove(); } };
  }

  it("fuori dal cursore la resa monta l'HTML di Lettura; col cursore sopra torna sorgente", () => {
    const { parent, view, mounted, cleanup } = mountNote();
    try {
      const widget = parent.querySelector<HTMLElement>(".cm-line .cm-fub-image");
      expect(widget).not.toBeNull();
      expect(mounted).toHaveLength(1);
      expect(mounted[0]!.html).toBe('<img src="Risorse/logo.png" alt="Marchio" width="120">');
      expect(mounted[0]!.container).toBe(widget);
      expect(parent.querySelector(".cm-line")!.textContent).toBe("Il logo  in riga");

      view.dispatch({ selection: { anchor: 3 } });
      expect(parent.querySelector(".cm-fub-image")).toBeNull();
      expect(mounted[0]!.disposed).toBe(true);
      expect(parent.querySelector(".cm-line")!.textContent).toBe("Il logo ![Marchio|120](Risorse/logo.png) in riga");
    } finally {
      cleanup();
    }
  });

  it("con «mai» l'immagine resta resa anche col cursore accanto; selezionarla non la rimonta", () => {
    const { parent, view, mounted, cleanup } = mountNote("mai");
    try {
      view.dispatch({ selection: { anchor: 3 } });
      expect(parent.querySelector(".cm-fub-image")).not.toBeNull();
      expect(mounted[0]!.disposed).toBe(false);
      const from = note.indexOf("![");
      view.dispatch({ selection: { anchor: from } });
      expect(parent.querySelector(".cm-fub-image")).not.toBeNull();
      view.dispatch({ selection: { anchor: from, head: note.indexOf(") in") + 1 } });
      expect(parent.querySelector(".cm-fub-image.cm-fub-image-selected")).not.toBeNull();
      expect(mounted).toHaveLength(1);
      expect(mounted[0]!.disposed).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("scrivere altrove non rimonta l'immagine, cambiarla sì", () => {
    const { view, mounted, cleanup } = mountNote();
    try {
      view.dispatch({ changes: { from: note.length, insert: " e poi" }, selection: { anchor: note.length + 6 } });
      expect(mounted).toHaveLength(1);
      expect(mounted[0]!.disposed).toBe(false);

      const at = note.indexOf("120");
      view.dispatch({ changes: { from: at, to: at + 3, insert: "240" } });
      expect(mounted).toHaveLength(2);
      expect(mounted[0]!.disposed).toBe(true);
      expect(mounted[1]!.html).toContain('width="240"');
    } finally {
      cleanup();
    }
  });

  it("Mod-clic sull'immagine è della resa: l'editor non sposta il cursore", () => {
    const { parent, view, cleanup } = mountNote();
    try {
      const image = parent.querySelector<HTMLImageElement>(".cm-fub-image img")!;
      image.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, ctrlKey: true }));
      expect(view.state.selection.main.head).toBe(note.length);
      expect(parent.querySelector(".cm-fub-image")).not.toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("con «mai», accanto ai segni nascosti", () => {
  function mount(doc: string, cursor: number) {
    const parent = document.createElement("div");
    document.body.append(parent);
    const engine = createTextEngine(parent, {
      onChange() {},
      onSelectionChange() {},
      extensions: () => [
        markdown({ base: markdownGrammar }),
        Prec.highest(liveReveal.of("mai")),
        livePreview({ openWikilink() {}, searchTag() {} }),
      ],
    });
    engine.setDoc(doc);
    const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
    view.dispatch({ selection: { anchor: cursor } });
    const press = (key: string) => runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor");
    return { view, press, cleanup: () => { engine.destroy(); parent.remove(); } };
  }

  // Un segno per riga della tabella: la fine dell'elemento è un punto solo a
  // schermo e due nel file.
  const signs = [
    ["grassetto", "a **treno** b", "**"],
    ["corsivo", "a *treno* b", "*"],
    ["barrato", "a ~~treno~~ b", "~~"],
    ["apice", "a ^treno^ b", "^"],
    ["pedice", "a ~treno~ b", "~"],
    ["codice", "a `treno` b", "`"],
  ] as const;
  for (const [name, doc, sign] of signs) {
    it(`${name}: le due fermate al bordo, Backspace e Canc saltano il segno`, () => {
      const inside = doc.indexOf("treno") + 5;
      const outside = inside + sign.length;
      const { view, press, cleanup } = mount(doc, inside);
      try {
        // Da dentro, la prima → porta fuori, di là dal segno.
        cursorCharRight(view);
        expect(view.state.selection.main.head).toBe(outside);
        // Da fuori, ← rientra.
        cursorCharLeft(view);
        expect(view.state.selection.main.head).toBe(inside);
        // Backspace da fuori salta il segno e cancella la lettera.
        view.dispatch({ selection: { anchor: outside } });
        expect(press("Backspace")).toBe(true);
        expect(view.state.doc.toString()).toBe(doc.replace("treno", "tren"));
        expect(view.state.selection.main.head).toBe(inside - 1);
        // Canc prima del segno d'apertura lo salta e cancella la prima lettera.
        const opening = doc.indexOf(sign);
        view.dispatch({ selection: { anchor: opening } });
        expect(press("Delete")).toBe(true);
        expect(view.state.doc.toString()).toBe(doc.replace("treno", "ren"));
      } finally {
        cleanup();
      }
    });
  }

  it("l'ultima lettera di un elemento porta via i suoi segni, anche annidati", () => {
    const { view, press, cleanup } = mount("a **x** b", 5);
    try {
      expect(press("Backspace")).toBe(true);
      expect(view.state.doc.toString()).toBe("a  b");
      expect(view.state.selection.main.head).toBe(2);
      undo(view);
      expect(view.state.doc.toString()).toBe("a **x** b");
    } finally {
      cleanup();
    }
    const nested = mount("a ***x*** b", 6);
    try {
      expect(nested.press("Backspace")).toBe(true);
      expect(nested.view.state.doc.toString()).toBe("a  b");
    } finally {
      nested.cleanup();
    }
  });

  it("lontano dai segni Backspace resta quello di sempre", () => {
    const { view, press, cleanup } = mount("a **treno** b", 7);
    try {
      press("Backspace");
      expect(view.state.doc.toString()).toBe("a **trno** b");
      view.dispatch({ selection: { anchor: 1, head: 4 } });
      press("Backspace");
      expect(view.state.doc.toString()).toBe("atrno** b");
    } finally {
      cleanup();
    }
  });
});

describe("la rivelazione e la composizione", () => {
  it("durante una composizione niente si rivela, e a compositionend sì", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const engine = createTextEngine(parent, {
      onChange() {},
      onSelectionChange() {},
      extensions: () => [
        markdown({ base: markdownGrammar }),
        Prec.highest(liveReveal.of("elemento")),
        livePreview({ openWikilink() {}, searchTag() {} }),
      ],
    });
    try {
      engine.setDoc("a **treno** b");
      const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
      view.dispatch({ selection: { anchor: 0 } });
      const text = () => parent.querySelector(".cm-line")!.textContent;
      expect(text()).toBe("a treno b");
      view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      expect(view.compositionStarted).toBe(true);
      view.dispatch({ selection: { anchor: 6 } });
      expect(text()).toBe("a treno b");
      view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      await vi.waitFor(() => expect(text()).toBe("a **treno** b"));
    } finally {
      engine.destroy();
      parent.remove();
    }
  });
});
