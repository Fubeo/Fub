// @vitest-environment happy-dom
//
// Mezza coppia surrogata nel documento ricco (#492): il salvataggio del
// `.docx` non fallisce. Il cursore non resta fra le due metà di un'emoji, e un
// surrogato rimasto solo si scrive come U+FFFD. La proiezione scritta qui
// (`rich-surrogato.json`) la salva il codec vero sui byte di `Senza
// perdite.docx` (`crates/fub-format-rich/tests/ts_projection.rs`).
import { afterEach, describe, expect, it } from "vitest";
import { TextSelection } from "prosemirror-state";
import fixture from "../../__fixtures__/rich-senza-perdite.json";
import { RichEngine } from "./engine";
import { wellFormed } from "./projection";

const SOURCE = fixture.source;
const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

let engines: RichEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
});

function engine(): RichEngine {
  const parent = document.createElement("div");
  document.body.append(parent);
  const made = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  made.setDoc(SOURCE);
  engines.push(made);
  return made;
}

function key(e: RichEngine, name: string): void {
  e.contentElement().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
}

describe("una coppia surrogata", () => {
  it("un surrogato solo diventa U+FFFD, le coppie restano", () => {
    expect(wellFormed("a😀b")).toBe("a😀b");
    expect(wellFormed("a\ud83db")).toBe("a�b");
    expect(wellFormed("a\ude00b")).toBe("a�b");
    expect(wellFormed("\ude00\ud83d")).toBe("��");
    expect(wellFormed("\ud83d")).toBe("�");
    expect(wellFormed("😀\ud83d😀")).toBe("😀�😀");
  });

  it("il cursore messo per programma fra le due metà: Invio non spezza l'emoji", () => {
    const e = engine();
    e.select(1);
    e.dispatch(e.state.tr.insertText("😀"));
    e.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2)));
    expect(e.state.selection.head).toBe(1);
    key(e, "Enter");
    expect(e.state.doc.textContent).toContain("😀");
    expect(LONE.test(e.state.doc.textContent)).toBe(false);
    expect(e.getDoc()).not.toMatch(/\\ud[89a-f][0-9a-f]{2}/i);
  });

  it("un surrogato solo nel documento si scrive U+FFFD, e il codec lo salva", async () => {
    const e = engine();
    e.select(1);
    e.dispatch(e.state.tr.insertText("a\ud83db"));
    const source = e.getDoc();
    // `JSON.stringify` scriverebbe `\ud83d` da solo, che serde rifiuta.
    expect(source).not.toMatch(/\\ud[89a-f][0-9a-f]{2}/i);
    expect(source).toContain("a�b");
    expect(() => JSON.parse(source)).not.toThrow();
    await expect(`${JSON.stringify({ base: SOURCE, source }, null, 2)}\n`).toMatchFileSnapshot("../../__fixtures__/rich-surrogato.json");
  });
});
