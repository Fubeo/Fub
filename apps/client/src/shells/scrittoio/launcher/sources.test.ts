import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerShellCommand, resetShellCommands } from "../../../ui/commands";

const world = vi.hoisted(() => {
  class SearchSyntaxError extends Error {}
  return {
    SearchSyntaxError,
    vault: "/vault" as string | null,
    recent: [] as string[],
    names: [] as string[],
    matches: { items: [] as { doc: string; snippet?: string; highlights?: unknown[]; occurrences?: { span: { start: number; end: number } }[] }[], total: 0 },
    asked: [] as unknown[],
    /// Il vault con cui è arrivata ogni domanda all'indice (FUB-001).
    askedVault: [] as (string | undefined)[],
    indexing: "idle",
    outline: [] as { level: number; text: string; span: { start: number; end: number } }[],
    /// L'indice che non sa dare i titoli (un host che non risponde a `outline`).
    outlineFails: false,
    tags: [] as { name: string; count: number }[],
    active: "Uno.md" as string | null,
    shown: { k: "doc", doc: "Uno.md" } as { k: string; doc?: string } | null,
    buffer: "prima\nseconda è\nterza" as string | undefined,
    specs: [] as unknown[],
    /// Le persone (la cartella delle persone del vault) e la cartella stessa.
    people: [] as string[],
    folder: "Persone",
    /// Le voci del «/» che la superficie sa fare, come le dà il catalogo.
    slash: [] as { id: string; label: string; section: string; action: boolean }[],
    /// I file del vault che non sono documenti (l'anagrafe, `of_kind: asset`).
    files: [] as string[],
    /// Quelli che nessuna superficie sa mostrare.
    hidden: [] as string[],
    /// Le pagine dell'anagrafe chieste, e se l'anagrafe risponde.
    entryPages: [] as { offset: number; limit: number }[],
    entriesFail: false,
    /// Le letture dell'anagrafe trattenute: ogni pagina aspetta la prima di
    /// queste, se ce n'è una.
    entryGates: [] as Promise<void>[],
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
      if (world.outlineFails) throw new Error("host fake: non so rispondere alla query outline");
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
  vaultEntries: async (window: { offset: number; limit: number }, kind: string) => {
    world.entryPages.push(window);
    const gate = world.entryGates.shift();
    if (gate) await gate;
    if (world.entriesFail) throw new Error("host fake: anagrafe guasta");
    if (kind !== "asset") throw new Error(`il lanciatore chiede solo i file, non ${kind}`);
    const items = world.files.slice(window.offset, window.offset + window.limit).map((id) => ({ id, kind: "asset", size: 1, mtime: 0, fingerprint: null }));
    return { items, offset: window.offset, total: world.files.length };
  },
  vaultStatus: async () => ({ indexing: world.indexing }),
  vaultTags: async () => world.tags,
}));
vi.mock("../../../state/document-controller", () => ({
  canShowFile: (id: string) => !world.hidden.includes(id),
  paneOf: () => ({ shown: world.shown, surface: { buffer: world.buffer === undefined ? null : { getDoc: () => world.buffer } } }),
}));
vi.mock("../../../state/layout", () => ({
  layout: { focus: "p0" },
  activeDoc: () => world.active,
}));
vi.mock("../../../state/palette-host", () => ({ paletteHost: {} }));
vi.mock("../../../state/people", () => ({
  // Come la ricerca vera: le persone il cui nome contiene la domanda.
  searchPeople: async (text: string) =>
    world.people.filter((doc) => text === "" || doc.toLowerCase().includes(text.toLowerCase())),
  peopleFolder: () => world.folder,
}));
vi.mock("../../../state/recent", () => ({
  existingRecentNotes: async () => world.recent,
}));
vi.mock("../../../panels/slash/entries", () => ({
  slashCatalog: () => ({ listed: world.slash, colors: [] }),
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

import {
  FILE_LIMIT,
  LIST_LIMIT,
  SEARCH_LIMIT,
  TEMPLATE_COMMAND,
  answersAtOnce,
  forgetFiles,
  listing,
  prefetchFiles,
  rereadFiles,
  selectable,
  type Row,
} from "./sources";

const ask = (mode: Parameters<typeof listing>[0], text: string) => listing(mode, text) as Promise<Awaited<ReturnType<typeof listing>>>;
const keys = (rows: Row[]) => rows.map((row) => row.key);

/// Una lettura dell'anagrafe che finisce quando lo dice il test.
function holdEntries(): () => void {
  let open!: () => void;
  world.entryGates.push(new Promise<void>((resolve) => {
    open = resolve;
  }));
  return open;
}

/// Il comando del kernel com'è dichiarato dal registro.
function spec(id: string, title: string, keybinding: string | null = null) {
  return { id, title, description: `${title}, descrizione`, scope: { reach: "document" }, keybinding, surfaces: [] };
}

beforeEach(() => {
  resetShellCommands();
  world.vault = "/vault";
  world.recent = [];
  world.names = [];
  world.matches = { items: [], total: 0 };
  world.asked.length = 0;
  world.askedVault.length = 0;
  world.indexing = "idle";
  world.outline = [];
  world.outlineFails = false;
  world.tags = [];
  world.active = "Uno.md";
  world.shown = { k: "doc", doc: "Uno.md" };
  world.buffer = "prima\nseconda è\nterza";
  world.specs = [];
  world.people = [];
  world.folder = "Persone";
  world.slash = [];
  world.files = [];
  world.hidden = [];
  world.entryPages.length = 0;
  world.entriesFail = false;
  world.entryGates.length = 0;
  forgetFiles();
});

describe("Tutto, a campo vuoto", () => {
  it("senza vault lo dice", async () => {
    world.vault = null;
    expect(await ask("all", "x")).toEqual({ rows: [], note: "launcher.note.no_vault", total: null });
  });

  it("offre le note recenti, e tre comandi per la nota aperta", async () => {
    world.recent = ["a/Uno.md", "Due.md"];
    world.specs = [spec("note.export", "Esporta"), spec("note.duplicate", "Duplica"), spec("note.subpage", "Sottopagina"), spec("note.trash", "Cestina")];
    const answer = await ask("all", "  ");
    expect(answer.rows).toEqual([
      { kind: "group", key: "g:recent", title: "launcher.group.recent" },
      { kind: "note", key: "n:a/Uno.md", doc: "a/Uno.md", hit: "recent", at: null, snippet: null },
      { kind: "note", key: "n:Due.md", doc: "Due.md", hit: "recent", at: null, snippet: null },
      { kind: "group", key: "g:here", title: "launcher.group.here" },
      { kind: "command", key: "c:note.export", entry: expect.objectContaining({ id: "note.export" }) },
      { kind: "command", key: "c:note.duplicate", entry: expect.objectContaining({ id: "note.duplicate" }) },
      { kind: "command", key: "c:note.subpage", entry: expect.objectContaining({ id: "note.subpage" }) },
    ]);
    expect(answer.rows.filter(selectable)).toHaveLength(5);
  });

  it("senza note recenti né comandi lo dice, con l'invito a scrivere", async () => {
    expect((await ask("all", "")).note).toBe("launcher.note.all");
  });

  it("senza una nota aperta non offre i comandi della nota", async () => {
    world.recent = ["Due.md"];
    world.active = null;
    world.specs = [spec("note.export", "Esporta")];
    expect(keys((await ask("all", "")).rows)).toEqual(["g:recent", "n:Due.md"]);
  });
});

describe("Tutto con un testo", () => {
  it("le note per nome vengono prima, nel gruppo «File»", async () => {
    world.names = ["Guida/Banco.md"];
    const answer = await ask("all", " banco ");
    expect(answer.rows).toEqual([
      { kind: "group", key: "g:files", title: "launcher.group.files" },
      { kind: "note", key: "n:Guida/Banco.md", doc: "Guida/Banco.md", hit: "name", at: null, snippet: null },
    ]);
  });

  it("le note per nome stanno nell'ordine che il kernel dà, senza che la shell lo rifaccia", async () => {
    // Il kernel ordina per pertinenza del nome (la corrispondenza esatta o
    // all'inizio del titolo prima di quella nel mezzo). La shell non rifà la
    // graduatoria: la mostra com'è, e il gruppo dei nomi viene prima.
    world.names = ["Guida/Nota lunga.md", "Benvenuto.md", "Idee/Appunti nota.md"];
    const answer = await ask("all", "nota");
    expect(keys(answer.rows)).toEqual(["g:files", "n:Guida/Nota lunga.md", "n:Benvenuto.md", "n:Idee/Appunti nota.md"]);
  });

  it("un PDF e un'immagine si trovano per nome, come le note, dopo i documenti", async () => {
    // L'indice dei nomi conosce i documenti; PDF e immagini li conosce
    // l'anagrafe. «Tutto» apre ogni file che Fub sa mostrare, come il
    // selettore di prima.
    world.names = ["Appunti di stampa.md"];
    world.files = ["R1/Stampa.pdf", "R1/Immagine.png", "Foto/Mare.jpg"];
    expect(keys((await ask("all", "stampa")).rows)).toEqual(["g:files", "n:R1/Stampa.pdf", "n:Appunti di stampa.md"]);
    world.names = [];
    const image = await ask("all", "immagine");
    expect(image.rows).toEqual([
      { kind: "group", key: "g:files", title: "launcher.group.files" },
      { kind: "note", key: "n:R1/Immagine.png", doc: "R1/Immagine.png", hit: "name", at: null, snippet: null },
    ]);
    // Il nome conta con l'estensione: «pdf» trova i PDF.
    expect(keys((await ask("all", "pdf")).rows)).toEqual(["g:files", "n:R1/Stampa.pdf"]);
  });

  it("un file che si chiama come si è scritto sale dopo i documenti che si chiamano così", async () => {
    world.names = ["Stampa.md", "Stampa vecchia.md"];
    world.files = ["Archivio/Una stampa.png", "R1/Stampa.pdf"];
    expect(keys((await ask("all", "Stampa")).rows)).toEqual([
      "g:files",
      "n:Stampa.md",
      "n:R1/Stampa.pdf",
      "n:Stampa vecchia.md",
      "n:Archivio/Una stampa.png",
    ]);
  });

  it("i file che nessuna superficie mostra non si offrono, e quelli che l'indice dà non si ripetono", async () => {
    world.names = ["R1/Stampa.pdf"];
    world.files = ["R1/Stampa.pdf", "Pacco/stampa.zip"];
    world.hidden = ["Pacco/stampa.zip"];
    expect(keys((await ask("all", "stampa")).rows)).toEqual(["g:files", "n:R1/Stampa.pdf"]);
  });

  it("l'anagrafe si legge tutta a pagine una volta per apertura, e si rilegge quando il lanciatore la dimentica", async () => {
    world.files = Array.from({ length: 1203 }, (_, i) => `Foto/scatto ${i}.png`);
    const first = await ask("all", "scatto");
    expect(first.rows.filter(selectable)).toHaveLength(FILE_LIMIT);
    expect(world.entryPages).toEqual([{ offset: 0, limit: 500 }, { offset: 500, limit: 500 }, { offset: 1000, limit: 500 }]);
    await ask("all", "scatto 12");
    expect(world.entryPages).toHaveLength(3);
    forgetFiles();
    world.files = ["Foto/scatto nuovo.png"];
    expect(keys((await ask("all", "scatto")).rows)).toEqual(["g:files", "n:Foto/scatto nuovo.png"]);
    expect(world.entryPages).toHaveLength(4);
  });

  it("se l'anagrafe non risponde le note per nome restano, e la domanda dopo riprova", async () => {
    world.names = ["Stampa.md"];
    world.files = ["R1/Stampa.pdf"];
    world.entriesFail = true;
    expect(keys((await ask("all", "stampa")).rows)).toEqual(["g:files", "n:Stampa.md"]);
    world.entriesFail = false;
    expect(keys((await ask("all", "stampa")).rows)).toEqual(["g:files", "n:Stampa.md", "n:R1/Stampa.pdf"]);
  });

  it("con l'anagrafe ancora in lettura i documenti arrivano subito, e i file dopo, nello stesso ordine", async () => {
    world.names = ["Appunti di stampa.md"];
    world.files = ["R1/Stampa.pdf"];
    const open = holdEntries();
    const answer = await ask("all", "stampa");
    expect(keys(answer.rows)).toEqual(["g:files", "n:Appunti di stampa.md"]);
    expect(answer.more).toBeDefined();
    open();
    const later = await answer.more!;
    expect(keys(later!.rows)).toEqual(["g:files", "n:R1/Stampa.pdf", "n:Appunti di stampa.md"]);
    // Letta l'anagrafe, la domanda dopo ha tutto subito.
    const next = await ask("all", "stampa");
    expect(keys(next.rows)).toEqual(["g:files", "n:R1/Stampa.pdf", "n:Appunti di stampa.md"]);
    expect(next.more).toBeUndefined();
  });

  it("senza niente da mostrare si aspettano i file, invece di dire «nessun risultato» e poi smentirlo", async () => {
    world.files = ["R1/Stampa.pdf"];
    const open = holdEntries();
    const coming = ask("all", "stampa");
    open();
    const answer = await coming;
    expect(keys(answer.rows)).toEqual(["g:files", "n:R1/Stampa.pdf"]);
    expect(answer.more).toBeUndefined();
    expect(answer.create).toBeUndefined();
  });

  it("i file arrivati dopo che non cambiano niente non rifanno l'elenco", async () => {
    world.names = ["Stampa.md"];
    world.files = ["Foto/Mare.jpg"];
    const open = holdEntries();
    const answer = await ask("all", "stampa");
    open();
    expect(await answer.more).toBeNull();
  });

  it("la lettura parte all'apertura (`prefetchFiles`), e i file riletti tengono intanto l'elenco di prima", async () => {
    world.files = ["R1/Stampa.pdf", "R1/Stampa vecchia.pdf"];
    prefetchFiles();
    expect(world.entryPages).toHaveLength(1);
    expect(keys((await ask("all", "stampa")).rows)).toEqual(["g:files", "n:R1/Stampa.pdf", "n:R1/Stampa vecchia.pdf"]);
    expect(world.entryPages).toHaveLength(1);
    // «Stampa vecchia» è stata cancellata: i documenti cambiano, e si rilegge.
    world.files = ["R1/Stampa.pdf"];
    const open = holdEntries();
    rereadFiles();
    const answer = await ask("all", "stampa");
    expect(keys(answer.rows)).toEqual(["g:files", "n:R1/Stampa.pdf", "n:R1/Stampa vecchia.pdf"]);
    open();
    expect(keys((await answer.more)!.rows)).toEqual(["g:files", "n:R1/Stampa.pdf"]);
  });

  it("un file rinominato che lascia l'elenco vuoto lo dice, e offre di creare", async () => {
    world.files = ["R1/Stampa.pdf"];
    prefetchFiles();
    await ask("all", "stampa");
    world.files = ["R1/Copia.pdf"];
    const open = holdEntries();
    rereadFiles();
    const answer = await ask("all", "stampa");
    open();
    const later = (await answer.more)!;
    expect(later.rows).toEqual([]);
    expect(later.note).toBe('launcher.note.all.create {"query":"stampa","name":"stampa"}');
    expect(later.create).toBe("stampa");
  });

  it("una lettura superata non scrive sopra quella nuova", async () => {
    world.files = ["Vecchio.pdf"];
    const slow = holdEntries();
    prefetchFiles();
    world.files = ["Nuovo.pdf"];
    rereadFiles();
    expect(keys((await ask("all", "pdf")).rows)).toEqual(["g:files", "n:Nuovo.pdf"]);
    slow();
    await Promise.resolve();
    expect(keys((await ask("all", "pdf")).rows)).toEqual(["g:files", "n:Nuovo.pdf"]);
  });

  it("la ricerca nel testo porta estratto e punto del primo riscontro, senza ripetere le note per nome", async () => {
    world.names = ["Uno.md"];
    world.matches = {
      items: [
        { doc: "Uno.md", snippet: "il banco vede", highlights: [{ start: 3, end: 8 }], occurrences: [{ span: { start: 42, end: 47 } }] },
        { doc: "Due.md", snippet: "un banco", highlights: [], occurrences: [{ span: { start: 7, end: 12 } }] },
      ],
      total: 2,
    };
    const answer = await ask("all", "banco");
    expect(world.asked[0]).toEqual({ expr: { expr: "banco" }, window: { offset: 0, limit: SEARCH_LIMIT } });
    expect(answer.rows).toEqual([
      { kind: "group", key: "g:files", title: "launcher.group.files" },
      { kind: "note", key: "n:Uno.md", doc: "Uno.md", hit: "name", at: null, snippet: null },
      { kind: "group", key: "g:text", title: "launcher.group.text" },
      { kind: "note", key: "n:Due.md", doc: "Due.md", hit: "text", at: 7, snippet: { text: "un banco", highlights: [] } },
    ]);
  });

  it("i titoli della nota attiva sono l'ultimo gruppo, filtrati per testo", async () => {
    world.outline = [
      { level: 1, text: "Sintassi", span: { start: 0, end: 10 } },
      { level: 2, text: "Tabelle", span: { start: 30, end: 40 } },
    ];
    const answer = await ask("all", "tab");
    expect(world.asked).toContainEqual({ kind: "outline", doc: "Uno.md" });
    expect(answer.rows.slice(-2)).toEqual([
      { kind: "group", key: "g:headings", title: "launcher.group.headings" },
      { kind: "heading", key: "h:30", doc: "Uno.md", level: 2, text: "Tabelle", at: 30 },
    ]);
  });

  it("se l'indice non dà i titoli, le note trovate restano: il gruppo dei titoli manca soltanto", async () => {
    world.names = ["Guida/Banco.md"];
    world.outline = [{ level: 1, text: "Banco", span: { start: 0, end: 5 } }];
    world.outlineFails = true;
    const answer = await ask("all", "banco");
    expect(answer.note).toBeNull();
    expect(keys(answer.rows)).toEqual(["g:files", "n:Guida/Banco.md"]);
  });

  it("la domanda all'indice dei titoli nomina il vault aperto", async () => {
    await ask("all", "x");
    expect(world.askedVault).toEqual(["/vault"]);
  });

  it("una sintassi a metà non blocca i gruppi che trovano, e se non trovano niente la dice", async () => {
    const answer = await ask("all", '"aperta');
    expect(answer).toEqual({ rows: [], note: "virgolette aperte", total: null });
    world.names = ["Aperta.md"];
    expect(keys((await ask("all", '"aperta')).rows)).toEqual(["g:files", "n:Aperta.md"]);
  });

  it("senza risultati propone di creare la nota, se il testo può essere un nome: solo allora la risposta dice che si può", async () => {
    const answer = await ask("all", "Idea nuova");
    expect(answer.note).toBe('launcher.note.all.create {"query":"Idea nuova","name":"Idea nuova"}');
    expect(answer.create).toBe("Idea nuova");
  });

  it("con l'indice in corso, una sintassi a metà o un nome impossibile non offre di creare", async () => {
    world.indexing = "running";
    expect((await ask("all", "Idea")).create).toBeUndefined();
    world.indexing = "idle";
    expect((await ask("all", '"Idea')).create).toBeUndefined();
    expect((await ask("all", "///")).create).toBeUndefined();
  });

  it("senza risultati e senza un nome possibile lo dice, senza offrire di creare", async () => {
    const refused = await ask("all", "///");
    expect(refused.rows).toEqual([]);
    expect(refused.note).toBe('launcher.note.all.none {"query":"///"}');
  });

  it("senza risultati distingue l'indice ancora in corso", async () => {
    expect((await ask("all", "x")).note).toBe('launcher.note.all.create {"query":"x","name":"x"}');
    world.indexing = "running";
    expect((await ask("all", "x")).note).toBe("launcher.note.all.indexing");
  });

  it("un elenco lungo si ferma a LIST_LIMIT righe scelte, e dice quante sono", async () => {
    world.names = Array.from({ length: LIST_LIMIT + 40 }, (_, index) => `Nota ${index}.md`);
    const answer = await ask("all", "nota");
    expect(answer.rows.filter(selectable)).toHaveLength(LIST_LIMIT);
    expect(answer.total).toBe(LIST_LIMIT + 40);
    expect(answer.rows[answer.rows.length - 1]).toMatchObject({ kind: "note" });
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

describe("l'aiuto", () => {
  it("elenca i comandi che hanno un tasto, col tasto che vale adesso", () => {
    registerShellCommand({ id: "shell.switcher", title: "commands.switcher", description: "commands.switcher.desc", layer: "global", run: () => {} });
    registerShellCommand({ id: "shell.launcher.search", title: "launcher.command.search", description: "launcher.command.search.desc", layer: "global", run: () => {} });
    const answer = listing("help", "") as Awaited<ReturnType<typeof listing>>;
    // Il tasto di «Vai alla nota» è quello di serie; chi non ne ha non entra.
    expect(answer.rows).toEqual([{ kind: "help", key: "k:shell.switcher", entry: expect.objectContaining({ id: "shell.switcher", binding: "Mod-o" }) }]);
  });

  it("filtra per testo, e senza niente dice la domanda", () => {
    registerShellCommand({ id: "shell.switcher", title: "commands.switcher", description: "commands.switcher.desc", layer: "global", run: () => {} });
    registerShellCommand({ id: "shell.palette", title: "commands.palette", description: "commands.palette.desc", layer: "global", run: () => {} });
    expect(keys((listing("help", "palette") as Awaited<ReturnType<typeof listing>>).rows)).toEqual(["k:shell.palette"]);
    expect(listing("help", " zzz ")).toEqual({ rows: [], note: 'launcher.note.help.none {"query":"zzz"}', total: null });
  });

  it("risponde subito, e senza comandi con tasto lo dice", () => {
    expect(answersAtOnce("help")).toBe(true);
    expect(listing("help", "")).toEqual({ rows: [], note: "launcher.note.help", total: null });
  });
});

describe("le persone", () => {
  it("con la cartella spenta lo dice, senza cercare", async () => {
    world.folder = "";
    expect((await ask("people", "Anna")).note).toBe("launcher.note.people.off");
  });

  it("elenca le persone della cartella, e a campo vuoto le prime", async () => {
    world.people = ["Persone/Anna Bianchi.md", "Persone/Luca.md"];
    const answer = await ask("people", "");
    expect(answer.rows).toEqual([
      { kind: "person", key: "p:Persone/Anna Bianchi.md", doc: "Persone/Anna Bianchi.md" },
      { kind: "person", key: "p:Persone/Luca.md", doc: "Persone/Luca.md" },
    ]);
  });

  it("con un nome che non è ancora una persona offre di crearla, in fondo", async () => {
    world.people = ["Persone/Anna Bianchi.md"];
    const answer = await ask("people", "Luca");
    expect(answer.rows).toEqual([{ kind: "create-person", key: "P:Luca", name: "Luca" }]);
  });

  it("con un nome già preso non offre di crearla", async () => {
    world.people = ["Persone/Luca.md"];
    expect(keys((await ask("people", "luca")).rows)).toEqual(["p:Persone/Luca.md"]);
  });

  it("senza persone e senza domanda lo dice", async () => {
    expect((await ask("people", "")).note).toBe("launcher.note.people");
    expect((await ask("people", "zzz")).rows.map((row) => row.kind)).toEqual(["create-person"]);
  });
});

describe("i blocchi", () => {
  /// Il registro dei comandi con due blocchi e un testo: uno dei suoi è per le liste.
  const declareBlocks = (): void => {
    world.specs = [
      spec("markdown.table", "Tabella"),
      spec("markdown.list.bullet", "Elenco"),
      spec("markdown.bold", "Grassetto"),
    ];
    world.slash = [
      { id: "markdown.table", label: "Tabella", section: "blocks", action: true },
      { id: "markdown.list.bullet", label: "Elenco", section: "lists", action: true },
      { id: "markdown.bold", label: "Grassetto", section: "style", action: true },
    ];
  };

  it("senza una nota di testo aperta lo dice", async () => {
    declareBlocks();
    world.shown = { k: "view" };
    expect((await ask("blocks", "")).note).toBe("launcher.note.blocks.no_text");
  });

  it("offre i blocchi del «/», nell'ordine delle sezioni, e lascia fuori lo stile", async () => {
    declareBlocks();
    const answer = listing("blocks", "") as Awaited<ReturnType<typeof listing>>;
    expect(answersAtOnce("blocks")).toBe(true);
    expect(keys(answer.rows)).toEqual(["b:markdown.list.bullet", "b:markdown.table"]);
  });

  it("filtra per testo, e senza niente lo dice", async () => {
    declareBlocks();
    expect(keys((listing("blocks", "tab") as Awaited<ReturnType<typeof listing>>).rows)).toEqual(["b:markdown.table"]);
    expect((listing("blocks", "zzz") as Awaited<ReturnType<typeof listing>>).note).toBe('launcher.note.blocks.none {"query":"zzz"}');
  });
});

describe("le etichette", () => {
  it("si filtrano, chi comincia così per primo", async () => {
    world.tags = [{ name: "sistema", count: 2 }, { name: "tema", count: 12 }];
    expect((await ask("tags", "tem")).rows).toEqual([
      { kind: "tag", key: "t:tema", name: "tema", count: 12 },
      { kind: "tag", key: "t:sistema", name: "sistema", count: 2 },
    ]);
    expect((await ask("tags", "zzz")).note).toBe('launcher.note.tags.none {"query":"zzz"}');
  });

  it("un elenco lungo si ferma, e dice quante sono", async () => {
    world.tags = Array.from({ length: LIST_LIMIT + 5 }, (_, index) => ({ name: `t${index}`, count: 1 }));
    const answer = await ask("tags", "");
    expect(answer.rows).toHaveLength(LIST_LIMIT);
    expect(answer.total).toBe(LIST_LIMIT + 5);
  });

  it("un vault senza etichette lo dice", async () => {
    expect((await ask("tags", "")).note).toBe("launcher.note.tags");
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

describe("le sorgenti", () => {
  it("non c'è più un modo dei modelli: il comando del kernel resta nel registro", () => {
    expect(TEMPLATE_COMMAND).toBe("note.from_template");
  });

  it("le intestazioni di gruppo non si scelgono", () => {
    expect(selectable({ kind: "group", key: "g:x", title: "x" })).toBe(false);
    expect(selectable({ kind: "tag", key: "t:x", name: "x", count: 1 })).toBe(true);
  });
});
