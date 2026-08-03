import { describe, expect, it } from "vitest";
import type { CommandPlan, CommandSpec, ParamKind } from "../host/contract";
import { argsFromForm, filterCommands, fuzzyScore, needsPlan, planLines, scopeLabel } from "./palette";
import type { CommandEntry } from "./commands";

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
    ...over,
  };
}

/// Un comando **del kernel** come lo vede la palette: la spec, più l'accordo
/// efficace che il registro le mette accanto.
function voce(over: Partial<CommandSpec> = {}): CommandEntry {
  const s = spec(over);
  return {
    id: s.id,
    title: s.title,
    description: s.description,
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
    voce({ id: "vault.replace", title: "Sostituisci in tutte le note" }),
    voce({ id: "search.open", title: "Cerca nel vault", description: "ricerca full-text" }),
    voce({ id: "selection.wikilink", title: "Trasforma la selezione in wikilink" }),
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
    const ordinati = filterCommands(specs, "cerca");
    expect(ordinati[0].id).toBe("search.open");
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
    const ordinati = filterCommands(
      [voce({ id: "a", title: "Trasforma la selezione in wikilink" }), ...specs],
      "cerca",
    );
    expect(ordinati[0]!.id).toBe("search.open");
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
      param("limit", { kind: "number" }),
      param("nota", { kind: "document" }),
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
    const args = argsFromForm(s, { find: "x", replace: "y", docs: "", limit: "", nota: "" });
    expect(args).not.toHaveProperty("docs");
    expect(args).not.toHaveProperty("limit");
    expect(args).not.toHaveProperty("nota");
  });

  it("un elenco di documenti si scrive una riga per volta", () => {
    const args = argsFromForm(s, { find: "x", replace: "y", docs: "a.md\n b.md , c.md\n\n" });
    expect(args.docs).toEqual(["a.md", "b.md", "c.md"]);
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
