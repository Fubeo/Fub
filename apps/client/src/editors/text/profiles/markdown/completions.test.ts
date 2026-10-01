import { describe, expect, it } from "vitest";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import {
  diagramFenceContext,
  diagramTemplateSource,
  noteCompletions,
  tagCompletions,
  tagContext,
  tagSource,
  wikilinkContext,
  wikilinkInsertText,
  wikilinkSource,
} from "./completions";

// Niente `EditorView` qui (vitest gira in node, senza DOM): le sorgenti CM6 si
// esercitano headless con un `CompletionContext` costruito su un
// `EditorState`, che è pura struttura dati.
function ctxAt(doc: string, pos: number, explicit = false): CompletionContext {
  return new CompletionContext(
    EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] }),
    pos,
    explicit,
  );
}

describe("wikilinkContext", () => {
  it("riconosce un [[ aperto e la query digitata", () => {
    expect(wikilinkContext("vedi [[Alp")).toEqual({ from: 7, query: "Alp" });
  });

  it("subito dopo [[ la query è vuota ma il contesto è attivo", () => {
    expect(wikilinkContext("[[")).toEqual({ from: 2, query: "" });
  });

  it("un link già chiuso non è un contesto", () => {
    expect(wikilinkContext("vedi [[Alpha]] e altro")).toBeNull();
  });

  it("in una riga con altri link conta l'ULTIMO [[ aperto", () => {
    expect(wikilinkContext("vedi [[Alpha]] e [[Be")).toEqual({ from: 19, query: "Be" });
  });

  it("gli accenti passano intatti nella query", () => {
    expect(wikilinkContext("[[Città")).toEqual({ from: 2, query: "Città" });
  });

  it("un a-capo dopo il [[ spegne il contesto", () => {
    expect(wikilinkContext("[[Alpha\nriga dopo")).toBeNull();
  });

  it("senza [[ non c'è contesto", () => {
    expect(wikilinkContext("testo qualsiasi")).toBeNull();
  });
});

describe("tagContext", () => {
  it("riconosce un tag a metà riga", () => {
    expect(tagContext("nota su #ru")).toEqual({ from: 8, query: "ru" });
  });

  it("supporta le gerarchie", () => {
    expect(tagContext("#area/lav")).toEqual({ from: 0, query: "area/lav" });
  });

  it("il # degli heading seguito da spazio non è un tag", () => {
    expect(tagContext("# Heading")).toBeNull();
    expect(tagContext("## ")).toBeNull();
  });

  it("un # dentro una parola (a#b) non è un tag", () => {
    expect(tagContext("a#b")).toBeNull();
  });

  it("un # nudo a inizio riga apre il contesto (heading o tag lo decide il seguito)", () => {
    expect(tagContext("#")).toEqual({ from: 0, query: "" });
  });

  it("guarda solo la riga corrente", () => {
    expect(tagContext("#altro\ntesto #qui")).toEqual({ from: 13, query: "qui" });
  });
});

describe("wikilinkInsertText", () => {
  it("aggiunge ]] quando dopo il cursore non c'è", () => {
    expect(wikilinkInsertText("Alpha", " e poi")).toBe("Alpha]]");
  });

  it("NON raddoppia ]] se è già subito dopo il cursore", () => {
    expect(wikilinkInsertText("Alpha", "]] e poi")).toBe("Alpha");
  });
});

describe("noteCompletions", () => {
  const docs = ["Alpha.md", "Progetti/Beta.md", "Progetti/Alpha.md", "Note.backup"];

  it("label = nome pagina, detail = path", () => {
    const beta = noteCompletions(docs, false).find((c) => c.label === "Beta");
    expect(beta).toMatchObject({ label: "Beta", detail: "Progetti/Beta.md", apply: "Beta]]" });
  });

  it("gli omonimi in cartelle diverse si inseriscono col path senza estensione", () => {
    const [root, nested] = noteCompletions(docs, false).filter((c) => c.label === "Alpha");
    expect(root.apply).toBe("Alpha]]");
    expect(nested.apply).toBe("Progetti/Alpha]]");
  });

  it("con ]] già presente l'inserimento non chiude di nuovo", () => {
    const beta = noteCompletions(docs, true).find((c) => c.label === "Beta");
    expect(beta?.apply).toBe("Beta");
  });

  it("il nome pagina segue la regola di pageName anche sui nomi ostili", () => {
    const backup = noteCompletions(docs, false).find((c) => c.detail === "Note.backup");
    expect(backup?.label).toBe("Note");
  });
});

describe("tagCompletions", () => {
  it("label = #nome, detail = conteggio", () => {
    expect(tagCompletions([{ name: "rust", count: 2 }])).toEqual([
      { label: "#rust", detail: "2", type: "keyword" },
    ]);
    expect(tagCompletions([{ name: "area/lavoro", count: 7 }])[0].label).toBe("#area/lavoro");
  });
});

describe("wikilinkSource (headless)", () => {
  const searchNotes = async () => ["Alpha.md", "Progetti/Beta.md"];

  it("dentro [[ propone le note, dal punto giusto", async () => {
    const doc = "vedi [[Al";
    const res = (await wikilinkSource(searchNotes)(ctxAt(doc, doc.length))) as CompletionResult;
    expect(res).not.toBeNull();
    expect(res.from).toBe(7);
    expect(res.options.map((o) => o.label)).toEqual(["Alpha", "Beta"]);
    expect(res.options[0].apply).toBe("Alpha]]");
  });

  it("con ]] subito dopo il cursore l'inserimento non chiude di nuovo", async () => {
    const doc = "vedi [[Al]] fine";
    const res = (await wikilinkSource(searchNotes)(ctxAt(doc, 9))) as CompletionResult;
    expect(res.options[0].apply).toBe("Alpha");
  });

  it("fuori dalla prima riga il range resta sulla riga del cursore", async () => {
    // Il range finiva a `inizio riga + posizione`: oltre la fine del
    // documento, e Invio falliva lasciando il posto all'a capo.
    const closed = "prima riga\nvedi [[Al]] fine";
    const atClose = closed.indexOf("]]");
    const res = (await wikilinkSource(searchNotes)(ctxAt(closed, atClose))) as CompletionResult;
    expect(res.from).toBe(closed.indexOf("[[") + 2);
    expect(res.to).toBe(atClose);
    expect(res.options[0].apply).toBe("Alpha");

    const open = "prima riga\nvedi [[Al";
    const tail = (await wikilinkSource(searchNotes)(ctxAt(open, open.length))) as CompletionResult;
    expect(tail.to).toBe(open.length);
  });

  it("fuori contesto risponde null: nessun popup", async () => {
    const doc = "testo normale";
    expect(await wikilinkSource(searchNotes)(ctxAt(doc, doc.length))).toBeNull();
  });

  // --- il §21.5, e le due righe che lo rendono vero ------------------------

  it("la sorgente riceve il PREFISSO digitato, non una domanda senza argomenti", async () => {
    // È tutta la voce: prima la sorgente chiedeva l'elenco intero e il filtro
    // lo faceva CodeMirror; adesso la domanda porta con sé ciò che si è
    // scritto, e a filtrare è chi ha l'indice.
    const requestedPrefixes: string[] = [];
    const source = async (prefix: string) => {
      requestedPrefixes.push(prefix);
      return ["Alpha.md"];
    };
    const doc = "vedi [[Alp";
    await wikilinkSource(source)(ctxAt(doc, doc.length));
    expect(requestedPrefixes).toEqual(["Alp"]);
  });

  it("su [[ appena aperto il prefisso è vuoto: cosa proporre lo decide chi inietta", async () => {
    const requestedPrefixes: string[] = [];
    const source = async (prefix: string) => {
      requestedPrefixes.push(prefix);
      return ["Recente.md"];
    };
    const doc = "vedi [[";
    const res = (await wikilinkSource(source)(ctxAt(doc, doc.length))) as CompletionResult;
    expect(requestedPrefixes).toEqual([""]);
    expect(res.options.map((o) => o.label)).toEqual(["Recente"]);
  });

  it("niente validFor e filter: false — CM6 non rifiltra e non riordina", async () => {
    // Le due metà della stessa decisione. `validFor` faceva ripartire la
    // sorgente una volta per `[[`: con la query sul prefisso deve ripartire a
    // ogni battuta, o si rifiltrerebbe una finestra vecchia. E `filter: false`
    // difende l'ordine del kernel: senza, il fuzzy di CodeMirror rimescolerebbe
    // una rilevanza calcolata dove ci sono i dati per calcolarla.
    const doc = "vedi [[Al";
    const res = (await wikilinkSource(searchNotes)(ctxAt(doc, doc.length))) as CompletionResult;
    expect(res.validFor).toBeUndefined();
    expect(res.filter).toBe(false);
  });

  it("l'ordine di chi cerca è l'ordine proposto", async () => {
    // Il kernel ordina per pertinenza, e `noteCompletions` è un map: se un
    // giorno diventasse un sort, questo banco diventa rosso.
    const source = async () => ["Zeta.md", "Alpha.md", "Mu.md"];
    const doc = "vedi [[a";
    const res = (await wikilinkSource(source)(ctxAt(doc, doc.length))) as CompletionResult;
    expect(res.options.map((o) => o.label)).toEqual(["Zeta", "Alpha", "Mu"]);
  });
});

describe("tagSource (headless)", () => {
  const listTags = async () => [
    { name: "rust", count: 2 },
    { name: "area/lavoro", count: 1 },
  ];

  it("su un token # propone i tag con il conteggio", async () => {
    const doc = "nota #ru";
    const res = (await tagSource(listTags)(ctxAt(doc, doc.length))) as CompletionResult;
    expect(res).not.toBeNull();
    expect(res.from).toBe(5);
    expect(res.options).toEqual([
      { label: "#rust", detail: "2", type: "keyword" },
      { label: "#area/lavoro", detail: "1", type: "keyword" },
    ]);
  });

  it("un tag Unicode fuori dal codice conserva gli offset in code unit", async () => {
    const doc = "nota 🎯 #città";
    const res = (await tagSource(listTags)(ctxAt(doc, doc.length))) as CompletionResult;
    expect(res.from).toBe(8);
    expect(res.to).toBe(doc.length);
  });

  it("dentro il codice inline non propone tag", async () => {
    const doc = "`🎯 #città`";
    expect(await tagSource(listTags)(ctxAt(doc, doc.length - 1))).toBeNull();
  });

  it("dentro una fence non propone tag", async () => {
    const doc = "```\n#città\n```";
    const pos = doc.indexOf("#") + "#città".length;
    expect(await tagSource(listTags)(ctxAt(doc, pos))).toBeNull();
  });

  it("su un heading risponde null", async () => {
    const doc = "# Heading";
    expect(await tagSource(listTags)(ctxAt(doc, doc.length))).toBeNull();
  });
});

describe("diagramFenceContext", () => {
  const at = (doc: string, pos = doc.length) => diagramFenceContext(ctxAt(doc, pos).state, pos);

  it("nel corpo di un recinto mermaid ancora aperto, con la chiusura da aggiungere", () => {
    expect(at("```mermaid\nfl")).toEqual({ from: 11, to: 13, query: "fl", indent: "", close: "\n```" });
  });

  it("in un recinto chiuso non aggiunge niente, e tiene la marca d'apertura", () => {
    const doc = "```mermaid\nfl\n```";
    expect(at(doc, 13)).toMatchObject({ query: "fl", close: "" });
    expect(at("~~~~Mermaid\nse")).toMatchObject({ query: "se", close: "\n~~~~" });
  });

  it("su una riga vuota del corpo la parola è vuota", () => {
    const doc = "Testo.\n\n```mermaid\n\n```";
    expect(at(doc, doc.indexOf("\n```", 10))).toMatchObject({ query: "", close: "" });
  });

  it("i commenti %% e le righe vuote non contano: la direttiva di stile può stare prima", () => {
    expect(at("```mermaid\n%% stile: aurora\n\nga")).toMatchObject({ query: "ga" });
  });

  it("dentro una lista o una citazione porta il rientro della riga", () => {
    expect(at("- voce\n\n  ```mermaid\n  fl")).toMatchObject({ query: "fl", indent: "  ", close: "\n  ```" });
    expect(at("> ```mermaid\n> pi")).toMatchObject({ query: "pi", indent: "> ", close: "\n> ```" });
  });

  it("un corpo che ha già un diagramma non è un contesto", () => {
    const doc = "```mermaid\nflowchart LR\n  A --> B\nx\n```";
    expect(at(doc, doc.indexOf("x\n") + 1)).toBeNull();
    const after = "```mermaid\nfl\n  A --> B\n```";
    expect(at(after, 13)).toBeNull();
  });

  it("né la riga d'apertura, né la chiusura, né testo dopo il cursore, né un altro linguaggio", () => {
    expect(at("```mermaid")).toBeNull();
    expect(at("```mermaid\n\n```", 12)).toBeNull();
    expect(at("```mermaid\n\n```", 15)).toBeNull();
    expect(at("```mermaid\nfl altro", 13)).toBeNull();
    expect(at("```python\nfl")).toBeNull();
    expect(at("fl")).toBeNull();
  });
});

describe("diagramTemplateSource (headless)", () => {
  const today = () => new Date(2026, 9, 1);

  it("scrivendo la prima parola propone i modelli che nomina, già pronti da inserire", async () => {
    const doc = "```mermaid\nseq";
    const res = await diagramTemplateSource(today)(ctxAt(doc, doc.length)) as CompletionResult;
    expect(res).toMatchObject({ from: 11, to: doc.length, filter: false });
    expect(res.options.map((option) => [option.label, option.detail, option.section])).toEqual([
      ["Sequenza", "sequenceDiagram", "Modelli di diagramma"],
    ]);
    expect(res.options[0]!.info).toBe("Messaggi fra partecipanti, nel tempo");
    const apply = res.options[0]!.apply as string;
    expect(apply.startsWith("sequenceDiagram\n  autonumber\n")).toBe(true);
    expect(apply.endsWith("il giro completo\n```")).toBe(true);
  });

  it("su una riga vuota solo a richiesta, e allora tutti e quattordici", async () => {
    const doc = "```mermaid\n\n```";
    // Senza richiesta risponde subito, senza caricare i modelli.
    expect(diagramTemplateSource(today)(ctxAt(doc, 11))).toBeNull();
    const res = await diagramTemplateSource(today)(ctxAt(doc, 11, true)) as CompletionResult;
    expect(res.options).toHaveLength(14);
    expect(res.options[0]!.label).toBe("Diagramma di flusso");
  });

  it("il Gantt parte dal giorno iniettato, rientrato come la riga", async () => {
    const doc = "- piano\n\n  ```mermaid\n  gan";
    const res = await diagramTemplateSource(today)(ctxAt(doc, doc.length)) as CompletionResult;
    const apply = res.options[0]!.apply as string;
    expect(apply).toContain("\n      Ricerca :done, r1, 2026-10-01, 5d\n");
    expect(apply.endsWith("\n  ```")).toBe(true);
  });

  it("una parola che non nomina niente non apre il popup", async () => {
    const doc = "```mermaid\nzzz";
    expect(await diagramTemplateSource(today)(ctxAt(doc, doc.length))).toBeNull();
  });

  it("dentro il recinto le note e i tag restano zitti", async () => {
    const doc = "```mermaid\n[[Al";
    expect(await wikilinkSource(async () => ["Alpha.md"])(ctxAt(doc, doc.length))).toBeNull();
  });
});
