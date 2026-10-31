import { describe, expect, it, vi } from "vitest";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { dateCompletions, mentionContext, mentionSource, personCompletions, personName, type DateSource, type PeopleSource } from "./completions";

// `@` per le persone (K5): il contesto nel testo, il nome di una persona
// nuova e le opzioni, con la sorgente esercitata su un `EditorState`.

function ctxAt(doc: string, pos = doc.length): CompletionContext {
  return new CompletionContext(EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] }), pos, false);
}

function people(found: string[] = [], folder = "Persone"): PeopleSource & { created: string[]; asked: string[] } {
  const created: string[] = [];
  const asked: string[] = [];
  return {
    created,
    asked,
    folder: () => folder,
    search: async (text) => {
      asked.push(text);
      return found;
    },
    create: async (name) => {
      created.push(name);
      return `${folder}/${name}.md`;
    },
  };
}

describe("mentionContext", () => {
  it("riconosce una @ a inizio parola e il nome scritto dopo", () => {
    expect(mentionContext("chiama @Mar")).toEqual({ from: 7, query: "Mar" });
    expect(mentionContext("@")).toEqual({ from: 0, query: "" });
    expect(mentionContext("(@Anna")).toEqual({ from: 1, query: "Anna" });
  });

  it("tiene un nome di più parole, fino a quattro", () => {
    expect(mentionContext("con @Mario Rossi")).toEqual({ from: 4, query: "Mario Rossi" });
    expect(mentionContext("@a b c d e")).toBeNull();
  });

  it("non è una menzione un indirizzo, né una @ seguita da uno spazio", () => {
    expect(mentionContext("mario@posta")).toBeNull();
    expect(mentionContext("@Mario ")).toBeNull();
    expect(mentionContext("@ ")).toBeNull();
  });
});

describe("personName", () => {
  it("toglie i segni che un link o un path non reggono", () => {
    expect(personName("  Anna  [Bianchi]|x ")).toBe("Anna Bianchix");
    expect(personName("a/b\\c:d#e^f")).toBe("abcdef");
  });
});

describe("personCompletions", () => {
  it("propone le persone trovate con il nome come testo del link", () => {
    const options = personCompletions(["Persone/Anna Bianchi.md"], "Anna", people());
    expect(options).toHaveLength(2);
    expect(options[0]).toMatchObject({ displayLabel: "Anna Bianchi", apply: "[[Persone/Anna Bianchi|Anna Bianchi]]" });
    expect(String(options[1]!.displayLabel)).toContain("Anna");
  });

  it("non propone una persona nuova che c'è già, maiuscole a parte", () => {
    const options = personCompletions(["Persone/Anna.md"], "anna", people());
    expect(options).toHaveLength(1);
  });

  it("senza nome scritto, soltanto chi c'è", () => {
    expect(personCompletions([], "", people())).toEqual([]);
  });
});

describe("mentionSource", () => {
  it("cerca ciò che segue la @ e sostituisce dalla @", async () => {
    const source = people(["Persone/Anna.md"]);
    const result = (await mentionSource({ people: source })(ctxAt("ciao @An"))) as CompletionResult;
    expect(source.asked).toEqual(["An"]);
    expect(result.from).toBe(5);
    expect(result.filter).toBe(false);
  });

  it("tace nel codice, in un wikilink aperto e senza cartella", async () => {
    expect(await mentionSource({ people: people(["Persone/Anna.md"]) })(ctxAt("`@An"))).toBeNull();
    expect(await mentionSource({ people: people(["Persone/Anna.md"]) })(ctxAt("[[@An"))).toBeNull();
    expect(await mentionSource({ people: people(["Persone/Anna.md"], "") })(ctxAt("@An"))).toBeNull();
  });

  it("«Nuova persona» scrive il link e crea la nota nella cartella", async () => {
    const source = people([], "Gente");
    const state = EditorState.create({ doc: "con @Lia" });
    const result = (await mentionSource({ people: source })(new CompletionContext(state, state.doc.length, false))) as CompletionResult;
    const create = result.options[0]!;
    const dispatch = vi.fn();
    (create.apply as (view: unknown, c: unknown, from: number, to: number) => void)({ dispatch }, create, result.from, state.doc.length);
    expect(dispatch.mock.calls[0]![0]).toMatchObject({ changes: { from: 4, to: 8, insert: "[[Gente/Lia|Lia]]" } });
    await Promise.resolve();
    expect(source.created).toEqual(["Lia"]);
  });
});

describe("dateCompletions", () => {
  const dates: DateSource = { dailyPath: (iso) => `Daily/${iso}`, firstDay: () => 1, today: () => new Date(2026, 9, 29) };

  it("scrive il link alla giornaliera col giorno per esteso", () => {
    const [option] = dateCompletions("domani", dates, false);
    expect(String(option!.apply)).toMatch(/^\[\[Daily\/2026-10-30\|.*30.*2026\]\]$/);
  });

  it("in un compito offre anche la scadenza", () => {
    const options = dateCompletions("domani", dates, true);
    expect(options.map((each) => each.apply)).toContain("📅 2026-10-30");
  });

  it("la sorgente mette le date prima delle persone, e il compito lo dice la riga", async () => {
    const result = (await mentionSource({ people: people([]), dates })(ctxAt("- [ ] chiamare @domani"))) as CompletionResult;
    expect(result.options.map((each) => each.apply).filter((apply) => typeof apply === "string")).toEqual([
      expect.stringMatching(/^\[\[Daily\/2026-10-30\|/),
      "📅 2026-10-30",
    ]);
    expect(String(result.options[2]!.displayLabel)).toContain("domani");
  });
});
