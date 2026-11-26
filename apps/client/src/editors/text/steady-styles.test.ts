// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { createTextEngine, type TextEngine } from "./engine";
import { editorTheme } from "./theme";

// Aprire una scheda monta un editor: il `<style>` di CodeMirror non si
// riscrive se il testo è lo stesso (in WebKitGTK ogni riscrittura ricalcola lo
// stile di tutto il documento, ~25 ms).

const engines: TextEngine[] = [];

function mount(extensions?: () => import("@codemirror/state").Extension): TextEngine {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const engine = createTextEngine(parent, { onChange: () => {}, onSelectionChange: () => {}, extensions });
  engines.push(engine);
  return engine;
}

function styleTag(): HTMLStyleElement {
  const tag = [...document.head.querySelectorAll("style")].find((each) => (each.textContent ?? "").includes(".ͼ"));
  if (!tag) throw new Error("il <style> di CodeMirror non c'è");
  return tag;
}

/// Le riscritture del `<style>` mentre corre `run`.
function rewrites(run: () => void): number {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((list) => records.push(...list));
  observer.observe(styleTag(), { childList: true, characterData: true, subtree: true });
  run();
  records.push(...observer.takeRecords());
  observer.disconnect();
  return records.length;
}

afterEach(() => {
  for (const engine of engines.splice(0)) engine.destroy();
  document.body.replaceChildren();
});

describe("il foglio di CodeMirror", () => {
  it("non si riscrive quando si monta un altro editor con gli stessi temi", () => {
    mount();
    expect(rewrites(() => {
      mount();
      mount();
    })).toBe(0);
  });

  it("non si riscrive quando un editor torna a una luce già vista", () => {
    const engine = mount();
    engine.setTheme("dark");
    engine.setTheme("light");
    expect(rewrites(() => {
      engine.setTheme("dark");
      engine.setTheme("light");
    })).toBe(0);
  });

  it("si riscrive quando arriva un tema che non aveva", () => {
    mount();
    const rule = EditorView.theme({ ".cm-prova-foglio-nuovo": { color: "red" } });
    expect(rewrites(() => mount(() => rule))).toBeGreaterThan(0);
    expect(styleTag().textContent).toContain("cm-prova-foglio-nuovo");
  });

  it("ha un tema solo per luce", () => {
    expect(editorTheme("dark")).toBe(editorTheme("dark"));
    expect(editorTheme("light")).toBe(editorTheme("light"));
    expect(editorTheme("light")).not.toBe(editorTheme("dark"));
  });
});
