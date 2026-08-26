import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState, type StateCommand } from "@codemirror/state";
import {
  autoPairDecision,
  dedentListItem,
  duplicateLines,
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
} from "./editor-commands";

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
    });
  }
  const bar = spec.indexOf("|");
  return EditorState.create({
    doc: spec.replace("|", ""),
    selection: EditorSelection.single(bar === -1 ? 0 : bar),
  });
}

function show(state: EditorState): string {
  const doc = state.doc.toString();
  const { from, to } = state.selection.main;
  if (from === to) return `${doc.slice(0, from)}|${doc.slice(from)}`;
  return `${doc.slice(0, from)}‹${doc.slice(from, to)}›${doc.slice(to)}`;
}

/// Esegue il comando su una fixture; con `handled: false` l'`out` resta la
/// fixture di partenza, a garanzia che il comando non abbia toccato nulla.
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

describe("duplicateLines", () => {
  it("duplica la riga corrente sotto, col cursore sulla copia", () => {
    expect(run(duplicateLines, "ab|c\nx").out).toBe("abc\nab|c\nx");
  });

  it("duplica il blocco della selezione", () => {
    expect(run(duplicateLines, "‹a\nb›\nc").out).toBe("a\nb\n‹a\nb›\nc");
  });

  it("regge emoji e accenti (l'ultima riga, senza newline finale)", () => {
    expect(run(duplicateLines, "🎯à|").out).toBe("🎯à\n🎯à|");
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

  it("[[ chiude con ]]", () => {
    expect(decide("[|", "[")).toEqual({ action: "insert", text: "[]]", cursor: 1 });
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

  it("$ si chiude, scavalca, e $|$ sale al blocco", () => {
    expect(decide("costa |", "$")).toEqual({ action: "insert", text: "$$", cursor: 1 });
    expect(decide("$|$", "$")).toEqual({ action: "insert", text: "$$", cursor: 1 });
    expect(decide("$x|$", "$")).toEqual({ action: "skip" });
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
