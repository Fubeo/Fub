// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { createTextEngine } from "../../engine";
import { livePreview } from "./livepreview";

const source = "Titolo\n\n- [ ] Fare";

function editor(readOnly = false) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const engine = createTextEngine(parent, {
    onChange() {},
    onSelectionChange() {},
    extensions: () => [
      markdown({ base: markdownLanguage }),
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
        markdown({ base: markdownLanguage }),
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
