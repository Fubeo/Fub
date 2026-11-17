// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { BASE_ENTRY } from "../../../../panels/slash/entries";
import {
  BASE_ACTION, baseFileText, baseInsertion, baseName, baseStem, calloutTypeContext, codeLanguageContext, createBaseHere,
  cursorIsLiteral, slashContext, slashPlacement, SLASH_GAP, SLASH_MIN_HEIGHT, SLASH_QUERY_MAX, type NewBasePort,
} from "./slash";

describe("dove si apre il «/» nel testo", () => {
  it("a inizio riga o dopo uno spazio, con ciò che si scrive dopo", () => {
    expect(slashContext("/")).toEqual({ from: 0, query: "" });
    expect(slashContext("/tit")).toEqual({ from: 0, query: "tit" });
    expect(slashContext("Una riga /h2")).toEqual({ from: 9, query: "h2" });
    expect(slashContext("/titolo 2")).toEqual({ from: 0, query: "titolo 2" });
  });

  it("dentro una parola, in un URL o in una data resta testo", () => {
    expect(slashContext("e/o")).toBeNull();
    expect(slashContext("24/09")).toBeNull();
    expect(slashContext("https://fub.app/")).toBeNull();
    expect(slashContext("km/h")).toBeNull();
  });

  it("si chiude con uno spazio subito dopo, con due spazi, con un altro «/» o oltre il tetto", () => {
    expect(slashContext("/ ")).toBeNull();
    expect(slashContext("/titolo  ")).toBeNull();
    expect(slashContext("/a/b")).toBeNull();
    expect(slashContext(`/${"a".repeat(SLASH_QUERY_MAX)}`)).not.toBeNull();
    expect(slashContext(`/${"a".repeat(SLASH_QUERY_MAX + 1)}`)).toBeNull();
  });

  it("nel codice, nei link e in un wikilink aperto è letterale", () => {
    expect(cursorIsLiteral({ nodes: ["InlineCode", "Paragraph"], lineBefore: "`a " })).toBe(true);
    expect(cursorIsLiteral({ nodes: ["Paragraph"], lineBefore: "vedi [[Nota " })).toBe(true);
    expect(cursorIsLiteral({ nodes: ["Paragraph"], lineBefore: "vedi [[Nota]] " })).toBe(false);
  });
});

describe("i completamenti che una voce riapre", () => {
  it("il tipo di un callout, fra `[!` e `]`", () => {
    expect(calloutTypeContext("> [!", "]")).toEqual({ from: 4, query: "" });
    expect(calloutTypeContext("> [!war", "]")).toEqual({ from: 4, query: "war" });
    expect(calloutTypeContext("Testo [!", "]")).toBeNull();
  });

  it("il linguaggio sulla riga d'apertura di un recinto, con niente dopo", () => {
    expect(codeLanguageContext("```", "")).toEqual({ from: 3, query: "" });
    expect(codeLanguageContext("> ~~~py", "")).toEqual({ from: 5, query: "py" });
    expect(codeLanguageContext("```js", " x")).toBeNull();
    expect(codeLanguageContext("``", "")).toBeNull();
  });
});

describe("dove sta il pannello del «/»", () => {
  // L'area del documento va da 154 a 766, come nella finestra del banco: sopra
  // ci sono la barra della finestra, le linguette e la barra degli strumenti.
  const area = { top: 154, bottom: 766 };
  const line = (top: number) => ({ top, bottom: top + 30 });

  it("sotto la riga, alto quanto vuole, se ci sta", () => {
    expect(slashPlacement(line(200), 400, area)).toEqual({ above: false, top: 230 + SLASH_GAP, height: 400 });
  });

  it("sotto la riga accorciato, anche se sopra ci sarebbe più posto", () => {
    // Sotto 766 − 438 = 328 px, sopra 392: resta sotto e scorre dentro.
    const place = slashPlacement(line(400), 400, area);
    expect(place).toEqual({ above: false, top: 430 + SLASH_GAP, height: 766 - 430 - SLASH_GAP });
    expect(place.height).toBeGreaterThanOrEqual(SLASH_MIN_HEIGHT);
  });

  it("sopra soltanto se sotto non c'è neanche l'altezza minima, e mai oltre l'area", () => {
    // La riga vicino al fondo: sotto restano 28 px, sopra c'è l'altezza intera.
    expect(slashPlacement(line(700), 400, area)).toEqual({ above: true, top: 700 - SLASH_GAP - 400, height: 400 });
    // Sotto 168 px, sopra 398: si apre sopra, accorciato, e si ferma al bordo
    // alto dell'area, mai sopra la testata o le barre.
    const place = slashPlacement(line(560), 400, area);
    expect(place).toEqual({ above: true, top: area.top, height: 560 - SLASH_GAP - area.top });
  });

  it("sopra con tutta l'altezza quando c'è, attaccato alla riga", () => {
    const tall = { top: 0, bottom: 1000 };
    expect(slashPlacement(line(900), 400, tall)).toEqual({ above: true, top: 900 - SLASH_GAP - 400, height: 400 });
  });

  it("senza il minimo da nessuna parte prende il lato più alto e ci sta dentro", () => {
    const small = { top: 154, bottom: 400 };
    const low = slashPlacement(line(330), 400, small);
    expect(low).toEqual({ above: true, top: small.top, height: 330 - SLASH_GAP - small.top });
    const high = slashPlacement(line(160), 400, small);
    expect(high).toEqual({ above: false, top: 190 + SLASH_GAP, height: 400 - 190 - SLASH_GAP });
  });

  it("un pannello più basso del minimo non si apre sopra per questo", () => {
    // Un passo corto (120 px) sta sotto anche se il minimo non c'è.
    expect(slashPlacement(line(600), 120, area)).toEqual({ above: false, top: 630 + SLASH_GAP, height: 120 });
  });
});

describe("la Base dal «/» (T18)", () => {
  const views: EditorView[] = [];
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
  });

  /// Un editor con `doc`, il cursore alla fine del «/base».
  function editor(doc: string): EditorView {
    const at = doc.indexOf("/base") + "/base".length;
    const view = new EditorView({
      state: EditorState.create({ doc, extensions: [history()], selection: EditorSelection.cursor(at) }),
      parent: document.body.appendChild(document.createElement("div")),
    });
    views.push(view);
    return view;
  }

  /// Un host finto: `files` sono i file del vault, `answers` i nomi che
  /// l'utente scrive, uno per domanda (`undefined` = accetta la proposta).
  function host(note: string, files: string[], answers: (string | null | undefined)[] = [], fail?: unknown) {
    const asked: { proposal: string; taken: string | null }[] = [];
    const created: { id: string; text: string }[] = [];
    const notes: string[] = [];
    const vault = new Set(files);
    const port: NewBasePort = {
      note,
      taken: async (file) => [...vault].some((id) => id === file || id.endsWith(`/${file}`)),
      ask: async (proposal, taken) => {
        asked.push({ proposal, taken });
        const answer = answers.shift();
        return answer === undefined ? proposal : answer;
      },
      create: async (id, text) => {
        if (fail !== undefined) throw fail;
        if (vault.has(id)) throw { kind: "already_exists", path: id };
        vault.add(id);
        created.push({ id, text });
      },
      writable: () => true,
      notify: (message) => notes.push(message),
    };
    return { port, asked, created, notes };
  }

  const slash = (view: EditorView) => {
    const from = view.state.doc.toString().indexOf("/base");
    return [from, from + "/base".length] as const;
  };

  it("l'id della voce è quello dell'azione", () => {
    expect(BASE_ACTION).toBe(BASE_ENTRY);
  });

  it("il file e l'embed nascono insieme: il file accanto alla nota, l'embed al posto della riga", async () => {
    const view = editor("# Letture\n\n/base\n\nDopo");
    const fake = host("Libri/Letture.md", ["Libri/Letture.md"]);
    expect(await createBaseHere(view, ...slash(view), fake.port)).toBe(true);
    expect(fake.asked).toEqual([{ proposal: "Letture", taken: null }]);
    expect(fake.created).toEqual([{ id: "Libri/Letture.base", text: baseFileText("Libri", "Tabella") }]);
    expect(view.state.doc.toString()).toBe("# Letture\n\n![[Letture.base#Tabella]]\n\nDopo");
    expect(fake.notes).toEqual([]);
  });

  it("un errore di creazione lascia la nota com'era, e lo dice", async () => {
    const doc = "# Letture\n\n/base\n\nDopo";
    const view = editor(doc);
    const fake = host("Libri/Letture.md", [], [], { kind: "permission_denied", path: "Libri/Letture.base" });
    expect(await createBaseHere(view, ...slash(view), fake.port)).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
    expect(fake.created).toEqual([]);
    expect(fake.notes).toHaveLength(1);
    expect(fake.notes[0]).toMatch(/^La Base «Letture» non è stata creata: .+\. La nota resta com'era\.$/);
  });

  it("rinunciando al nome la nota non cambia e il file non nasce", async () => {
    const doc = "/base";
    const view = editor(doc);
    const fake = host("Letture.md", [], [null]);
    expect(await createBaseHere(view, ...slash(view), fake.port)).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
    expect(fake.created).toEqual([]);
    expect(fake.notes).toEqual([]);
  });

  it("Annulla toglie l'embed e rimette il «/base»; il file resta", async () => {
    const view = editor("Testo\n/base");
    const fake = host("Letture.md", []);
    await createBaseHere(view, ...slash(view), fake.port);
    expect(view.state.doc.toString()).toBe("Testo\n\n![[Letture.base#Tabella]]\n\n");
    undo(view);
    expect(view.state.doc.toString()).toBe("Testo\n/base");
    expect(fake.created.map((each) => each.id)).toEqual(["Letture.base"]);
  });

  it("un nome già preso nel vault propone «Nome 2»; uno scritto a mano e preso chiede di nuovo", async () => {
    const view = editor("/base");
    const fake = host("Libri/Letture.md", ["Letture.base", "Altro/Spesa.base"], ["Spesa", undefined]);
    expect(await createBaseHere(view, ...slash(view), fake.port)).toBe(true);
    expect(fake.asked).toEqual([
      { proposal: "Letture 2", taken: null },
      { proposal: "Spesa 2", taken: "Spesa" },
    ]);
    expect(fake.created.map((each) => each.id)).toEqual(["Libri/Spesa 2.base"]);
    expect(view.state.doc.toString()).toBe("![[Spesa 2.base#Tabella]]\n\n");
  });

  it("un file nato nel frattempo: il nome dopo, senza scrivere sopra", async () => {
    const view = editor("/base");
    const fake = host("Letture.md", []);
    // L'indice non lo sa ancora, il disco sì.
    const create = fake.port.create;
    let first = true;
    const port: NewBasePort = {
      ...fake.port,
      create: async (id, text) => {
        if (first) { first = false; throw { kind: "already_exists", path: id }; }
        return create(id, text);
      },
    };
    expect(await createBaseHere(view, ...slash(view), port)).toBe(true);
    expect(fake.asked.map((each) => each.proposal)).toEqual(["Letture", "Letture 2"]);
    expect(fake.created.map((each) => each.id)).toEqual(["Letture 2.base"]);
  });

  it("il testo scritto mentre si sceglie il nome resta, e l'embed va dove era il «/base»", async () => {
    const view = editor("Prima\n\n/base\n\nDopo");
    let release!: (name: string) => void;
    const fake = host("Letture.md", []);
    const port: NewBasePort = { ...fake.port, ask: () => new Promise((resolve) => { release = resolve; }) };
    const done = createBaseHere(view, ...slash(view), port);
    await Promise.resolve();
    await Promise.resolve();
    view.dispatch({ changes: { from: 0, insert: "Titolo\n\n" } });
    release("Letture");
    expect(await done).toBe(true);
    expect(view.state.doc.toString()).toBe("Titolo\n\nPrima\n\n![[Letture.base#Tabella]]\n\nDopo");
  });

  it("chiusa la nota (o in sola lettura) prima del nome, niente file e niente embed", async () => {
    const doc = "/base";
    const view = editor(doc);
    const fake = host("Letture.md", []);
    const port: NewBasePort = { ...fake.port, writable: () => false };
    expect(await createBaseHere(view, ...slash(view), port)).toBe(false);
    expect(fake.created).toEqual([]);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("i nomi: puliti dai caratteri che rompono il link o il file, e nei 255 byte", () => {
    expect(baseStem("Spesa.base")).toBe("Spesa");
    expect(baseStem("  a/b#c|d [e] ")).toBe("a b c d e");
    expect(baseStem("...")).toBe("");
    expect(baseName("Letture", 3)).toBe("Letture 3");
    const long = baseName("è".repeat(300), 12);
    expect(new TextEncoder().encode(`${long}.base`).byteLength).toBeLessThanOrEqual(255);
    expect(long.endsWith(" 12")).toBe(true);
  });

  it("il file: una vista Tabella sulla cartella della nota; nella radice su tutto il vault", () => {
    expect(baseFileText("Libri/2026", "Tabella")).toBe(
      'filters:\n  condition:\n    file: path\n    op: in_folder\n    value: "Libri/2026"\nviews:\n  - name: "Tabella"\n    type: table\n',
    );
    expect(baseFileText("", "Table")).toBe('views:\n  - name: "Table"\n    type: table\n');
  });

  it("l'embed è un blocco suo: staccato dal testo intorno, sotto se il «/» era dopo del testo", () => {
    const state = (doc: string) => EditorState.create({ doc });
    const place = (doc: string) => {
      const s = state(doc);
      const from = doc.indexOf("/base");
      const at = baseInsertion(s, from, from + 5, "E");
      return s.update({ changes: at }).state.doc.toString();
    };
    expect(place("A\n/base\nB")).toBe("A\n\nE\n\nB");
    expect(place("A\n\n/base\n\nB")).toBe("A\n\nE\n\nB");
    expect(place("Una riga /base")).toBe("Una riga\n\nE\n\n");
    expect(place("/base")).toBe("E\n\n");
    expect(place("A\n\n/base\n\n\n")).toBe("A\n\nE\n\n");
  });

  it("il cursore va oltre la Base: al testo che segue, o su una riga nuova in fondo", () => {
    const cursorAfter = (doc: string) => {
      const from = doc.indexOf("/base");
      const s = EditorState.create({ doc });
      const at = baseInsertion(s, from, from + 5, "E");
      const next = s.update({ changes: at }).state.doc;
      return [next.sliceString(at.cursor), next.lineAt(at.cursor).text];
    };
    expect(cursorAfter("A\n\n/base\n\nB")).toEqual(["B", "B"]);
    expect(cursorAfter("A\n/base\nB")).toEqual(["B", "B"]);
    expect(cursorAfter("A\n\n/base")).toEqual(["", ""]);
  });
});
