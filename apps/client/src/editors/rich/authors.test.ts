// @vitest-environment happy-dom
//
// Un colore per autore: il posto viene dall'ordine in cui gli autori
// compaiono nel documento, la stessa persona ha lo stesso posto, e il settimo
// riprende dal primo.
import { afterEach, describe, expect, it } from "vitest";
import { AUTHOR_SLOTS, authorClass, authorSlot, authorSlots } from "./authors";
import { RichEngine } from "./engine";
import type { Block, CommentView } from "./projection";

let engines: RichEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
});

const AT = "2026-10-18T13:00:00Z";
const para = (c: unknown[], extra: object = {}): Block => ({ t: "para", role: { kind: "body" }, ...extra, c }) as Block;
const ins = (x: string, by: string) => ({ t: "text", x, ins: { by, at: AT } });
const del = (x: string, by: string) => ({ t: "text", x, del: { by, at: AT } });

function engine(blocks: readonly Block[], comments: readonly CommentView[] = []): RichEngine {
  const parent = document.createElement("div");
  document.body.append(parent);
  const made = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  made.setDoc(JSON.stringify({ format: "fub-rich", version: 1, ...(comments.length > 0 ? { comments } : {}), blocks }));
  engines.push(made);
  return made;
}

describe("i colori degli autori", () => {
  it("vanno agli autori nell'ordine in cui compaiono, e la stessa persona ha lo stesso", () => {
    const e = engine(
      [
        para([ins("uno", "Bea"), { t: "text", x: " " }, { t: "atom", kind: "marker", comment: { id: 1 } }, { t: "text", x: "due" }, { t: "atom", kind: "marker", comment: { id: 1, end: true } }]),
        para([del("tre", "Ada"), ins("quattro", "Bea")], { ins: { by: "Ugo", at: AT } }),
      ],
      [{ id: 1, by: "Cleo", at: AT, text: "nota" }, { id: 2, by: "Dino", at: AT, text: "risposta", parent: 1 }, { id: 3, by: "Ezio", at: AT, text: "senza posto" }],
    );
    const slots = authorSlots(e.state.doc);
    expect([...slots]).toEqual([
      ["Bea", 1],
      ["Cleo", 2],
      ["Dino", 3],
      ["Ada", 4],
      ["Ugo", 5],
      ["Ezio", 6],
    ]);
    expect(authorSlot(slots, " Bea ")).toBe(1);
    // Il testo porta il posto come classe, non il colore.
    const quattro = [...document.querySelectorAll<HTMLElement>(".rich-autore-ins")].find((el) => el.textContent === "quattro")!;
    expect(quattro.classList.contains(authorClass(1))).toBe(true);
    expect(quattro.getAttribute("style")).toBeNull();
    expect(document.querySelector(".rich-autore-del")?.classList.contains(authorClass(4))).toBe(true);
    expect(document.querySelector(".rich-ins-mark")?.classList.contains(authorClass(5))).toBe(true);
    // Ogni paragrafo con una revisione ha la sua barra nel margine.
    expect(document.querySelectorAll(".rich-changed")).toHaveLength(2);
  });

  it("il settimo autore riprende dal primo", () => {
    const names = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const e = engine([para(names.map((name) => ins(name.toLowerCase(), name)))]);
    const slots = authorSlots(e.state.doc);
    expect(AUTHOR_SLOTS).toBe(6);
    expect(names.map((name) => authorSlot(slots, name))).toEqual([1, 2, 3, 4, 5, 6, 1, 2]);
  });

  it("chi non ha nome è un autore anche lui, e un nome che il documento non ha sta al primo", () => {
    const e = engine([para([ins("x", "Ada"), ins("y", "")])]);
    const slots = authorSlots(e.state.doc);
    expect(authorSlot(slots, undefined)).toBe(2);
    expect(authorSlot(slots, "Nessuno")).toBe(1);
  });
});
