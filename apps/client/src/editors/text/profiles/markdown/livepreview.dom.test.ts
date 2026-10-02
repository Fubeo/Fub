// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { markdownGrammar } from "./grammar";
import { createTextEngine } from "../../engine";
import { livePreview } from "./livepreview";
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
  function editorWith(source: string) {
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
    engine.setDoc(source);
    return { parent, engine, cleanup: () => { engine.destroy(); parent.remove(); } };
  }
  it("un paragrafo di sole immagini è reso fuori dal cursore, sorgente col cursore dentro", () => {
    const { parent, engine, cleanup } = editorWith("Testo sopra\n\n![Schema](schema.png)\n\nTesto sotto ![a](b.png)\n");
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
    const { parent, engine, cleanup } = editorWith("Testo sopra\n\n![Schema](schema.png)\n\nTesto sotto\n");
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
      parent.querySelector<HTMLElement>(`.cm-md-grid [data-row="${row}"][data-col="${col}"]`)!;
    return { parent, engine, cell, cleanup: () => { engine.destroy(); parent.remove(); } };
  }

  it("sono griglie anche col cursore dentro, e non tornano sorgente", () => {
    const { parent, engine, cell, cleanup } = editorWith(table);
    try {
      expect(parent.querySelectorAll(".cm-md-grid-block").length).toBe(1);
      expect(cell(1, 1).textContent).toBe("2");
      engine.revealByteOffset("Testo\n\n| a | b |\n| --- | --- |\n| ".length);
      expect(parent.querySelectorAll(".cm-md-grid-block").length).toBe(1);
      expect(parent.querySelectorAll(".cm-markdown-block").length).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("scrivere in una cella cambia soltanto quella cella, e annulla la riporta", () => {
    const { parent, engine, cell, cleanup } = editorWith(table);
    try {
      const grid = parent.querySelector<HTMLElement>(".cm-md-grid")!;
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
      const add = parent.querySelector<HTMLButtonElement>('.cm-md-grid-add[data-add="row"]')!;
      add.click();
      expect(engine.getDoc()).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n|  |  |\n\nFine");
      expect(parent.querySelectorAll(".cm-md-grid tbody tr").length).toBe(3);
    } finally {
      cleanup();
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

  function mountNote() {
    const parent = document.createElement("div");
    document.body.append(parent);
    const mounted: { html: string; container: HTMLElement; disposed: boolean }[] = [];
    const engine = createTextEngine(parent, {
      onChange() {},
      onSelectionChange() {},
      extensions: () => [
        markdown({ base: markdownGrammar }),
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
