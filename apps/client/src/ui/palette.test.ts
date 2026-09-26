import { describe, expect, it } from "vitest";
import type { CommandEffect, CommandPlan, CommandSpec, ParamKind, ParamSpec, ViewSpec } from "../host/contract";
import { t } from "../i18n/strings";
import {
  argsFromForm,
  filterCommands,
  fuzzyScore,
  needsPlan,
  planApplies,
  planLines,
  scopeLabel,
  viewEntries,
} from "./palette";
import type { CommandEntry } from "./commands";
import { setPrimaryViews } from "./primary-views";

// Le decisioni della palette sono funzioni pure apposta: la regola del consenso
// (quando mostrare il piano prima di eseguire) e la costruzione degli argomenti
// devono restare vere anche quando la palette verrà ridisegnata.

function spec(over: Partial<CommandSpec> = {}): CommandSpec {
  return {
    id: "test.cmd",
    title: "Comando",
    description: "",
    keybinding: null,
    params: [],
    scope: { writes: false, reach: "session", reversible: true },
    surfaces: [],
    ...over,
  };
}

/// Un comando **del kernel** come lo vede la palette: la spec, più l'accordo
/// efficace che il registro le mette accanto.
function entry(over: Partial<CommandSpec> = {}): CommandEntry {
  const s = spec(over);
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    layer: s.scope.reach === "document" ? "document" : "global",
    binding: s.keybinding,
    declared: s.keybinding,
    spec: s,
    run: null,
  };
}

function param(name: string, kind: ParamKind, required = false) {
  return { name, title: name, description: "", kind, required };
}

describe("scelta del comando", () => {
  const specs = [
    entry({ id: "vault.replace", title: "Sostituisci in tutte le note" }),
    entry({ id: "search.open", title: "Cerca nel vault", description: "ricerca full-text" }),
    entry({ id: "selection.wikilink", title: "Trasforma la selezione in wikilink" }),
  ];

  it("cerca nel titolo, nell'id e nella descrizione", () => {
    expect(filterCommands(specs, "sostit").map((s) => s.id)).toEqual(["vault.replace"]);
    expect(filterCommands(specs, "wikilink").map((s) => s.id)).toEqual(["selection.wikilink"]);
    // La descrizione è il campo che la decisione 0010 ha aggiunto per i chiamanti non
    // umani: qui serve a chi non conosce il titolo esatto.
    expect(filterCommands(specs, "full-text").map((s) => s.id)).toEqual(["search.open"]);
    expect(filterCommands(specs, "")).toHaveLength(3);
    expect(filterCommands(specs, "zzz")).toHaveLength(0);
  });

  it("chi comincia col testo cercato viene prima", () => {
    const sorted = filterCommands(specs, "cerca");
    expect(sorted[0].id).toBe("search.open");
  });

  // Il filtro a **sottosequenza** (§18.2): è ciò che chiunque abbia usato una
  // palette si aspetta, e il prefisso non lo sa fare.
  it("trova per iniziali sparse", () => {
    expect(filterCommands(specs, "sitn").map((s) => s.id)).toEqual(["vault.replace"]);
    expect(filterCommands(specs, "tslw").map((s) => s.id)).toEqual(["selection.wikilink"]);
  });

  it("ma una corrispondenza esatta resta davanti a una sparsa", () => {
    // «Cerca nel vault» contiene «cerca»; «Sostituisci in tutte le note» ha una
    // sottosequenza `c-e-r-c-a`? No — ma ne ha una per `snt`, e il punto è che
    // il rango di prima fa da spareggio invece di essere stato buttato.
    const sorted = filterCommands(
      [entry({ id: "a", title: "Trasforma la selezione in wikilink" }), ...specs],
      "cerca",
    );
    expect(sorted[0]!.id).toBe("search.open");
  });

  it("una sottosequenza compatta batte una sparpagliata", () => {
    // A parità di scaglione vince chi ha i caratteri più vicini: per `gr`,
    // «Grafo» batte «Gestione della ricerca».
    expect(fuzzyScore("grafo", "gr")).toBeLessThan(fuzzyScore("gestione ricerca", "gr")!);
    expect(fuzzyScore("cerca", "zz")).toBeNull();
  });
});

describe("la regola del consenso", () => {
  it("un comando che non scrive non chiede niente", () => {
    expect(needsPlan(spec())).toBe(false);
  });

  it("una nota sola e reversibile si fa e basta", () => {
    expect(
      needsPlan(spec({ scope: { writes: true, reach: "document", reversible: true } })),
    ).toBe(false);
  });

  it("più note si guardano prima", () => {
    expect(
      needsPlan(spec({ scope: { writes: true, reach: "documents", reversible: true } })),
    ).toBe(true);
    expect(needsPlan(spec({ scope: { writes: true, reach: "vault", reversible: true } }))).toBe(
      true,
    );
  });

  it("ciò da cui non si torna indietro si guarda sempre, anche su una nota", () => {
    expect(
      needsPlan(spec({ scope: { writes: true, reach: "document", reversible: false } })),
    ).toBe(true);
  });

  it("un piano senza note si applica solo se il comando non tocca note", () => {
    const empty: CommandPlan = { summary: "Crea la cartella «a»", docs: [], edits: [] };
    const writing = (reach: CommandSpec["scope"]["reach"]) =>
      spec({ scope: { writes: true, reach, reversible: true } });
    expect(planApplies(writing("vault"), empty)).toBe(true);
    expect(planApplies(writing("settings"), empty)).toBe(true);
    expect(planApplies(writing("documents"), empty)).toBe(false);
    expect(planApplies(writing("document"), empty)).toBe(false);
    expect(planApplies(writing("documents"), { ...empty, docs: ["a.md"] })).toBe(true);
  });

  it("il raggio si legge in una riga", () => {
    expect(
      scopeLabel(spec({ scope: { writes: true, reach: "documents", reversible: false } })),
    ).toBe("scrive · più note · non reversibile");
    expect(scopeLabel(spec())).toBe("legge · questa sessione");
  });
});

describe("gli argomenti che la palette costruisce", () => {
  const s = spec({
    params: [
      param("find", { kind: "text" }, true),
      param("replace", { kind: "text" }, true),
      param("whole_word", { kind: "bool" }),
      param("docs", { kind: "documents" }),
      param("at", { kind: "numbers" }),
      param("limit", { kind: "number" }),
      param("note", { kind: "document" }),
    ],
  });

  it("un testo obbligatorio si manda anche vuoto", () => {
    const args = argsFromForm(s, { find: "gatto", replace: "" });
    // `replace: ""` cancella le occorrenze: è una richiesta legittima, e non
    // tocca alla palette decidere che non lo sia.
    expect(args.replace).toBe("");
    expect(args.find).toBe("gatto");
  });

  it("un campo facoltativo lasciato vuoto non viene mandato", () => {
    const args = argsFromForm(s, { find: "x", replace: "y", docs: "", limit: "", note: "" });
    expect(args).not.toHaveProperty("docs");
    expect(args).not.toHaveProperty("limit");
    expect(args).not.toHaveProperty("note");
  });

  it("un elenco di documenti si scrive una riga per volta", () => {
    const args = argsFromForm(s, { find: "x", replace: "y", docs: "a.md\n b.md , c.md\n\n" });
    expect(args.docs).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("un elenco di numeri si scrive una riga per volta (§23.4)", () => {
    // La specie di *queste* posizioni: stessa mano dei documenti, numeri
    // invece di id — e i tipi che arrivano al comando sono quelli dichiarati.
    const args = argsFromForm(s, { find: "x", replace: "y", at: "0\n 4 , 9\n" });
    expect(args.at).toEqual([0, 4, 9]);
  });

  it("un elenco con un pezzo che non è un numero non viene mandato", () => {
    // La regola del numero solo, allargata all'elenco: un pezzo rotto bocca
    // tutto, perché un elenco quasi giusto al posto di uno mancante toglie al
    // comando l'errore che dice cosa manca.
    const args = argsFromForm(s, { find: "x", replace: "y", at: "1, molti" });
    expect(args).not.toHaveProperty("at");
  });

  it("i tipi sono quelli dichiarati, non stringhe", () => {
    const args = argsFromForm(s, { find: "x", replace: "y", whole_word: true, limit: "20" });
    expect(args.whole_word).toBe(true);
    expect(args.limit).toBe(20);
  });

  it("un numero che non è un numero non viene mandato", () => {
    const args = argsFromForm(s, { find: "x", replace: "y", limit: "molti" });
    expect(args).not.toHaveProperty("limit");
  });

  it("una casella facoltativa mai spuntata non viene mandata affatto", () => {
    // `false` non è «non toccato». Mandandolo, la palette decide al posto del
    // comando — e a decidere cosa succede quando un parametro facoltativo manca
    // è il comando, che è l'unico a saperlo: sta scritto accanto a
    // `ParamSpec::required`, dove il contratto rifiuta esplicitamente di avere
    // un default. La regola vale per ogni specie di campo, e il booleano era
    // l'unico ramo che non la applicava.
    const args = argsFromForm(s, { find: "x", replace: "y" });
    expect(args).not.toHaveProperty("whole_word");
    // E nemmeno quando la casella c'è ed è spenta: nella palette una casella
    // non spuntata **è** il suo stato iniziale, e non c'è modo di dire «falso
    // per scelta» che non sia già detto dal default del comando.
    expect(argsFromForm(s, { find: "x", replace: "y", whole_word: false })).not.toHaveProperty(
      "whole_word",
    );
  });

  it("una casella obbligatoria si manda anche a falso", () => {
    // L'altro verso, e presidia la forma nuova invece del difetto: un parametro
    // obbligatorio si manda sempre, vuoto compreso, o il comando riceve un
    // rifiuto di serde al posto della risposta che l'utente ha dato.
    const requiredSpec = spec({ params: [param("loud", { kind: "bool" }, true)] });
    expect(argsFromForm(requiredSpec, {})).toEqual({ loud: false });
    expect(argsFromForm(requiredSpec, { loud: true })).toEqual({ loud: true });
  });
});

// Le scorciatoie non si provano più qui: riconoscere un accordo è del registro
// dei comandi, che è l'unico posto che li vede tutti (`commands.test.ts`).

describe("il piano che si guarda prima di approvarlo", () => {
  it("una riga per nota, col numero di modifiche", () => {
    const plan: CommandPlan = {
      summary: "3 sostituzioni in 2 note",
      docs: ["p/A.md", "B.md", "C.md"],
      edits: [
        {
          doc: "p/A.md",
          edit: {
            base: "r1",
            edits: [
              { span: { start: 0, end: 1 }, text: "x" },
              { span: { start: 4, end: 5 }, text: "x" },
            ],
          },
        },
        { doc: "B.md", edit: { base: "r2", edits: [{ span: { start: 0, end: 1 }, text: "x" }] } },
      ],
    };
    expect(planLines(plan)).toEqual([
      // «2 modifiche»/«1 modifica» era un ternario sul conteggio, cioè una
      // forma plurale scelta in TypeScript. Il motore dei template non sa
      // sceglierne una (§12.4) — né quello di qui né quello del contratto — e
      // fingere di sì avrebbe voluto dire una frase giusta in due lingue e
      // sbagliata nelle altre. La frase è riscritta in forma che il plurale non
      // lo chiede, col numero come argomento: la stessa cura presa in
      // `stats::conteggi` dall'altro lato del confine.
      "A — Modifiche: 2",
      "B — Modifiche: 1",
      // Una nota impattata di cui la decisione 0008 non sa esprimere la modifica (una
      // che verrebbe creata o cestinata) resta nell'elenco: è ciò che si
      // approva.
      "C",
    ]);
  });
});

function mainView(id: string, params: ParamSpec[] = []): ViewSpec {
  return {
    id,
    title: `Vista ${id}`,
    surface: "main",
    refresh: { kinds: [], topics: [], subjects: [], changes: [] },
    follows: [],
    params,
    icon: null,
    order: 0,
    open_by_default: false,
    preferred_size: null,
    closable: true,
  };
}

// Nessuna view ha un posto riservato nella shell: la palette elenca quelle che
// un riquadro può ospitare, e aprirne una è l'intento di un comando qualunque.
describe("le view principali nella palette", () => {
  it("elenca quelle che si aprono senza argomenti e le apre con OpenView", async () => {
    setPrimaryViews([
      mainView("graph"),
      mainView("links", [param("doc", { kind: "document" }, true)]),
      mainView("board", [param("filter", { kind: "text" })]),
    ]);
    const effects: CommandEffect[] = [];
    const entries = viewEntries({ onEffect: (effect) => void effects.push(effect) });

    expect(entries.map((entry) => entry.id)).toEqual(["view:graph", "view:board"]);
    expect(entries[0]!.title).toBe(t("palette.open_view", { title: "Vista graph" }));
    expect(entries.every((entry) => entry.spec === null && entry.layer === "global")).toBe(true);

    await entries[0]!.run!();
    expect(effects).toEqual([{ kind: "open_view", view: "graph", params: null }]);
  });

  it("senza view principali non aggiunge niente", () => {
    setPrimaryViews([]);
    expect(viewEntries({ onEffect: () => {} })).toEqual([]);
  });
});
