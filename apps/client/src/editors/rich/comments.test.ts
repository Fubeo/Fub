// @vitest-environment happy-dom
//
// I commenti nella superficie ricca: aggiungerli, rispondere, risolverli e
// toglierli, con i loro segni nel testo e la cronologia.
import { afterEach, describe, expect, it } from "vitest";
import { RichEngine } from "./engine";
import { parseProjection, type Block, type CommentView, type Para } from "./projection";
import { addComment, commentText, commentThreads, deleteComment, goToComment, replyComment, resolveComment } from "./comments";
import { filterSlice } from "./paste";

let engines: RichEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
});

const AT = "2026-10-18T13:00:00Z";
const para = (c: unknown[]): Block => ({ t: "para", role: { kind: "body" }, c }) as Block;

function engine(blocks: readonly Block[], comments: readonly CommentView[] = []): RichEngine {
  const parent = document.createElement("div");
  document.body.append(parent);
  const made = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  made.setDoc(JSON.stringify({ format: "fub-rich", version: 1, ...(comments.length > 0 ? { comments } : {}), blocks }));
  engines.push(made);
  return made;
}

function at(e: RichEngine, needle: string): number {
  let found = -1;
  e.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(needle)) found = pos + node.text!.indexOf(needle);
    return found < 0;
  });
  return found;
}

/// Il primo paragrafo come testo, con i segni dei commenti fra parentesi.
function shown(e: RichEngine, index = 0): string {
  const block = parseProjection(e.getDoc()).blocks[index] as Para;
  return (block.c ?? [])
    .map((inline) => (inline.t === "text" ? inline.x : inline.comment ? `[${inline.comment.end ? "/" : ""}${inline.comment.id}]` : "?"))
    .join("");
}

const listed = (e: RichEngine) => parseProjection(e.getDoc()).comments ?? [];

/// Un commento tenuto, come lo dà il codec, con i suoi segni.
const kept: CommentView = { id: 7, k: "e30", by: "Redazione", at: "2026-10-18T12:00:00Z", text: "Da rivedere." };
const keptMarker = (end: boolean) => ({ t: "atom", k: end ? "fine" : "inizio", kind: "marker", comment: end ? { id: 7, end: true } : { id: 7 } });

describe("i commenti", () => {
  it("uno nuovo segna la selezione e si scrive nella proiezione", () => {
    const e = engine([para([{ t: "text", x: "una parola qui" }])]);
    const from = at(e, "parola");
    e.select(from, from + "parola".length);
    expect(e.apply(addComment("Prima riga\r\nseconda\triga", "Bea Neri", AT))).toBe(true);
    expect(shown(e)).toBe("una [1]parola[/1] qui");
    expect(listed(e)).toEqual([{ id: 1, by: "Bea Neri", at: AT, text: "Prima riga\nseconda riga" }]);
    expect(e.getDoc()).toContain(`"comments":[{"id":1,"by":"Bea Neri","at":"${AT}","text":"Prima riga\\nseconda riga"}],"blocks"`);
    // Il testo commentato si vede, e chi passa sopra legge il commento.
    const range = document.querySelector<HTMLElement>("[data-rich-comment='1']")!;
    expect(range.textContent).toBe("parola");
    expect(range.title).toBe("Bea Neri: Prima riga\nseconda riga");
    // Una battuta sola: l'annulla toglie segni e commento insieme.
    e.run("text.undo");
    expect(shown(e)).toBe("una parola qui");
    expect(listed(e)).toEqual([]);
  });

  it("non si commenta senza selezione o senza testo", () => {
    const e = engine([para([{ t: "text", x: "una parola" }])]);
    e.select(2);
    expect(e.apply(addComment("Testo", "Bea", AT))).toBe(false);
    e.select(1, 4);
    expect(e.apply(addComment(" \n\t", "Bea", AT))).toBe(false);
    expect(commentText("a\u0007b￼")).toBe("ab");
    expect(commentText("x".repeat(64 * 1024 + 1))).toBeNull();
  });

  it("una risposta ha i suoi segni accanto a quelli del commento", () => {
    const e = engine([para([{ t: "text", x: "il " }, keptMarker(false), { t: "text", x: "passo" }, keptMarker(true), { t: "text", x: "." }])], [kept]);
    expect(e.apply(replyComment(7, "Fatto.", "Bea", AT))).toBe(true);
    expect(e.apply(replyComment(7, "Anche io.", "Ada", AT))).toBe(true);
    expect(shown(e)).toBe("il [7][8][9]passo[/7][/8][/9].");
    expect(listed(e).map((c) => [c.id, c.parent, c.text])).toEqual([
      [7, undefined, "Da rivedere."],
      [8, 7, "Fatto."],
      [9, 7, "Anche io."],
    ]);
    // Il commento tenuto resta com'era, con il suo `k`.
    expect(listed(e)[0]).toEqual(kept);
    expect(e.apply(replyComment(99, "A nessuno.", "Bea", AT))).toBe(false);
  });

  it("si risolve e si riapre con le risposte, e si toglie con loro e i loro segni", () => {
    const e = engine([para([{ t: "text", x: "il " }, keptMarker(false), { t: "text", x: "passo" }, keptMarker(true)])], [kept]);
    e.apply(replyComment(7, "Fatto.", "Bea", AT));
    expect(e.apply(resolveComment(7, true))).toBe(true);
    expect(listed(e).map((c) => c.done)).toEqual([true, true]);
    // Risolto, il testo non si segna più.
    expect(document.querySelector("[data-rich-comment]")).toBeNull();
    expect(e.apply(resolveComment(7, true))).toBe(false);
    expect(e.apply(resolveComment(7, false))).toBe(true);
    expect(listed(e).map((c) => c.done)).toEqual([undefined, undefined]);
    expect(e.apply(deleteComment(7))).toBe(true);
    expect(shown(e)).toBe("il passo");
    expect(listed(e)).toEqual([]);
    expect(parseProjection(e.getDoc()).comments).toBeUndefined();
  });

  it("si va al testo che segna", () => {
    const e = engine([para([{ t: "text", x: "il " }, keptMarker(false), { t: "text", x: "passo" }, keptMarker(true)])], [kept]);
    expect(e.apply(goToComment(7))).toBe(true);
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe("passo");
    expect(e.apply(goToComment(8))).toBe(false);
  });

  it("il segno di un commento nuovo si sposta trascinandolo, non si copia", () => {
    const e = engine([para([{ t: "text", x: "una parola" }])]);
    const from = at(e, "parola");
    e.select(from, from + "parola".length);
    e.apply(addComment("Nota", "Bea", AT));
    const slice = e.state.doc.slice(1, e.state.doc.child(0).nodeSize - 1);
    const markers = (moving: boolean) => {
      let n = 0;
      filterSlice(slice, { known: new Set(), present: new Set(), moving }).content.descendants((node) => {
        if (node.attrs.comment) n += 1;
        return true;
      });
      return n;
    };
    expect(markers(true)).toBe(2);
    expect(markers(false)).toBe(0);
  });

  it("si elencano nell'ordine del testo, con le risposte sotto e il testo che segnano", () => {
    // Il documento li tiene nell'ordine in cui sono nati: 9 sta prima di 7.
    const later: CommentView = { id: 9, by: "Bea", at: AT, text: "Prima nel testo." };
    const reply: CommentView = { id: 10, by: "Ada", at: AT, parent: 7, text: "Fatto." };
    const deeper: CommentView = { id: 11, by: "Bea", at: AT, parent: 10, text: "Grazie." };
    const lost: CommentView = { id: 12, by: "Cleo", text: "Senza posto." };
    const marker = (id: number, end: boolean) => ({ t: "atom", kind: "marker", comment: end ? { id, end: true } : { id } });
    const e = engine(
      [para([marker(9, false), { t: "text", x: "uno" }, marker(9, true), { t: "text", x: " e " }, keptMarker(false), { t: "text", x: "passo" }, keptMarker(true)])],
      [kept, lost, reply, later, deeper],
    );
    const threads = commentThreads(e.state.doc);
    expect(threads.map((thread) => [thread.comment.id, thread.quote, thread.placed])).toEqual([
      [9, "uno", true],
      [7, "passo", true],
      [12, "", false],
    ]);
    expect(threads[1]!.replies.map((r) => [r.comment.id, r.depth])).toEqual([
      [10, 1],
      [11, 2],
    ]);
  });
});
