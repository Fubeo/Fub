import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { markdownGrammar } from "../grammar";
import {
  allDiscussions,
  authorSlot,
  cleanMessage,
  cleanName,
  discussionAt,
  initials,
  messageHeader,
  messageSource,
  newCommentChanges,
  placeComment,
  readsAsComment,
  shortName,
  signature,
  stamp,
} from "./model";
import { parsed } from "../test-support";

// Le discussioni lette dal buffer e il testo che un gesto ci scrive: chi ha
// scritto, dove va un commento nuovo, come si firma.

function stateOf(doc: string, from = 0, to = from): EditorState {
  return parsed(EditorState.create({ doc, selection: EditorSelection.single(from, to), extensions: [markdown({ base: markdownGrammar })] }));
}

describe("l'intestazione di un messaggio, come il provider", () => {
  it("legge autore, data con l'ora e testo", () => {
    expect(messageHeader("@Anna Bianchi 2026-11-08 17:40: Il museo risponde.")).toEqual({
      author: "Anna Bianchi", date: "2026-11-08 17:40", text: "Il museo risponde.",
    });
  });
  it("legge l'autore senza data, la data senza autore, il testo nudo", () => {
    expect(messageHeader("@Luca: va bene")).toEqual({ author: "Luca", date: null, text: "va bene" });
    expect(messageHeader("2026-11-09: senza firma")).toEqual({ author: null, date: "2026-11-09", text: "senza firma" });
    expect(messageHeader("solo testo: con due punti")).toEqual({ author: null, date: null, text: "solo testo: con due punti" });
  });
});

describe("chi firma", () => {
  it("il nome, le iniziali o niente", () => {
    expect(signature("Anna Bianchi", "nome")).toBe("Anna Bianchi");
    expect(signature("Anna Bianchi", "iniziali")).toBe("AB");
    expect(signature("Anna Bianchi", "niente")).toBeNull();
    expect(signature("   ", "nome")).toBeNull();
  });
  it("un nome non rompe l'intestazione: niente due punti né segni", () => {
    expect(cleanName("@Anna: {==x==}\nB")).toBe("Anna x B");
  });
  it("le iniziali, il nome breve, il colore restano gli stessi", () => {
    expect(initials(null)).toBe("?");
    expect(initials("élodie martin rossi")).toBe("ÉM");
    expect(shortName("Anna Bianchi", "Senza nome")).toBe("Anna");
    expect(shortName(null, "Senza nome")).toBe("Senza nome");
    expect(authorSlot(null)).toBe(0);
    expect(authorSlot("Anna")).toBe(authorSlot("Anna"));
    expect(authorSlot("Anna")).toBeGreaterThan(0);
  });
  it("la data si scrive nell'ora locale, al minuto", () => {
    expect(stamp(new Date(2026, 10, 9, 7, 5))).toBe("2026-11-09 07:05");
  });
});

describe("il testo di un messaggio", () => {
  it("sta su una riga, non chiude il commento prima, in una cella scrive \\|", () => {
    expect(cleanMessage("uno\ndue <<} tre")).toBe("uno due << } tre");
    expect(cleanMessage("a|b||c", true)).toBe("a\\|b\\|\\|c");
    expect(messageSource(null, "2026-11-09 11:48", "ciao")).toBe("{>>2026-11-09 11:48: ciao<<}");
    expect(messageSource("Anna", "2026-11-09 11:48", "ciao")).toBe("{>>@Anna 2026-11-09 11:48: ciao<<}");
  });
});

describe("le discussioni del buffer", () => {
  const NOTE = "Il {==passo==}{>>@Anna 2026-11-08: va riscritto<<}{>>Luca: sì<<} poi.\n\nAltro {>>@Bea: sul punto<<}.\n";
  it("la citazione, i messaggi in ordine, il commento su un punto", () => {
    const found = allDiscussions(stateOf(NOTE));
    expect(found.map((each) => each.quote)).toEqual(["passo", ""]);
    expect(found[0]!.messages.map((m) => [m.author, m.text])).toEqual([["Anna", "va riscritto"], [null, "Luca: sì"]]);
    expect(found[1]!.messages[0]!.author).toBe("Bea");
  });
  it("un messaggio senza autore si legge, senza nome", () => {
    const found = allDiscussions(stateOf("Il {==passo==}{>>solo testo<<}.\n"));
    expect(found[0]!.messages[0]).toMatchObject({ author: null, date: null, text: "solo testo" });
  });
  it("dalla posizione al commento che la contiene", () => {
    const state = stateOf(NOTE);
    expect(discussionAt(state, NOTE.indexOf("passo"))?.quote).toBe("passo");
    expect(discussionAt(state, NOTE.indexOf("Altro"))).toBeNull();
  });
  it("in una cella la \\| torna |", () => {
    const doc = "| a | b |\n| - | - |\n| {==x==}{>>@A: uno \\| due<<} | y |\n";
    expect(allDiscussions(stateOf(doc))[0]).toMatchObject({ inCell: true, messages: [{ text: "uno | due" }] });
  });
});

describe("dove va un commento nuovo", () => {
  it("sulla selezione, nel suo blocco", () => {
    const doc = "Un paragrafo da commentare.\n";
    const from = doc.indexOf("paragrafo");
    const place = placeComment(stateOf(doc, from, from + "paragrafo".length));
    expect(place).toEqual({ kind: "passage", from, to: from + 9, clipped: false, inCell: false });
  });
  it("una selezione su più blocchi resta nel primo, e lo dice", () => {
    const doc = "Primo blocco qui.\n\nSecondo blocco.\n";
    const from = doc.indexOf("blocco");
    const place = placeComment(stateOf(doc, from, doc.indexOf("Secondo") + 4));
    expect(place).toMatchObject({ kind: "passage", from, to: doc.indexOf("\n"), clipped: true });
  });
  it("non taglia un inline a metà: lo prende intero", () => {
    const doc = "Testo **molto forte** qui.\n";
    const place = placeComment(stateOf(doc, doc.indexOf("forte"), doc.indexOf(" qui")));
    expect(place).toMatchObject({ kind: "passage", from: doc.indexOf("**"), to: doc.indexOf(" qui") });
  });
  it("nel codice e in una formula va su un punto, dopo il blocco", () => {
    const code = "```js\nlet a = 1;\n```\n\nDopo.\n";
    expect(placeComment(stateOf(code, code.indexOf("let"), code.indexOf("1;")))).toEqual({ kind: "after", at: code.indexOf("\n\nDopo"), block: "code" });
    const math = "$$x^2$$\n";
    expect(placeComment(stateOf(math, 2, 4))).toMatchObject({ kind: "after", block: "math" });
  });
  it("dove c'è già un commento apre quello", () => {
    const doc = "Il {==passo==}{>>@A: x<<} qui.\n";
    expect(placeComment(stateOf(doc, doc.indexOf("passo") + 1))).toMatchObject({ kind: "existing" });
  });
  it("il testo scritto si rilegge come commento, al punto giusto", () => {
    const doc = "Un paragrafo.\n";
    const state = stateOf(doc, 3, 12);
    const place = placeComment(state);
    if (place.kind !== "passage") throw new Error(place.kind);
    const { changes, anchor } = newCommentChanges(state.doc, place, messageSource("Anna", "2026-11-09 11:48", "ciao"));
    const after = state.update({ changes }).state;
    expect(after.doc.toString()).toBe("Un {==paragrafo==}{>>@Anna 2026-11-09 11:48: ciao<<}.\n");
    expect(readsAsComment(after, anchor)).toBe(true);
  });
  it("dopo un blocco di codice il commento è un paragrafo nuovo", () => {
    const doc = "```\nx\n```\nDopo.\n";
    const state = stateOf(doc, 4);
    const place = placeComment(state);
    if (place.kind !== "after") throw new Error(place.kind);
    const { changes, anchor } = newCommentChanges(state.doc, place, "{>>@A 2026-11-09 11:48: ok<<}");
    const after = state.update({ changes }).state;
    expect(after.doc.toString()).toBe("```\nx\n```\n\n{>>@A 2026-11-09 11:48: ok<<}\n\nDopo.\n");
    expect(readsAsComment(after, anchor)).toBe(true);
  });
});
