// I modelli di «Nuovo disegno»: i quattordici file del crate sono quelli che il
// generatore scrive, e ognuno si apre, si legge e si modifica come un disegno
// qualunque.
//
// Rigenerare i file dopo aver cambiato un modello:
//
//   UPDATE_TEMPLATES=1 npx vitest run src/editors/spatial/templates
//
// scrive i file al posto di confrontarli (come `UPDATE_MIRROR=1` per le
// specchiere); poi si rilancia senza, e si guarda il diff.

import { afterEach, describe, expect, it, vi } from "vitest";
import { describe as say, outline, type OutlineNode } from "../describe";
import { isNewId, type IdKind } from "../scene/ids";
import { SceneEngine } from "../scene/engine";
import { auditScene, isEditable, readScene } from "../scene/read";
import { problemsOf } from "../tools/audit";
import { boardsOf } from "../tools/boards";
import { followConnectors } from "../tools/connectors";
import { followEffects } from "../tools/effects";
import { followLabels } from "../tools/labels";
import { followTips } from "../tools/tips";
import { NewIds } from "../tools/edit";
import { buildTemplate, LANGS, TEMPLATE_IDS, templateFile, type Lang, type TemplateId } from "./build";
import { wordsOf } from "./content";
import { MEASURE } from "./sheet";

/// I file del crate, col nome come chiave: la cartella è fuori dal client e
/// si legge col `?raw` di Vite, come gli altri testi di prova.
const FILES = import.meta.glob("../../../../../../crates/fub-features/templates/*.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const SAVED = new Map<string, string>(Object.entries(FILES).map(([path, text]) => [path.slice(path.lastIndexOf("/") + 1), text]));

/// Vero se la prova è lanciata per riscrivere i file.
const environment = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const UPDATE = environment.UPDATE_TEMPLATES === "1";

/// Il genere di un id nuovo dalla sua prima lettera.
const KIND: Readonly<Record<string, IdKind>> = { o: "object", l: "layer", r: "resource", b: "board", c: "paper" };

const CASES: ReadonlyArray<readonly [TemplateId, Lang]> = TEMPLATE_IDS.flatMap((id) => LANGS.map((lang) => [id, lang] as const));

/// Il file del modello `id` nella lingua `lang`: quello salvato, o, quando si
/// riscrivono, quello appena costruito.
function fileOf(id: TemplateId, lang: Lang): string {
  const name = templateFile(id, lang);
  const text = UPDATE ? buildTemplate(id, lang) : SAVED.get(name);
  if (text === undefined) throw new Error(`manca il file ${name}`);
  return text;
}

/// Scrive i file nella cartella del crate. Il modulo di Node si importa col
/// nome calcolato: il client non ha i tipi di Node, e non ne ha bisogno altrove.
async function writeAll(): Promise<void> {
  const prefix = "node:";
  const fs = (await import(/* @vite-ignore */ `${prefix}fs`)) as { writeFileSync(path: URL, text: string): void; mkdirSync(path: URL, options: { recursive: boolean }): void };
  const folder = new URL("../../../../../../crates/fub-features/templates/", import.meta.url);
  fs.mkdirSync(folder, { recursive: true });
  for (const [id, lang] of CASES) fs.writeFileSync(new URL(templateFile(id, lang), folder), buildTemplate(id, lang));
}

/// Gli id di tutti gli elementi di un file.
const idsOf = (text: string): string[] => [...text.matchAll(/ id="([^"]+)"/g)].map((found) => found[1]!);

/// L'albero degli oggetti a parole, un oggetto per riga, rientrato per livello.
function words(nodes: readonly OutlineNode[], depth = 0): string[] {
  return nodes.flatMap((node) => [`${"  ".repeat(depth)}${say(node, { parts: true })}`, ...words(node.children, depth + 1)]);
}

afterEach(() => vi.unstubAllGlobals());

describe("i file", () => {
  it.runIf(UPDATE)("riscrive i quattordici file del crate", async () => {
    await writeAll();
  });

  // Riscrivendo i file non c'è niente da confrontare: i file salvati sono
  // quelli letti prima della riscrittura.
  it.skipIf(UPDATE)("sono quattordici, due per ogni modello, e il disegno vuoto non ne ha", () => {
    expect([...SAVED.keys()].sort()).toEqual(CASES.map(([id, lang]) => templateFile(id, lang)).sort());
    expect(TEMPLATE_IDS).not.toContain("blank");
  });

  for (const [id, lang] of CASES) {
    it.skipIf(UPDATE)(`${templateFile(id, lang)} è quello che il generatore scrive`, () => {
      expect(SAVED.get(templateFile(id, lang))).toBe(buildTemplate(id, lang));
    });
  }

  it("non cambiano con la lingua dell'interfaccia né fra una costruzione e l'altra", () => {
    for (const [id, lang] of CASES) {
      const first = buildTemplate(id, lang);
      vi.stubGlobal("navigator", { language: lang === "it" ? "en-GB" : "it-IT" });
      expect(buildTemplate(id, lang)).toBe(first);
      vi.unstubAllGlobals();
    }
  });
});

describe("ogni modello", () => {
  for (const [id, lang] of CASES) {
    const name = templateFile(id, lang);

    it(`${name}: si apre come un disegno modificabile e il motore non ne cambia il testo`, () => {
      const text = fileOf(id, lang);
      expect(isEditable(readScene(text))).toBe(true);
      const engine = SceneEngine.open(text);
      expect(engine.status).toBe("fubdraw");
      expect(engine.text).toBe(text);
      expect(text.endsWith("\n")).toBe(true);
      expect(text).not.toContain("\r");
    });

    it(`${name}: una modifica e il suo annulla lasciano il file com'è`, () => {
      const text = fileOf(id, lang);
      const engine = SceneEngine.open(text);
      const done = engine.apply({ op: "page", viewBox: "0 0 100 100" });
      expect(done.outcome).toBe("applied");
      expect(engine.text).not.toBe(text);
      if (done.outcome === "applied") expect(engine.undo(done.undo).outcome).toBe("applied");
      expect(engine.text).toBe(text);
    });

    it(`${name}: le etichette, i connettori, le punte e gli effetti non hanno niente da rimettere a posto`, () => {
      const text = fileOf(id, lang);
      const engine = SceneEngine.open(text);
      const model = engine.model!;
      const find = (found: string) => engine.holder(found);
      const touched = new Set(idsOf(text));
      expect(followLabels(model, touched, find, MEASURE)).toBeNull();
      expect(followConnectors(model, touched, find, MEASURE)).toBeNull();
      expect(followTips(model, touched, new NewIds((found) => find(found) !== null), find)).toBeNull();
      expect(followEffects(model, touched, find, MEASURE)).toBeNull();
    });

    it(`${name}: la verifica dell'accessibilità non ha niente da dire`, () => {
      const { scene, measures } = auditScene(fileOf(id, lang));
      expect(problemsOf(scene, measures)).toEqual([]);
      expect(scene.diagnostics.filter((diagnostic) => diagnostic.severity !== "info")).toEqual([]);
    });

    it(`${name}: il titolo è il nome del modello e gli id sono nuovi, leggibili e senza doppi`, () => {
      const text = fileOf(id, lang);
      expect(text).toContain(`<title>${wordsOf(lang).names[id]}</title>`);
      const ids = idsOf(text).filter((found) => found !== "fub-paper" && found !== "fub-defs");
      expect(new Set(ids).size).toBe(ids.length);
      for (const found of ids) {
        const kind = KIND[found.slice(0, 1)];
        expect(kind === undefined ? false : isNewId(found, kind), found).toBe(true);
      }
    });

    it(`${name}: ogni riferimento a un id porta a un id che c'è`, () => {
      const text = fileOf(id, lang);
      const known = new Set(idsOf(text));
      const references = [
        ...[...text.matchAll(/fub:(?:from|to)="(\S+) \S+"/g)].map((found) => found[1]!),
        ...[...text.matchAll(/fub:(?:inside|along)="(\S+?)(?: [^"]*)?"/g)].map((found) => found[1]!),
        ...[...text.matchAll(/url\(#([^)]+)\)/g)].map((found) => found[1]!),
      ];
      for (const reference of references) expect(known.has(reference), reference).toBe(true);
    });
  }

  it("le due lingue di un modello hanno lo stesso disegno: cambiano le parole", () => {
    // Senza le parole: i titoli, i nomi dei livelli e il testo dei tspan.
    const bare = (text: string): string =>
      text
        .replace(/<title>[^<]*<\/title>/g, "<title/>")
        .replace(/fub:layer="[^"]*"/g, 'fub:layer=""')
        .replace(/(<tspan[^>]*>)[^<]*/g, "$1");
    for (const id of TEMPLATE_IDS) {
      const [it, en] = LANGS.map((lang) => fileOf(id, lang));
      expect(idsOf(it!)).toEqual(idsOf(en!));
      expect(bare(it!)).toEqual(bare(en!));
    }
  });
});

describe("a parole", () => {
  /// L'albero degli oggetti di un file come lo dice l'interfaccia nella lingua
  /// del file, e i nomi delle sue tavole.
  function read(id: TemplateId, lang: Lang): { readonly objects: string[]; readonly boards: string[] } {
    vi.stubGlobal("navigator", { language: lang === "it" ? "it-IT" : "en-GB" });
    const engine = SceneEngine.open(fileOf(id, lang));
    return { objects: words(outline(readScene(engine.text).items)), boards: boardsOf(engine.model!).map((board) => board.name) };
  }

  it("la diapositiva e la lavagna hanno i loro testi e i loro livelli, nella lingua del file", () => {
    expect(read("slide", "it")).toEqual({
      objects: ["Livello «Livello 1»", "  Linea", "  Testo «Titolo della diapositiva»", "  Testo «Un sottotitolo che dice di che cosa si parla»"],
      boards: ["Diapositiva 1"],
    });
    expect(read("slide", "en")).toEqual({
      objects: ["Layer “Layer 1”", "  Line", "  Text “Slide title”", "  Text “A subtitle that says what it is about”"],
      boards: ["Slide 1"],
    });
    expect(read("lesson", "it").objects).toEqual(["Livello «Sfondo», bloccato", "  Tracciato «Foglio a quadretti»", "Livello «Lavagna»", "  Testo «Titolo della lezione»"]);
    expect(read("lesson", "en").objects).toEqual(["Layer “Background”, locked", "  Path “Graph paper”", "Layer “Board”", "  Text “Lesson title”"]);
  });

  it("lo storyboard ha sei scene, una per tavola", () => {
    expect(read("storyboard", "it")).toEqual({ objects: ["Livello «Livello 1»"], boards: ["Scena 1", "Scena 2", "Scena 3", "Scena 4", "Scena 5", "Scena 6"] });
    expect(read("storyboard", "en").boards).toEqual(["Scene 1", "Scene 2", "Scene 3", "Scene 4", "Scene 5", "Scene 6"]);
  });

  it("i fogli senza altro sono vuoti: un livello e basta", () => {
    for (const id of ["a4-portrait", "a4-landscape"] as const) {
      expect(read(id, "it")).toEqual({ objects: ["Livello «Livello 1»"], boards: [] });
      expect(read(id, "en")).toEqual({ objects: ["Layer “Layer 1”"], boards: [] });
    }
  });

  it("il diagramma di flusso ha le forme col nome delle loro parole e i connettori coi loro capi", () => {
    expect(read("diagram", "it").objects).toEqual([
      "Livello «Livello 1»",
      "  Gruppo «Inizio», 2 oggetti",
      "    Inizio o fine «Inizio»",
      "    Testo «Inizio»",
      "  Gruppo «Passo 1», 2 oggetti",
      "    Processo «Passo 1»",
      "    Testo «Passo 1»",
      "  Gruppo «Scelta», 2 oggetti",
      "    Decisione «Scelta»",
      "    Testo «Scelta»",
      "  Gruppo «Fine», 2 oggetti",
      "    Inizio o fine «Fine»",
      "    Testo «Fine»",
      "  Gruppo «Passo 2», 2 oggetti",
      "    Processo «Passo 2»",
      "    Testo «Passo 2»",
      "  Connettore da «Inizio» a «Passo 1»",
      "  Connettore da «Passo 1» a «Scelta»",
      "  Connettore «Sì» da «Scelta» a «Fine»",
      "  Testo «Sì»",
      "  Connettore «No» da «Scelta» a «Passo 2»",
      "  Testo «No»",
      "  Connettore da «Passo 2» a «Passo 1»",
    ]);
    expect(read("diagram", "en").objects).toEqual([
      "Layer “Layer 1”",
      "  Group “Start”, 2 objects",
      "    Start or end “Start”",
      "    Text “Start”",
      "  Group “Step 1”, 2 objects",
      "    Process “Step 1”",
      "    Text “Step 1”",
      "  Group “Choice”, 2 objects",
      "    Decision “Choice”",
      "    Text “Choice”",
      "  Group “End”, 2 objects",
      "    Start or end “End”",
      "    Text “End”",
      "  Group “Step 2”, 2 objects",
      "    Process “Step 2”",
      "    Text “Step 2”",
      "  Connector from “Start” to “Step 1”",
      "  Connector from “Step 1” to “Choice”",
      "  Connector “Yes” from “Choice” to “End”",
      "  Text “Yes”",
      "  Connector “No” from “Choice” to “Step 2”",
      "  Text “No”",
      "  Connector from “Step 2” to “Step 1”",
    ]);
  });

  it("la mappa concettuale ha l'argomento e quattro idee, ognuna legata all'argomento", () => {
    const idea = (n: number): string[] => [`  Gruppo «Idea ${n}», 2 oggetti`, `    Rettangolo arrotondato «Idea ${n}»`, `    Testo «Idea ${n}»`, `  Connettore da «Argomento» a «Idea ${n}»`];
    expect(read("concept-map", "it").objects).toEqual([
      "Livello «Livello 1»",
      "  Gruppo «Argomento», 2 oggetti",
      "    Ellisse «Argomento»",
      "    Testo «Argomento»",
      ...[1, 2, 3, 4].flatMap(idea),
    ]);
    expect(read("concept-map", "en").objects.filter((line) => line.startsWith("  Connector"))).toEqual([1, 2, 3, 4].map((n) => `  Connector from “Topic” to “Idea ${n}”`));
  });
});
