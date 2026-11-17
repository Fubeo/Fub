import { describe, expect, it } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdownGrammar } from "../grammar";
import { allDiscussions } from "./model";
import { archiveEscape, archiveUnescape, clearArchiveChanges, deleteChanges, readArchive, resolveChanges } from "./resolve";
import { archiveRuns } from "./margin";

// Risolvi, Elimina e l'archivio dei risolti in fondo alla nota (D12 C).

const WHEN = "2026-11-16 14:02";

function stateOf(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownGrammar })] });
  ensureSyntaxTree(state, doc.length, 5_000);
  return state;
}

/// Risolve il commento numero `n` del testo `doc`.
function resolve(doc: string, n = 0): string {
  const state = stateOf(doc);
  const found = allDiscussions(state)[n]!;
  return state.update({ changes: resolveChanges(state.doc, found, WHEN) }).state.doc.toString();
}

describe("Risolvi", () => {
  it("toglie i segni, lascia il passo e archivia la discussione in fondo", () => {
    const doc = "La {==conferma dei prestiti==}{>>@Anna Bianchi 2026-11-08 17:40: Entro venerdì.<<}{>>@Luca 2026-11-09 09:12: Confermato.<<} arriva.\n";
    expect(resolve(doc)).toBe(
      "La conferma dei prestiti arriva.\n\n"
      + "%%fub:risolto 2026-11-16 14:02: conferma dei prestiti%%\n"
      + "%%> @Anna Bianchi 2026-11-08 17:40: Entro venerdì.%%\n"
      + "%%> @Luca 2026-11-09 09:12: Confermato.%%\n",
    );
  });
  it("un secondo Risolvi si accoda all'archivio, senza righe vuote in mezzo", () => {
    const doc = "Uno {==a==}{>>@A: x<<} e {==b==}{>>@B: y<<}.\n";
    const once = resolve(doc, 0);
    const twice = resolve(once, 0);
    expect(twice).toBe("Uno a e b.\n\n%%fub:risolto 2026-11-16 14:02: a%%\n%%> @A: x%%\n%%fub:risolto 2026-11-16 14:02: b%%\n%%> @B: y%%\n");
    expect(readArchive(Text.of(twice.split("\n"))).map((each) => each.quote)).toEqual(["a", "b"]);
  });
  it("un commento su un punto se ne va tutto, e l'archivio dice «su un punto»", () => {
    const out = resolve("Testo {>>@A: nota<<} qui.\n");
    expect(out).toBe("Testo  qui.\n\n%%fub:risolto 2026-11-16 14:02: %%\n%%> @A: nota%%\n");
    expect(readArchive(Text.of(out.split("\n")))[0]).toMatchObject({ quote: "", messages: [{ author: "A", text: "nota" }] });
  });
  it("un messaggio senza autore si archivia e si rilegge senza nome", () => {
    const out = resolve("Il {==passo==}{>>2026-11-09: senza firma<<}.\n");
    expect(readArchive(Text.of(out.split("\n")))[0]!.messages[0]).toEqual({ author: null, date: "2026-11-09", text: "senza firma" });
  });
  it("in una nota senza a capo finale l'archivio non lo aggiunge", () => {
    expect(resolve("Il {==p==}{>>@A: x<<}.")).toBe("Il p.\n\n%%fub:risolto 2026-11-16 14:02: p%%\n%%> @A: x%%");
  });
  it("in una cella la \\| torna | nell'archivio", () => {
    const doc = "| a |\n| - |\n| {==x==}{>>@A: uno \\| due<<} |\n";
    expect(resolve(doc)).toContain("%%> @A: uno | due%%");
  });
  it("niente nell'archivio chiude il commento prima né apre un commento vivo", () => {
    const tricky = "50%% di {==sconto==} e {>>finto<<} 10%";
    const escaped = archiveEscape(tricky);
    expect(escaped).not.toContain("%%");
    expect(escaped).not.toMatch(/(^|[^\\])\{(==|>>)/);
    expect(escaped.endsWith("%")).toBe(false);
    expect(archiveUnescape(escaped)).toBe(tricky);
    const doc = "Il {==50%% netto==}{>>@A: {==no==} 10%<<}.\n";
    const out = resolve(doc);
    expect(allDiscussions(stateOf(out))).toHaveLength(0);
    expect(readArchive(Text.of(out.split("\n")))[0]).toMatchObject({ quote: "50%% netto", messages: [{ text: "{==no==} 10%" }] });
  });
});

describe("Elimina", () => {
  it("toglie segni e messaggi, senza archivio", () => {
    const state = stateOf("Il {==passo==}{>>@A: x<<}{>>@B: y<<} qui.\n");
    const found = allDiscussions(state)[0]!;
    expect(state.update({ changes: deleteChanges(found) }).state.doc.toString()).toBe("Il passo qui.\n");
  });
});

describe("Svuota i risolti", () => {
  it("toglie l'archivio e la riga vuota che lo staccava: la nota torna com'era", () => {
    const doc = "Uno {==a==}{>>@A: x<<}.\n";
    const resolved = resolve(doc);
    const state = stateOf(resolved);
    const out = state.update({ changes: clearArchiveChanges(state.doc)! }).state.doc.toString();
    expect(out).toBe("Uno a.\n");
  });
  it("un archivio in mezzo alla nota se ne va senza toccare il resto", () => {
    const doc = "Prima.\n\n%%fub:risolto 2026-11-16 14:02: q%%\n%%> @A: m%%\n\nDopo.\n";
    const state = stateOf(doc);
    expect(state.update({ changes: clearArchiveChanges(state.doc)! }).state.doc.toString()).toBe("Prima.\n\n\nDopo.\n");
  });
  it("senza archivio non c'è niente da svuotare", () => {
    expect(clearArchiveChanges(Text.of(["Solo testo."]))).toBeNull();
  });
  it("un archivio di 100 discussioni si legge, si nasconde come un tratto e si svuota", () => {
    let doc = "Testo della nota.\n\n";
    for (let i = 0; i < 100; i += 1) {
      doc += `%%fub:risolto 2026-11-16 14:02: passo ${i}%%\n%%> @Anna ${WHEN}: messaggio ${i}%%\n%%> @Luca ${WHEN}: risposta ${i}%%\n`;
    }
    const text = Text.of(doc.split("\n"));
    const archive = readArchive(text);
    expect(archive).toHaveLength(100);
    expect(archive[99]).toMatchObject({ quote: "passo 99", messages: [{ author: "Anna" }, { author: "Luca" }] });
    expect(archiveRuns(text)).toEqual([{ from: archive[0]!.from, to: archive[99]!.to }]);
    const state = stateOf(doc);
    expect(state.update({ changes: clearArchiveChanges(state.doc)! }).state.doc.toString()).toBe("Testo della nota.\n");
  });
  it("una riga di messaggio senza testa prima resta testo della nota", () => {
    expect(readArchive(Text.of(["%%> @A: sola%%"]))).toEqual([]);
  });
});
