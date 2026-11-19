// @vitest-environment happy-dom
// Il codice con le righe numerate e i commenti sulla carta (T74).

import { describe, expect, it } from "vitest";
import { ContentChanges } from "./changes";
import { applyCodeNumbers, lineStarts } from "./code";
import { applyTasks } from "./tasks";
import { setSanitizedHtml } from "../../ui/sanitize";
import { firstName, inertComments, markComments, noteElement, notesHeading } from "./comments";

function page(html: string): HTMLElement {
  const root = document.createElement("article");
  root.className = "print-page";
  root.innerHTML = `<h1>Nota</h1><div class="print-body markdown-rendered"></div>`;
  // Come nello spazio: la resa del core passa da `inertComments` e dal sanificatore.
  setSanitizedHtml(root.querySelector<HTMLElement>(".print-body")!, inertComments(html));
  document.body.append(root);
  return root;
}

describe("il codice numerato", () => {
  it("conta le righe del sorgente; l'a capo finale non apre una riga", () => {
    expect(lineStarts("a\nbb\nc\n")).toEqual([0, 2, 5]);
    expect(lineStarts("")).toEqual([0]);
  });

  it("spento non tocca niente", () => {
    const root = page(`<pre><code>a\nb</code></pre>`);
    expect(applyCodeNumbers(root, false, new ContentChanges())).toBe(0);
    expect(root.querySelector(".export-code-numbers")).toBeNull();
  });

  it("acceso: un numero per riga, fuori dal testo; i recinti dichiarati restano", () => {
    const root = page(`<pre><code>uno\ndue\ntre\nquattro\ncinque\nsei\nsette\notto\nnove\ndieci\n</code></pre><pre data-declared-fence><code>x</code></pre>`);
    const changes = new ContentChanges();
    expect(applyCodeNumbers(root, true, changes)).toBe(1);
    const pre = root.querySelector("pre")!;
    const gutter = pre.querySelector(".export-code-numbers")!;
    expect(gutter.getAttribute("aria-hidden")).toBe("true");
    expect([...gutter.children].map((n) => n.textContent)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(pre.style.getPropertyValue("--print-code-digits")).toBe("2");
    expect(pre.querySelector("code")!.textContent).not.toContain("1");
    expect(root.querySelectorAll(".export-code-numbers")).toHaveLength(1);
    changes.undo();
    expect(pre.querySelector(".export-code-numbers")).toBeNull();
    expect(pre.hasAttribute("data-print-numbered")).toBe(false);
  });
});

describe("i commenti", () => {
  const NOTE = `<p>Il preventivo<template class="comment-note" data-author="Anna Rossi" data-date="2026-11-04">Da rivedere</template>
    <template class="comment-note" data-author="Bruno" data-date="2026-11-05">Fatto</template> va bene, il resto<template class="comment-note">Chi?</template> no.</p>
    <table><tbody><tr><td>cella<template class="comment-note" data-author="Carla">In tabella</template></td></tr></tbody></table>
    <ul><li class="task"><input type="checkbox" checked> fatto<template class="comment-note" data-author="Dario">Tolto</template></li></ul>`;

  it("un numero dopo ogni passo; i commenti di seguito sono una discussione", () => {
    const root = page(NOTE);
    const changes = new ContentChanges();
    // Il compito fatto è tolto («Togli»): il suo commento non ha un numero.
    expect(applyTasks(root, false, changes)).toBe(1);
    const threads = markComments(root, changes);
    expect(threads.map((thread) => [thread.number, thread.messages.length])).toEqual([[1, 2], [2, 1], [3, 1]]);
    expect(threads[0]!.messages[1]).toEqual({ author: "Bruno", date: "2026-11-05", text: "Fatto" });
    expect([...root.querySelectorAll(".export-comment-mark")].map((mark) => mark.textContent)).toEqual(["1", "2", "3"]);
    changes.undo();
    expect(root.querySelector(".export-comment-mark")).toBeNull();
  });

  it("passano il sanificatore come segnaposti vuoti, col solo testo", () => {
    const html = `<p>passo<template class="comment-note" data-author="Anna" data-date="2026-11-04">&lt;b&gt;no&lt;/b&gt; <img src="x"></template></p>`;
    const root = page(html);
    const note = root.querySelector<HTMLElement>("span.comment-note")!;
    expect(note.textContent).toBe("");
    expect(note.childElementCount).toBe(0);
    expect(note.dataset["text"]).toBe("<b>no</b> ");
    expect(root.querySelector("template, img")).toBeNull();
    expect(inertComments("<p>niente</p>")).toBe("<p>niente</p>");
  });

  it("un commento in una cella di tabella ha il suo numero nella cella", () => {
    const root = page(NOTE);
    const threads = markComments(root, new ContentChanges());
    expect(threads[2]!.mark.closest("td")).not.toBeNull();
  });

  it("nel margine: il primo nome, il testo e quante risposte", () => {
    const root = page(NOTE);
    const [first, second] = markComments(root, new ContentChanges());
    const note = noteElement(first!, "margine", "it");
    expect(note.textContent).toBe("1 Anna Da rivedere +1");
    expect(note.getAttribute("role")).toBe("note");
    expect(note.lang).toBe("it");
    expect(noteElement(second!, "margine", "it").textContent).toBe("2 Senza nome Chi?");
  });

  it("in fondo: ogni messaggio, col nome intero e la data", () => {
    const root = page(NOTE);
    const [first] = markComments(root, new ContentChanges());
    const note = noteElement(first!, "fondo", "it");
    expect(note.querySelectorAll("b")).toHaveLength(2);
    expect(note.textContent).toMatch(/^1 Anna Rossi, .*2026: Da rivedere/);
    expect(note.textContent).toContain("Bruno");
    expect(notesHeading().textContent).toBe("Commenti");
    expect(firstName("")).toBe("Senza nome");
  });
});
