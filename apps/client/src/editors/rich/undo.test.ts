// @vitest-environment happy-dom
//
// Annullare tutto riporta il documento com'era (IMP-150), sulla proiezione
// vera di `Senza perdite.docx` (`crates/fub-format-rich/tests/ts_projection.rs`
// scrive `rich-senza-perdite.json`): titoli, nota, elenco, una tabella con
// celle unite, due sezioni. La raffica ha un seme fisso e lascia le
// proiezioni di passaggio in `rich-annulla.json`, che il codec salva una
// dopo l'altra sugli stessi byte (lo stesso file Rust): ciò che si salva per
// strada non diventa una base da cui l'annulla non torna.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Slice, type Node as PmNode } from "prosemirror-model";
import { AllSelection, TextSelection } from "prosemirror-state";
import fixture from "../../__fixtures__/rich-senza-perdite.json";
import { RICH_HISTORY_DEPTH, RichEngine } from "./engine";

const SOURCE = fixture.source;

let engines: RichEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
  vi.useRealTimers();
});

function engine(): RichEngine {
  const parent = document.createElement("div");
  document.body.append(parent);
  const made = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  made.setDoc(SOURCE);
  engines.push(made);
  return made;
}

/// Un tasto come lo legge ProseMirror (`keydown` sul testo).
function key(e: RichEngine, name: string, mod = false): void {
  e.contentElement().dispatchEvent(new KeyboardEvent("keydown", { key: name, ctrlKey: mod, bubbles: true, cancelable: true }));
}

/// Una lettera come la scrive ProseMirror: su una selezione che non sta in un
/// paragrafo solo la scrive lui (`keypress`), altrimenti il browser, e la
/// transazione è la stessa.
function type(e: RichEngine, text: string): void {
  e.dispatch(e.state.tr.insertText(text).scrollIntoView());
}

/// Annulla finché c'è qualcosa da annullare. Quanti passi ha fatto.
function undoAll(e: RichEngine, limit: number): number {
  let steps = 0;
  while (steps < limit && e.history("undo")) steps += 1;
  return steps;
}

/// Un generatore con seme (mulberry32): la stessa raffica a ogni giro.
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/// Un punto a caso di `doc` dove un clic può mettere il cursore: non dentro
/// una coppia surrogata, che il browser tiene intera.
function clickable(doc: PmNode, random: () => number): number {
  const pos = Math.floor(random() * doc.content.size);
  const $pos = doc.resolve(pos);
  const inside = $pos.textOffset;
  const unit = inside > 0 ? $pos.parent.childAfter($pos.parentOffset).node!.text!.charCodeAt(inside - 1) : 0;
  return unit >= 0xd800 && unit <= 0xdbff ? pos - 1 : pos;
}

describe("annullare tutto", () => {
  it("Ctrl+A, «XYZ», poi Annulla: lo stesso documento, gli stessi paragrafi", () => {
    vi.useFakeTimers();
    const e = engine();
    const before = e.state.doc;
    key(e, "a", true);
    expect(e.state.selection).toBeInstanceOf(AllSelection);
    for (const letter of "XYZ") {
      vi.advanceTimersByTime(1000);
      type(e, letter);
    }
    expect(e.state.doc.textContent).toBe("XYZ");
    expect(e.getDoc()).not.toBe(SOURCE);
    for (let i = 0; i < 20; i += 1) key(e, "z", true);
    expect(e.state.doc.eq(before)).toBe(true);
    expect(e.getDoc()).toBe(SOURCE);
  });

  it("una raffica di tasti col seme fisso: annullando fino in fondo torna l'originale", async () => {
    vi.useFakeTimers();
    const e = engine();
    const before = e.state.doc;
    const random = seeded(2005);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
    const letters = ["a", "b", "Ù", "📄", "👍🏽", "9", "5", "D", " ", "é"];
    let clipboard: Slice | null = null;
    const passing: string[] = [];
    const GESTURES = 300;
    for (let i = 0; i < GESTURES; i += 1) {
      // Un tasto al secondo: ogni gesto è un passo suo della storia.
      vi.advanceTimersByTime(1000);
      const roll = random();
      if (roll < 0.35) type(e, pick(letters));
      else if (roll < 0.45) key(e, "Enter");
      else if (roll < 0.55) key(e, "Backspace");
      else if (roll < 0.6) key(e, "Delete");
      else if (roll < 0.65) key(e, "a", true);
      else if (roll < 0.7) {
        clipboard = e.state.selection.content();
        e.deleteSelection();
      } else if (roll < 0.75) {
        if (clipboard) e.paste(clipboard);
      } else if (roll < 0.8) key(e, "b", true);
      else if (roll < 0.85) key(e, "i", true);
      else if (roll < 0.88) key(e, "z", true);
      else {
        // Un clic in un punto qualsiasi, o una selezione col trascinamento:
        // come nel browser, mai fra le due metà di una coppia surrogata.
        const a = TextSelection.near(e.state.doc.resolve(clickable(e.state.doc, random)));
        const b = TextSelection.near(e.state.doc.resolve(clickable(e.state.doc, random)));
        e.dispatch(e.state.tr.setSelection(roll < 0.94 ? a : TextSelection.between(a.$anchor, b.$head)));
      }
      if (i % 25 === 24) passing.push(e.getDoc());
    }
    expect(e.getDoc()).not.toBe(SOURCE);
    const steps = undoAll(e, 5 * GESTURES);
    expect(steps).toBeLessThan(5 * GESTURES);
    // Più dei 100 passi che ProseMirror tiene da sé: è lì che si perdeva.
    expect(steps).toBeGreaterThan(120);
    expect(e.state.doc.eq(before)).toBe(true);
    expect(e.getDoc()).toBe(SOURCE);
    expect(key(e, "z", true)).toBeUndefined();
    expect(e.getDoc()).toBe(SOURCE);
    // Le proiezioni di passaggio, poi quella di arrivo: il codec le salva una
    // dopo l'altra e torna al file di partenza (`ts_projection.rs`).
    await expect(`${JSON.stringify({ base: SOURCE, saves: [...passing, e.getDoc()] }, null, 2)}\n`).toMatchFileSnapshot(
      "../../__fixtures__/rich-annulla.json",
    );
  });

  it("la storia tiene ben più dei passi di una raffica", () => {
    expect(RICH_HISTORY_DEPTH).toBeGreaterThanOrEqual(1000);
    vi.useFakeTimers();
    const e = engine();
    const before = e.state.doc;
    e.select(1);
    for (let i = 0; i < 1200; i += 1) {
      vi.advanceTimersByTime(1000);
      type(e, "x");
    }
    expect(undoAll(e, 2000)).toBe(1200);
    expect(e.state.doc.eq(before)).toBe(true);
  });
});
