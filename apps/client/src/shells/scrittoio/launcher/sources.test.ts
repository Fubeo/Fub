import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerShellCommand, resetShellCommands } from "../../../ui/commands";

const world = vi.hoisted(() => {
  class SearchSyntaxError extends Error {}
  return {
    SearchSyntaxError,
    vault: "/vault" as string | null,
    recent: [] as string[],
    searches: [] as string[],
    names: [] as string[],
    matches: { items: [] as { doc: string; snippet?: string; highlights?: unknown[]; occurrences?: { span: { start: number; end: number } }[] }[], total: 0 },
    asked: [] as unknown[],
    /// Il vault con cui è arrivata ogni domanda all'indice (FUB-001).
    askedVault: [] as (string | undefined)[],
    indexing: "idle",
    outline: [] as { level: number; text: string; span: { start: number; end: number } }[],
    tags: [] as { name: string; count: number }[],
    active: "Uno.md" as string | null,
    shown: { k: "doc", doc: "Uno.md" } as { k: string; doc?: string } | null,
    buffer: "prima\nseconda è\nterza" as string | undefined,
    specs: [] as unknown[],
  };
});

vi.mock("../../../i18n/strings", () => ({
  t: (key: string, args?: Record<string, unknown>) => (args ? `${key} ${JSON.stringify(args)}` : key),
  onLanguage: () => () => {},
}));
vi.mock("../../../host/ipc", () => ({
  api: {
    queryIndex: async (query: { kind: string; doc: string }, vault?: string) => {
      world.asked.push(query);
      world.askedVault.push(vault);
      return { kind: "outline", value: world.outline };
    },
  },
}));
vi.mock("../../../host/query", () => ({
  SearchSyntaxError: world.SearchSyntaxError,
  WITHOUT_PAGE: "senza-finestra",
  searchExpression: (text: string) => {
    if (text.includes('"')) throw new world.SearchSyntaxError("virgolette aperte");
    return { expr: text };
  },
  matchingDocuments: async (expr: unknown, window: unknown) => {
    world.asked.push({ expr, window });
    return world.matches;
  },
  notesByName: async () => world.names,
  vaultStatus: async () => ({ indexing: world.indexing }),
  vaultTags: async () => world.tags,
}));
vi.mock("../../../state/document-controller", () => ({
  paneOf: () => ({ shown: world.shown, surface: { buffer: world.buffer === undefined ? null : { getDoc: () => world.buffer } } }),
}));
vi.mock("../../../state/layout", () => ({
  layout: { focus: "p0" },
  activeDoc: () => world.active,
}));
vi.mock("../../../state/palette-host", () => ({ paletteHost: {} }));
vi.mock("../../../state/recent", () => ({
  existingRecentNotes: async () => world.recent,
  recentSearches: () => world.searches,
}));
vi.mock("../../../state/store", () => ({
  // Le domande dei titoli nominano il vault aperto (FUB-001): come il vero.
  openVaultRoot: () => world.vault || undefined,
  vaultArg: (vault: string | null | undefined) => (vault ? [vault] : []),
  state: {
    get vaultRoot() {
      return world.vault;
    },
    // I comandi del kernel stanno qui: è da qui che il registro li legge.
    get commandSpecs() {
      return world.specs;
    },
  },
}));
// Della palette qui contano il filtro e l'ordine: bastano i più semplici.
vi.mock("../../../ui/palette", () => ({
  viewEntries: () => [{ id: "view:grafo", title: "Grafo", description: "", layer: "global", binding: null, declared: null, spec: null, run: () => {} }],
  orderCommands: (entries: { id: string }[], history: string[]) =>
    [...entries].sort((a, b) => Number(history.includes(b.id)) - Number(history.includes(a.id))),
  filterCommands: (entries: { title: string }[], text: string) =>
    entries.filter((entry) => entry.title.toLowerCase().includes(text.trim().toLowerCase())),
  paletteHistoryForTest: () => ["shell.palette"],
}));

import { LIST_LIMIT, SEARCH_LIMIT, TEMPLATE_COMMAND, TEMPLATES_FOLDER, answersAtOnce, listing } from "./sources";

beforeEach(() => {
  resetShellCommands();
  world.vault = "/vault";
  world.recent = [];
  world.searches = [];
  world.names = [];
  world.matches = { items: [], total: 0 };
  world.asked.length = 0;
  world.askedVault.length = 0;
  world.indexing = "idle";
  world.outline = [];
  world.tags = [];
  world.active = "Uno.md";
  world.shown = { k: "doc", doc: "Uno.md" };
  world.buffer = "prima\nseconda è\nterza";
  world.specs = [];
});

describe("i file", () => {
  it("senza vault lo dice", async () => {
    world.vault = null;
    expect(await listing("files", "x")).toEqual({ rows: [], note: "launcher.note.no_vault", total: null });
  });

  it("a campo vuoto offre le recenti, o un invito se non ce ne sono", async () => {
    expect((await listing("files", "  ")).note).toBe("launcher.note.files");
    world.recent = ["a/Uno.md", "Due.md"];
    const answer = await listing("files", "");
    expect(answer.rows).toEqual([
      { kind: "note", key: "n:a/Uno.md", doc: "a/Uno.md", recent: true, at: null, snippet: null },
      { kind: "note", key: "n:Due.md", doc: "Due.md", recent: true, at: null, snippet: null },
    ]);
  });

  it("con un testo cerca per nome", async () => {
    world.names = ["Guida/Banco.md"];
    const answer = await listing("files", " banco ");
    expect(answer.rows).toEqual([{ kind: "note", key: "n:Guida/Banco.md", doc: "Guida/Banco.md", recent: false, at: null, snippet: null }]);
  });

  it("senza risultati offre di creare la nota, se il testo può essere un nome", async () => {
    expect((await listing("files", "Idea nuova")).rows).toEqual([{ kind: "create", key: "create", name: "Idea nuova" }]);
    const refused = await listing("files", "///");
    expect(refused.rows).toEqual([]);
    expect(refused.note).toBe('launcher.note.files.none {"query":"///"}');
  });
});

describe("i comandi", () => {
  it("rispondono subito, con quelli del registro e le viste, i più usati per primi", () => {
    registerShellCommand({ id: "shell.switcher", title: "commands.switcher", description: "commands.switcher.desc", layer: "global", run: () => {} });
    registerShellCommand({ id: "shell.palette", title: "commands.palette", description: "commands.palette.desc", layer: "global", run: () => {} });
    expect(answersAtOnce("commands")).toBe(true);
    const answer = listing("commands", "");
    expect(answer).not.toBeInstanceOf(Promise);
    const rows = (answer as Awaited<typeof answer>).rows;
    expect(rows.map((row) => row.key)).toEqual(["c:shell.palette", "c:shell.switcher", "c:view:grafo"]);
  });

  it("filtrano, e senza niente lo dicono con la domanda", () => {
    const answer = listing("commands", " graf ") as Awaited<ReturnType<typeof listing>>;
    expect(answer.rows.map((row) => row.key)).toEqual(["c:view:grafo"]);
    const none = listing("commands", " zzz ") as Awaited<ReturnType<typeof listing>>;
    expect(none).toEqual({ rows: [], note: 'launcher.note.commands.none {"query":"zzz"}', total: null });
  });
});

describe("la ricerca", () => {
  it("a campo vuoto ripropone le ricerche recenti", async () => {
    expect((await listing("search", "")).note).toBe("launcher.note.search");
    world.searches = ["banco", "tag:#tema"];
    expect((await listing("search", "")).rows).toEqual([
      { kind: "query", key: "q:banco", query: "banco" },
      { kind: "query", key: "q:tag:#tema", query: "tag:#tema" },
    ]);
  });

  it("chiede una pagina sola, e porta estratto e punto del primo riscontro", async () => {
    world.matches = {
      items: [
        { doc: "Uno.md", snippet: "il banco vede", highlights: [{ start: 3, end: 8 }], occurrences: [{ span: { start: 42, end: 47 } }] },
        { doc: "Due.md" },
      ],
      total: 120,
    };
    const answer = await listing("search", "banco");
    expect(world.asked).toEqual([{ expr: { expr: "banco" }, window: { offset: 0, limit: SEARCH_LIMIT } }]);
    expect(answer.total).toBe(120);
    expect(answer.rows).toEqual([
      { kind: "note", key: "n:Uno.md", doc: "Uno.md", recent: false, at: 42, snippet: { text: "il banco vede", highlights: [{ start: 3, end: 8 }] } },
      { kind: "note", key: "n:Due.md", doc: "Due.md", recent: false, at: null, snippet: null },
    ]);
  });

  it("se li mostra tutti non dice un totale", async () => {
    world.matches = { items: [{ doc: "Uno.md" }], total: 1 };
    expect((await listing("search", "x")).total).toBeNull();
  });

  it("una sintassi a metà si dice, non è un guasto", async () => {
    const answer = await listing("search", '"aperta');
    expect(answer).toEqual({ rows: [], note: "virgolette aperte", total: null });
    expect(world.asked).toEqual([]);
  });

  it("senza risultati distingue l'indice ancora in corso", async () => {
    expect((await listing("search", "x")).note).toBe('launcher.note.search.none {"query":"x"}');
    world.indexing = "running";
    expect((await listing("search", "x")).note).toBe("launcher.note.search.indexing");
  });
});

describe("le intestazioni", () => {
  it("vogliono una nota attiva", async () => {
    world.active = null;
    expect((await listing("headings", "")).note).toBe("launcher.note.no_doc");
    expect(world.asked).toEqual([]);
  });

  it("vengono dall'indice della nota attiva, filtrate per testo", async () => {
    world.outline = [
      { level: 1, text: "Sintassi", span: { start: 0, end: 10 } },
      { level: 2, text: "Tabelle", span: { start: 30, end: 40 } },
    ];
    const all = await listing("headings", "");
    expect(world.asked).toEqual([{ kind: "outline", doc: "Uno.md" }]);
    expect(all.rows).toEqual([
      { kind: "heading", key: "h:0", doc: "Uno.md", level: 1, text: "Sintassi", at: 0 },
      { kind: "heading", key: "h:30", doc: "Uno.md", level: 2, text: "Tabelle", at: 30 },
    ]);
    expect((await listing("headings", "tab")).rows.map((row) => row.key)).toEqual(["h:30"]);
    expect((await listing("headings", "zzz")).note).toBe('launcher.note.headings.none {"query":"zzz"}');
  });

  it("la domanda all'indice nomina il vault aperto", async () => {
    await listing("headings", "");
    expect(world.askedVault).toEqual(["/vault"]);
  });

  it("una nota senza intestazioni lo dice", async () => {
    expect((await listing("headings", "")).note).toBe("launcher.note.headings");
  });
});

describe("le etichette", () => {
  it("si filtrano, chi comincia così per primo", async () => {
    world.tags = [{ name: "sistema", count: 2 }, { name: "tema", count: 12 }];
    expect((await listing("tags", "tem")).rows).toEqual([
      { kind: "tag", key: "t:tema", name: "tema", count: 12 },
      { kind: "tag", key: "t:sistema", name: "sistema", count: 2 },
    ]);
    expect((await listing("tags", "zzz")).note).toBe('launcher.note.tags.none {"query":"zzz"}');
  });

  it("un elenco lungo si ferma, e dice quante sono", async () => {
    world.tags = Array.from({ length: LIST_LIMIT + 5 }, (_, index) => ({ name: `t${index}`, count: 1 }));
    const answer = await listing("tags", "");
    expect(answer.rows).toHaveLength(LIST_LIMIT);
    expect(answer.total).toBe(LIST_LIMIT + 5);
  });

  it("un vault senza etichette lo dice", async () => {
    expect((await listing("tags", "")).note).toBe("launcher.note.tags");
  });
});

describe("la riga", () => {
  const now = (text: string) => listing("line", text) as Awaited<ReturnType<typeof listing>>;

  it("risponde subito, e senza un numero dice quante righe ci sono", () => {
    expect(answersAtOnce("line")).toBe(true);
    expect(now("")).toEqual({ rows: [], note: 'launcher.note.line {"lines":3}', total: null });
  });

  it("porta alla riga in byte: prima di lei ci sono le lettere accentate", () => {
    // «prima\nseconda è\n» sono 16 caratteri e 17 byte.
    expect(now("3").rows).toEqual([{ kind: "line", key: "line", doc: "Uno.md", line: 3, column: null, lines: 3, at: 17 }]);
    expect(now("2:9").rows).toEqual([{ kind: "line", key: "line", doc: "Uno.md", line: 2, column: 9, lines: 3, at: 14 }]);
  });

  it("una riga oltre la fine si ferma all'ultima", () => {
    expect(now("99").rows[0]).toMatchObject({ line: 3, lines: 3 });
  });

  it("senza un testo attivo non c'è dove andare", () => {
    world.shown = { k: "view" };
    expect(now("3").note).toBe("launcher.note.line.no_text");
    world.shown = { k: "doc", doc: "Uno.md" };
    world.buffer = undefined;
    expect(now("3").note).toBe("launcher.note.line.no_text");
    world.buffer = "x";
    world.active = null;
    expect(now("1").note).toBe("launcher.note.line.no_text");
  });
});

describe("i modelli", () => {
  /// Il comando com'è quando la feature dei modelli è accesa.
  const declare = (): void => {
    world.specs = [{ id: TEMPLATE_COMMAND, title: "Nuova nota da modello", description: "", scope: { reach: "vault" }, keybinding: null }];
  };

  it("senza il comando del kernel non si offrono", async () => {
    expect((await listing("templates", "")).note).toBe("launcher.note.templates.unavailable");
    expect(world.asked).toEqual([]);
  });

  it("sono le note della cartella dei modelli, filtrate per nome", async () => {
    declare();
    world.matches = { items: [{ doc: "Templates/Riunione.md" }, { doc: "Templates/Diario.md" }], total: 2 };
    const all = await listing("templates", "");
    expect(world.asked).toEqual([{ expr: { expr: `folder:${TEMPLATES_FOLDER}` }, window: "senza-finestra" }]);
    expect(all.rows).toEqual([
      { kind: "template", key: "m:Templates/Riunione.md", doc: "Templates/Riunione.md" },
      { kind: "template", key: "m:Templates/Diario.md", doc: "Templates/Diario.md" },
    ]);
    expect((await listing("templates", "dia")).rows.map((row) => row.key)).toEqual(["m:Templates/Diario.md"]);
    expect((await listing("templates", "zzz")).note).toBe('launcher.note.templates.none {"query":"zzz"}');
  });

  it("una cartella vuota dice dove metterli", async () => {
    declare();
    expect((await listing("templates", "")).note).toBe('launcher.note.templates {"folder":"Templates"}');
  });
});
