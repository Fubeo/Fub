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
    checkbox: () => parent.querySelector<HTMLInputElement>(".cm-fub-checkbox")!,
    destroy() { engine.destroy(); parent.remove(); },
  };
}

function click(box: HTMLInputElement) {
  box.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
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
