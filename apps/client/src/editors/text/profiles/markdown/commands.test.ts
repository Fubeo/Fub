import { describe, expect, it } from "vitest";
import { undo, history } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type StateCommand, type Transaction } from "@codemirror/state";
import {
  autoPairDecision,
  dedentListItem,
  deleteTableColumn,
  deleteTableRow,
  insertTableColumn,
  insertTableRow,
  moveTableColumn,
  moveTableRow,
  sortTableRows,
  sortTableColumns,
  indentListItem,
  smartListEnter,
  toggleBold,
  toggleBulletList,
  toggleCheckbox,
  toggleInlineCode,
  toggleItalic,
  toggleOrderedList,
  toggleStrikethrough,
  toggleWikilink,
} from "./commands";

// I comandi sono `StateCommand` puri: si testano creando un `EditorState` e
// catturando la transazione dal dispatch, senza mai istanziare una view (i
// test girano in node, niente DOM). Nelle stringhe-fixture `|` marca il
// cursore e `‹…›` la selezione: prima e dopo si leggono alla pari.

function mk(spec: string): EditorState {
  const open = spec.indexOf("‹");
  if (open !== -1) {
    const stripped = spec.replace("‹", "");
    const close = stripped.indexOf("›");
    return EditorState.create({
      doc: stripped.replace("›", ""),
      selection: EditorSelection.single(open, close),
      extensions: [markdown({ base: markdownLanguage })],
    });
  }
  const bar = spec.indexOf("|");
  return EditorState.create({
    doc: spec.replace("|", ""),
    selection: EditorSelection.single(bar === -1 ? 0 : bar),
    extensions: [markdown({ base: markdownLanguage })],
  });
}

function show(state: EditorState): string {
  const doc = state.doc.toString();
  const { from, to } = state.selection.main;
  if (from === to) return `${doc.slice(0, from)}|${doc.slice(from)}`;
  return `${doc.slice(0, from)}‹${doc.slice(from, to)}›${doc.slice(to)}`;
}

function run(cmd: StateCommand, spec: string): { handled: boolean; out: string } {
  const state = mk(spec);
  let out = show(state);
  const handled = cmd({
    state,
    dispatch: (tr) => {
      out = show(tr.state);
    },
  });
  return { handled, out };
}

function runReadOnly(cmd: StateCommand, spec: string): { handled: boolean; out: string } {
  const initial = mk(spec);
  const state = EditorState.create({
    doc: initial.doc,
    selection: initial.selection,
    extensions: [markdown({ base: markdownLanguage }), EditorState.readOnly.of(true)],
  });
  let out = show(state);
  const handled = cmd({ state, dispatch: (tr) => { out = show(tr.state); } });
  return { handled, out };
}

describe("formattazione inline", () => {
  it("avvolge la selezione", () => {
    expect(run(toggleBold, "ciao ‹mondo›").out).toBe("ciao **‹mondo›**");
  });

  it("avvolge la parola sotto il cursore", () => {
    expect(run(toggleBold, "ciao mon|do").out).toBe("ciao **‹mondo›**");
  });

  it("toglie i marcatori se la parola è già formattata", () => {
    expect(run(toggleBold, "**gras|setto** x").out).toBe("‹grassetto› x");
  });

  it("toglie i marcatori inclusi nella selezione", () => {
    expect(run(toggleBold, "‹**x**›").out).toBe("‹x›");
  });

  it("senza parola inserisce la coppia col cursore in mezzo", () => {
    expect(run(toggleBold, "|").out).toBe("**|**");
    expect(run(toggleWikilink, "vedi |").out).toBe("vedi [[|]]");
  });

  it("il corsivo non scambia il ** del grassetto per un *", () => {
    expect(run(toggleItalic, "**gras|setto**").out).toBe("***‹grassetto›***");
  });

  it("da ***…*** il corsivo toglie solo il suo *", () => {
    expect(run(toggleItalic, "***en|trambi***").out).toBe("**‹entrambi›**");
  });

  it("corsivo semplice: avvolge e toglie", () => {
    expect(run(toggleItalic, "cor|sivo").out).toBe("*‹corsivo›*");
    expect(run(toggleItalic, "*cor|sivo*").out).toBe("‹corsivo›");
  });

  it("barrato e codice inline", () => {
    expect(run(toggleStrikethrough, "‹via›").out).toBe("~~‹via›~~");
    expect(run(toggleStrikethrough, "~~vi|a~~").out).toBe("‹via›");
    expect(run(toggleInlineCode, "co|de").out).toBe("`‹code›`");
    expect(run(toggleInlineCode, "`co|de`").out).toBe("‹code›");
  });

  it("wikilink: avvolge la parola e la libera", () => {
    expect(run(toggleWikilink, "vedi No|ta").out).toBe("vedi [[‹Nota›]]");
    expect(run(toggleWikilink, "vedi [[No|ta]]").out).toBe("vedi ‹Nota›");
  });

  it("gli accenti fanno parte della parola e le emoji non spostano gli offset", () => {
    expect(run(toggleBold, "🎯 per|ò!").out).toBe("🎯 **‹però›**!");
    expect(run(toggleItalic, "città 🎯 è|à").out).toBe("città 🎯 *‹èà›*");
  });

  it("codice inline con backtick dentro: usa il fence doppio", () => {
    expect(run(toggleInlineCode, "‹a`b›").out).toBe("``‹a`b›``");
    expect(run(toggleInlineCode, "``‹a`b›``").out).toBe("‹a`b›");
  });

  it("il codice conserva corse lunghe di backtick e torna alla sorgente", () => {
    expect(run(toggleInlineCode, "‹a``b›").out).toBe("```‹a``b›```");
    expect(run(toggleInlineCode, "```‹a``b›```").out).toBe("‹a``b›");
    expect(run(toggleInlineCode, "‹`a›").out).toBe("`` ‹`a› ``");
    expect(run(toggleInlineCode, "`` ‹`a› ``").out).toBe("‹`a›");
  });

  it("la selezione inversa resta inversa dopo il toggle", () => {
    const state = EditorState.create({
      doc: "mondo",
      selection: EditorSelection.single(5, 0),
      extensions: [markdown({ base: markdownLanguage })],
    });
    let after = state;
    toggleBold({ state, dispatch: (tr) => { after = tr.state; } });
    expect(after.sliceDoc()).toBe("**mondo**");
    expect(after.selection.main.anchor).toBe(7);
    expect(after.selection.main.head).toBe(2);
  });

  it("in sola lettura non scrive", () => {
    expect(runReadOnly(toggleBold, "‹mondo›")).toEqual({ handled: false, out: "‹mondo›" });
    expect(runReadOnly(toggleInlineCode, "‹a`b›")).toEqual({ handled: false, out: "‹a`b›" });
  });
});

describe("smartListEnter", () => {
  it("continua i puntati con lo stesso pallino", () => {
    expect(run(smartListEnter, "- uno|").out).toBe("- uno\n- |");
    expect(run(smartListEnter, "* uno|").out).toBe("* uno\n* |");
    expect(run(smartListEnter, "+ uno|").out).toBe("+ uno\n+ |");
  });

  it("conserva l'indentazione", () => {
    expect(run(smartListEnter, "  - a|").out).toBe("  - a\n  - |");
  });

  it("spezza la voce al cursore", () => {
    expect(run(smartListEnter, "- ab|cd").out).toBe("- ab\n- |cd");
  });

  it("numerate: la voce nuova prende il numero dopo e la coda rinumera", () => {
    expect(run(smartListEnter, "1. a|\n2. b\n3. c").out).toBe("1. a\n2. |\n3. b\n4. c");
  });

  it("rinumera anche numeri sballati, e col delimitatore `)`", () => {
    expect(run(smartListEnter, "1) a|\n7) b").out).toBe("1) a\n2) |\n3) b");
  });

  it("la rinumerazione scavalca le sottoliste e si ferma a fine lista", () => {
    expect(run(smartListEnter, "1. a|\n   1. x\n2. b\n\n5. altra").out).toBe(
      "1. a\n2. |\n   1. x\n3. b\n\n5. altra",
    );
  });

  it("todo: la voce nuova nasce non spuntata", () => {
    expect(run(smartListEnter, "- [x] fatto|").out).toBe("- [x] fatto\n- [ ] |");
    expect(run(smartListEnter, "1. [x] fatto|").out).toBe("1. [x] fatto\n2. [ ] |");
  });

  it("citazioni: continua il >", () => {
    expect(run(smartListEnter, "> ciao|").out).toBe("> ciao\n> |");
  });

  it("voce vuota: toglie il marcatore e chiude la lista", () => {
    expect(run(smartListEnter, "- uno\n- |").out).toBe("- uno\n|");
    expect(run(smartListEnter, "- [ ] |").out).toBe("|");
    expect(run(smartListEnter, "1. |").out).toBe("|");
  });

  it("fuori lista, dentro il marcatore o con selezione lascia il default", () => {
    expect(run(smartListEnter, "ciao|").handled).toBe(false);
    expect(run(smartListEnter, "-| a").handled).toBe(false);
    expect(run(smartListEnter, "- a‹b›").handled).toBe(false);
  });

  it("gli offset reggono accenti ed emoji nel contenuto", () => {
    expect(run(smartListEnter, "- però 🎯|").out).toBe("- però 🎯\n- |");
  });

  it("dentro fence non tratta la riga come lista (anche Mermaid)", () => {
    expect(run(smartListEnter, "```mermaid\n- a|b\n```").handled).toBe(false);
    expect(run(smartListEnter, "```\n1. a|b\n```").handled).toBe(false);
  });

  it("multi-cursore su numerata: nessun numero duplicato", () => {
    const doc = "1. a\n2. b\n3. c";
    const at = (needle: string) => doc.indexOf(needle) + needle.length;
    const state = EditorState.create({
      doc,
      selection: EditorSelection.create([EditorSelection.cursor(at("1. a")), EditorSelection.cursor(at("2. b"))]),
      extensions: [markdown({ base: markdownLanguage }), EditorState.allowMultipleSelections.of(true)],
    });
    let out = doc;
    smartListEnter({
      state,
      dispatch: (tr) => {
        out = tr.state.doc.toString();
      },
    });
    expect(out).toBe("1. a\n2. \n3. b\n4. \n5. c");
  });

  it("due cursori nella stessa voce rinumerano tutti gli inserimenti", () => {
    let state = EditorState.create({
      doc: "1. abc\n2. fine",
      selection: EditorSelection.create([EditorSelection.cursor(4), EditorSelection.cursor(6)]),
      extensions: [markdown({ base: markdownLanguage }), EditorState.allowMultipleSelections.of(true)],
    });
    smartListEnter({ state, dispatch: (tr) => { state = tr.state; } });
    expect(state.sliceDoc()).toBe("1. a\n2. bc\n3. \n4. fine");
    expect(state.selection.ranges.map((range) => range.head)).toEqual([8, 14]);
  });

  it("Enter conserva CRLF e posiziona il cursore dopo il nuovo marcatore", () => {
    let state = EditorState.create({
      doc: "- uno\r\nfine",
      selection: { anchor: 5 },
      extensions: [markdown({ base: markdownLanguage }), EditorState.lineSeparator.of("\r\n")],
    });
    smartListEnter({ state, dispatch: (tr) => { state = tr.state; } });
    expect(state.sliceDoc()).toBe("- uno\r\n- \r\nfine");
    expect(state.selection.main.head).toBe(state.doc.line(2).to);
  });

  it("una voce vuota rimossa non riceve una rinumerazione sovrapposta", () => {
    let state = EditorState.create({
      doc: "1. a\n2. \n3. b",
      selection: EditorSelection.create([EditorSelection.cursor(4), EditorSelection.cursor(8)]),
      extensions: [markdown({ base: markdownLanguage }), EditorState.allowMultipleSelections.of(true)],
    });
    smartListEnter({ state, dispatch: (tr) => { state = tr.state; } });
    expect(state.sliceDoc()).toBe("1. a\n2. \n\n3. b");
  });

  it("in sola lettura lascia il default", () => {
    expect(runReadOnly(smartListEnter, "- a|")).toEqual({ handled: false, out: "- a|" });
  });
});

describe("indent/dedent delle voci", () => {
  it("Tab indenta la voce", () => {
    expect(run(indentListItem, "- a|").out).toBe("  - a|");
  });

  it("Shift-Tab de-indenta", () => {
    expect(run(dedentListItem, "  - a|").out).toBe("- a|");
  });

  it("agiscono su tutte le righe di lista selezionate", () => {
    // il bordo della selezione non ingloba l'indent appena nato: la selezione
    // resta sul contenuto (stessa mappatura dell'`indentMore` di CM)
    expect(run(indentListItem, "‹- a\n- b›").out).toBe("  ‹- a\n  - b›");
  });

  it("fuori dalle liste lasciano il default", () => {
    expect(run(indentListItem, "testo|").handled).toBe(false);
    expect(run(dedentListItem, "testo|").handled).toBe(false);
  });

  it("Shift-Tab su voce già a filo resta gestito senza cambiare nulla", () => {
    const r = run(dedentListItem, "- a|");
    expect(r.handled).toBe(true);
    expect(r.out).toBe("- a|");
  });
});

describe("toggleCheckbox", () => {
  it("spunta e s-spunta", () => {
    expect(run(toggleCheckbox, "- [ ] fare|").out).toBe("- [x] fare|");
    expect(run(toggleCheckbox, "- [x] fatto|").out).toBe("- [ ] fatto|");
  });

  it("una voce senza checkbox la guadagna (anche numerata)", () => {
    expect(run(toggleCheckbox, "- nuda|").out).toBe("- [ ] nuda|");
    expect(run(toggleCheckbox, "1. nuda|").out).toBe("1. [ ] nuda|");
  });

  it("più righe in una volta", () => {
    expect(run(toggleCheckbox, "‹- [ ] a\n- [x] b›").out).toBe("‹- [x] a\n- [ ] b›");
  });

  it("fuori dalle liste lascia il default", () => {
    expect(run(toggleCheckbox, "testo|").handled).toBe(false);
  });
});

describe("trasforma in lista (Mod-Shift-8/7)", () => {
  it("righe semplici → puntato", () => {
    // il marcatore nasce fuori dal bordo della selezione, che resta sul testo
    expect(run(toggleBulletList, "‹a\nb›").out).toBe("- ‹a\n- b›");
  });

  it("già puntato → marcatori via (toggle)", () => {
    expect(run(toggleBulletList, "‹- a\n- b›").out).toBe("‹a\nb›");
  });

  it("righe semplici → numerato progressivo", () => {
    expect(run(toggleOrderedList, "‹a\nb\nc›").out).toBe("1. ‹a\n2. b\n3. c›");
  });

  it("numerato → via; puntato → numerato conservando la checkbox", () => {
    expect(run(toggleOrderedList, "‹1. a\n2. b›").out).toBe("‹a\nb›");
    expect(run(toggleOrderedList, "‹- a\n- [x] b›").out).toBe("‹1. a\n2. [x] b›");
  });

  it("le righe vuote in mezzo si saltano", () => {
    expect(run(toggleBulletList, "‹a\n\nb›").out).toBe("- ‹a\n\n- b›");
  });

  it("senza selezione agisce sulla riga del cursore", () => {
    expect(run(toggleBulletList, "riga|").out).toBe("- riga|");
  });

  it("solo righe vuote → default", () => {
    expect(run(toggleBulletList, "|").handled).toBe(false);
  });
});

// I test della lettura di una voce di lista sono in `rules/sintassi.test.ts`,
// col codice: da qui è uscita, e tenerne una copia avrebbe rimesso in piedi la
// coppia di letture che la §4.4 ha tolto.

describe("autoPairDecision", () => {
  const decide = (spec: string, typed: string) => {
    const state = mk(spec);
    const { from, to } = state.selection.main;
    return autoPairDecision(state, from, to, typed);
  };

  it("non apre un wikilink dentro il codice inline", () => {
    expect(decide("`🎯[|`", "[")).toBeNull();
  });

  it("non apre un wikilink dentro una fence", () => {
    expect(decide("```\n[|\n```", "[")).toBeNull();
  });
  it("[[ chiude con ]]", () => {
    expect(decide("[|", "[")).toEqual({ action: "insert", text: "[]]", cursor: 1 });
  });

  it("nessun auto-pair Markdown dentro il codice inline", () => {
    expect(decide("`x[|`", "[")).toBeNull();
    expect(decide("`x|]`", "]")).toBeNull();
    expect(decide("`x=|`", "=")).toBeNull();
    expect(decide("`x$|`", "$")).toBeNull();
  });

  it("nessun auto-pair Markdown dentro una fence", () => {
    expect(decide("```\n[|\n```", "[")).toBeNull();
    expect(decide("```\n[|]\n```", "]")).toBeNull();
    expect(decide("```\nx=|\n```", "=")).toBeNull();
    expect(decide("```\nx$|\n```", "$")).toBeNull();
  });
  it("nessun auto-pair Markdown dentro un blocco indentato", () => {
    expect(decide("    x[|", "[")).toBeNull();
    expect(decide("    x[|]", "]")).toBeNull();
    expect(decide("    x=|", "=")).toBeNull();
    expect(decide("    x$|", "$")).toBeNull();
  });

  it("il carattere subito dopo il codice torna al comportamento normale", () => {
    expect(decide("`codice`|", "[")).toBeNull();
    expect(decide("```\ncodice\n```\n$|", "$")).toEqual({ action: "insert", text: "$$$", cursor: 1 });
    expect(decide("`codice`|]", "]")).toEqual({ action: "skip" });
    expect(decide("```\ncodice\n```\n[|]", "]")).toEqual({ action: "skip" });
  });
  it("ma non se la chiusura c'è già", () => {
    expect(decide("[|]]", "[")).toBeNull();
  });

  it("una [ qualunque resta normale", () => {
    expect(decide("ciao |", "[")).toBeNull();
  });

  it("] davanti a ] scavalca, altrove no", () => {
    expect(decide("[[nota|]]", "]")).toEqual({ action: "skip" });
    expect(decide("[[nota]|]", "]")).toEqual({ action: "skip" });
    expect(decide("nota|", "]")).toBeNull();
  });

  it("== evita Setext, si chiude a metà riga, scavalca, e non allunga corse esistenti", () => {
    expect(decide("=|", "=")).toBeNull();
    expect(decide("  =|", "=")).toBeNull();
    expect(decide("x=|", "=")).toEqual({ action: "insert", text: "===", cursor: 1 });
    expect(decide("==evid|==", "=")).toEqual({ action: "skip" });
    expect(decide("x|", "=")).toBeNull();
    expect(decide("==|", "=")).toBeNull();
  });

  it("un $ da solo resta una valuta; $$ a inizio riga apre il blocco; si scavalca la chiusura", () => {
    expect(decide("costa |", "$")).toBeNull();
    expect(decide("5|", "$")).toBeNull();
    expect(decide("$|", "$")).toEqual({ action: "insert", text: "$$$", cursor: 1 });
    expect(decide("$x|$", "$")).toEqual({ action: "skip" });
    expect(decide("costa 5$ e poi |$", "$")).toBeNull();
  });

  it("niente auto-pair con selezione attiva o input multi-carattere", () => {
    expect(decide("‹sel›", "[")).toBeNull();
    const state = mk("|");
    expect(autoPairDecision(state, 0, 0, "[[")).toBeNull();
  });

  it("gli offset in code unit reggono le emoji", () => {
    expect(decide("🎯[|", "[")).toEqual({ action: "insert", text: "[]]", cursor: 1 });
  });
});

describe("operazioni tabella", () => {
  const table = "| A | B |\n| :--- | ---: |\n| left\\|pipe | 10 |\n| z | 2 |";

  function edit(
    doc: string,
    command: StateCommand,
    at: string,
    other?: string,
  ): { handled: boolean; doc: string; undo: string | null; transactions: number } {
    const locations = [at, ...(other ? [other] : [])].map((text) => {
      const from = doc.indexOf(text);
      if (from < 0) throw new Error(`missing selection: ${text}`);
      return EditorSelection.cursor(from);
    });
    let state = EditorState.create({
      doc,
      selection: EditorSelection.create(locations),
      extensions: [
        markdown({ base: markdownLanguage }),
        EditorState.allowMultipleSelections.of(true),
        history(),
      ],
    });
    let transactions = 0;
    const dispatch = (tr: Transaction) => {
      state = tr.state;
      transactions++;
    };
    const handled = command({ state, dispatch });
    const result = state.doc.toString();
    const undone = undo({ state, dispatch });
    return { handled, doc: result, undo: undone ? state.doc.toString() : null, transactions };
  }

  it("inserisce righe dopo il delimitatore, senza cambiare header/allineamenti o testo vicino", () => {
    const source = `intro\n\n${table}\n\nfine`;
    const result = edit(source, insertTableRow("before"), "left");
    expect(result.handled).toBe(true);
    expect(result.doc).toBe(
      `intro\n\n| A | B |\n| :--- | ---: |\n| | |\n| left\\|pipe | 10 |\n| z | 2 |\n\nfine`,
    );
    expect(result.undo).toBe(source);
    expect(result.transactions).toBe(2); // one edit, one undo
  });

  it("sposta e ordina solo le righe del corpo; il separatore non si muove", () => {
    const moved = edit(table, moveTableRow(-1), "z");
    expect(moved.doc).toBe("| A | B |\n| :--- | ---: |\n| z | 2 |\n| left\\|pipe | 10 |");
    expect(moved.undo).toBe(table);
    const sorted = edit(table, sortTableRows(), "B");
    expect(sorted.doc).toBe(moved.doc);
    expect(edit(table, moveTableRow(-1), "left").handled).toBe(false);
    expect(edit(table, deleteTableRow, ":---").handled).toBe(false);
    expect(edit(table, deleteTableRow, "A").handled).toBe(false);
  });

  it("sposta/inserisce/elimina colonne senza dividere escaped pipe né cambiare l'allineamento", () => {
    expect(edit(table, moveTableColumn(-1), "B").doc).toBe(
      "| B | A |\n| ---: | :--- |\n| 10 | left\\|pipe |\n| 2 | z |",
    );
    expect(edit(table, sortTableColumns(-1), "A").doc).toBe(
      "| B | A |\n| ---: | :--- |\n| 10 | left\\|pipe |\n| 2 | z |",
    );
    expect(edit(table, insertTableColumn("before"), "B").doc).toBe(
      "| A | | B |\n| :--- | --- | ---: |\n| left\\|pipe | | 10 |\n| z | | 2 |",
    );
    const removed = edit(table, deleteTableColumn, "left");
    expect(removed.doc).toBe("| B |\n| ---: |\n| 10 |\n| 2 |");
    expect(removed.undo).toBe(table);
  });

  it("aggregates distinct selections in one undoable table operation", () => {
    const result = edit(table, deleteTableRow, "left", "z");
    expect(result.doc).toBe("| A | B |\n| :--- | ---: |");
    expect(result.undo).toBe(table);
    expect(result.transactions).toBe(2);
  });

  it("refuses fenced code, HTML and prose without touching their text", () => {
    for (const source of [
      `\`\`\`md\n${table}\n\`\`\``,
      `<div>\n${table}\n</div>`,
      "ordinary | prose",
    ]) {
      const result = edit(source, deleteTableColumn, source.includes("| A |") ? "A" : "ordinary");
      expect(result.handled).toBe(false);
      expect(result.doc).toBe(source);
      expect(result.transactions).toBe(0);
    }
  });
});
