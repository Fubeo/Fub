import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdownGrammar } from "../grammar";
import { threadsIn } from "./threads";
import { commentLevels, scanComments, threadCuts, threadTail, type CommentThread } from "./syntax";

// La grammatica dei commenti della shell, gemella di `parse/comments.rs`: i
// casi della convenzione (`docs/reference/note-conventions.md`). Il corpus (`corpus.test.ts`) tiene le
// due letture d'accordo sulle stesse sorgenti; qui le regole una per una.

/// I commenti di un testo tutto in un tratto.
function scan(text: string): CommentThread[] {
  return scanComments(text, 0, [{ from: 0, to: text.length }]);
}

/// I pezzi di un commento come testo: il passo e i messaggi.
function shape(text: string, thread: CommentThread): { passage: string | null; messages: string[] } {
  const passage = thread.passage ? text.slice(thread.passage.contentFrom, thread.passage.contentTo) : null;
  return { passage, messages: thread.messages.map((m) => text.slice(m.from, m.to)) };
}

/// I commenti di una nota intera, dall'albero di uno stato.
function inNote(doc: string): { passage: string | null; messages: string[] }[] {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownGrammar })] });
  ensureSyntaxTree(state, doc.length, 5_000);
  return threadsIn(state, 0, doc.length).map((thread) => shape(doc, thread));
}

describe("la grammatica dei commenti", () => {
  it("un passo seguito da un messaggio è un commento", () => {
    const text = "Il {==passo==}{>>@Anna: va riscritto<<} poi.";
    const [thread, ...rest] = scan(text);
    expect(rest).toEqual([]);
    expect(shape(text, thread!)).toEqual({ passage: "passo", messages: ["{>>@Anna: va riscritto<<}"] });
    expect(thread!.from).toBe(3);
    expect(thread!.to).toBe(text.indexOf(" poi"));
    expect(threadCuts(thread!).map((cut) => text.slice(cut.from, cut.to))).toEqual(["{==", "==}", "{>>@Anna: va riscritto<<}"]);
    expect(text.slice(threadTail(thread!).from, threadTail(thread!).to)).toBe("==}{>>@Anna: va riscritto<<}");
  });

  it("i messaggi in fila sono una discussione", () => {
    const text = "{==a==}{>>uno<<}{>>due<<}{>>tre<<} {>>altro<<}";
    const threads = scan(text);
    expect(threads.map((t) => shape(text, t))).toEqual([
      { passage: "a", messages: ["{>>uno<<}", "{>>due<<}", "{>>tre<<}"] },
      { passage: null, messages: ["{>>altro<<}"] },
    ]);
  });

  it("un messaggio da solo è un commento su un punto", () => {
    const text = "Qui {>>2026-11-08: un messaggio<<} e il resto.";
    const [thread] = scan(text);
    expect(thread!.passage).toBeNull();
    expect(text.slice(thread!.from, thread!.to)).toBe("{>>2026-11-08: un messaggio<<}");
    expect(text.slice(threadTail(thread!).from, threadTail(thread!).to)).toBe("{>>2026-11-08: un messaggio<<}");
  });

  it("un passo senza messaggio, un segno sotto escape e un messaggio aperto restano testo", () => {
    expect(scan("{==senza messaggio==} e basta")).toEqual([]);
    expect(scan("{==a==} {>>staccato<<}").map((t) => t.passage)).toEqual([null]);
    expect(scan("\\{==letterale==}")).toEqual([]);
    expect(scan("\\{>>letterale<<}")).toEqual([]);
    // Due barre sono una barra scritta: il segno resta un segno.
    expect(scan("\\\\{>>vero<<}")).toHaveLength(1);
    expect(scan("{>>aperto e mai chiuso")).toEqual([]);
    expect(scan("{==a==}{>>aperto")).toEqual([]);
  });

  it("un messaggio sta su una riga", () => {
    expect(scan("{>>prima\ndopo<<}")).toEqual([]);
    expect(scan("{>>prima\rdopo<<}")).toEqual([]);
    // Il passo invece va a capo, come il paragrafo.
    const text = "{==prima\ndopo==}{>>ok<<}";
    expect(scan(text).map((t) => shape(text, t))).toEqual([{ passage: "prima\ndopo", messages: ["{>>ok<<}"] }]);
  });

  it("un messaggio si chiude sul primo `<<}`, e i segni a metà ci stanno dentro", () => {
    const text = "{==a==}{>>@Anna: x >> y << z<<} fine";
    expect(scan(text).map((t) => shape(text, t))).toEqual([{ passage: "a", messages: ["{>>@Anna: x >> y << z<<}"] }]);
    const nested = "{>>a {== b<<} c";
    expect(scan(nested).map((t) => shape(nested, t))).toEqual([{ passage: null, messages: ["{>>a {== b<<}"] }]);
  });

  it("un passo si chiude sul primo `==}`, e un'altra apertura prima di lui lo annulla", () => {
    const text = "{==a {==b==}{>>m<<}";
    expect(scan(text).map((t) => shape(text, t))).toEqual([{ passage: "b", messages: ["{>>m<<}"] }]);
    const both = "{==a==}{>>uno<<}{==b==}{>>due<<}";
    expect(scan(both).map((t) => shape(both, t))).toEqual([
      { passage: "a", messages: ["{>>uno<<}"] },
      { passage: "b", messages: ["{>>due<<}"] },
    ]);
  });

  it("un segno sta tutto in un tratto: diviso fra due non conta", () => {
    const text = "{==a==}{>>m<<}";
    // Il tratto si ferma a metà di `==}`: il passo non si chiude, e resta il
    // messaggio da solo.
    expect(scanComments(text, 0, [{ from: 0, to: 5 }, { from: 5, to: text.length }]).map((t) => shape(text, t)))
      .toEqual([{ passage: null, messages: ["{>>m<<}"] }]);
    // Con una base, le posizioni restano assolute.
    const [thread] = scanComments(text, 100, [{ from: 100, to: 100 + text.length }]);
    expect(thread!.from).toBe(100);
    expect(thread!.to).toBe(100 + text.length);
  });

  it("i livelli: un inline nativo e un atomo tolgono il loro tratto al contenitore", () => {
    const levels = commentLevels(0, 20, [{ from: 5, to: 10, content: { from: 6, to: 9 } } as never], [{ from: 12, to: 14 }]);
    expect(levels).toEqual([
      [{ from: 0, to: 5 }, { from: 10, to: 12 }, { from: 14, to: 20 }],
      [{ from: 6, to: 9 }],
    ]);
  });
});

describe("i commenti nella nota", () => {
  it("si leggono in un titolo, in una voce, in una citazione e in una cella", () => {
    const doc = "# Titolo {==t==}{>>@Anna: sul titolo<<}\n\n- voce {==v==}{>>@Anna: sulla voce<<}\n\n> citata {==r==}{>>@Anna: sulla citazione<<}\n\n| a | b |\n| --- | --- |\n| {==c==}{>>@Anna: uno \\| due<<} | d |\n";
    expect(inNote(doc)).toEqual([
      { passage: "t", messages: ["{>>@Anna: sul titolo<<}"] },
      { passage: "v", messages: ["{>>@Anna: sulla voce<<}"] },
      { passage: "r", messages: ["{>>@Anna: sulla citazione<<}"] },
      { passage: "c", messages: ["{>>@Anna: uno \\| due<<}"] },
    ]);
  });

  it("dentro codice, formule, wikilink e HTML i segni sono caratteri", () => {
    expect(inNote("`{==a==}{>>b<<}` e $x{>>y<<}$ e [[N{>>z<<}]] e <span title='{>>h<<}'>x</span>\n")).toEqual([]);
    // Fra due tag HTML c'è testo della nota, come per comrak.
    expect(inNote("<b>{==a==}{>>m<<}</b>\n")).toEqual([{ passage: "a", messages: ["{>>m<<}"] }]);
    expect(inNote("```\n{==a==}{>>b<<}\n```\n")).toEqual([]);
  });

  it("un messaggio non attraversa la riga di una citazione", () => {
    expect(inNote("> {>>prima\n> dopo<<}\n")).toEqual([]);
  });

  it("un commento dentro un'enfasi o un link è del suo livello", () => {
    expect(inNote("*{==a==}{>>m<<}* e [{==l==}{>>n<<}](https://x.it)\n")).toEqual([
      { passage: "a", messages: ["{>>m<<}"] },
      { passage: "l", messages: ["{>>n<<}"] },
    ]);
    // Un'enfasi che attraversa i segni li divide fra due livelli: `{==` resta
    // fuori, e dentro c'è soltanto il messaggio, su un punto.
    expect(inNote("{==a *b==}{>>m<<} c*\n")).toEqual([{ passage: null, messages: ["{>>m<<}"] }]);
  });

  it("senza la sintassi `fub:comments` non c'è niente", () => {
    const doc = "{==a==}{>>m<<}\n";
    const state = EditorState.create({ doc, extensions: [markdown({ base: markdownGrammar })] });
    ensureSyntaxTree(state, doc.length, 5_000);
    expect(threadsIn(state, 0, doc.length, [])).toEqual([]);
  });
});
