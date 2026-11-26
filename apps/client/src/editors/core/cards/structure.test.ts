// La guardia dell'ospite delle schede: **uno solo, qui in `editors/core/cards/`**
// (piano dell'editor, T41a; regola 1 delle sovrapposizioni).
//
// Il contratto delle schede (`contract.ts`), la porta per scrivere dentro una
// scheda (`editor-port.ts`) e le specie (`kinds/`) li usano la lavagna e,
// dopo, la nota. Una copia nella lavagna, anche piccola (un `CardRenderer`
// suo, un `createCardRegistry` riscritto, un rimando che li riesporta),
// farebbe divergere le due in silenzio: la regola si presidia leggendo i
// sorgenti, così un file nuovo che la rompe è rosso il giorno che lo si
// scrive.
//
// I sorgenti si leggono con `import.meta.glob` di Vite e non con `node:fs`,
// come in `host/no-tauri-outside-host.test.ts`: `tsconfig.json` non ha i tipi
// di Node.
import { describe, expect, it } from "vitest";

/// I sorgenti dell'ospite (le chiavi sono relative a questo file: `./contract.ts`).
const host = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/// I sorgenti della lavagna, prove comprese (`../../canvas/engine.ts`).
const canvas = import.meta.glob("../../canvas/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/// I sorgenti dello stato della shell (`../../../state/document-controller.ts`).
const state = import.meta.glob("../../../state/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/// Un nome uguale che non è una copia, col suo perché. Chiave: `file nome`.
const SAME_NAME_ELSEWHERE: Readonly<Record<string, string>> = {
  // Il campo semplice aperto su una scheda di testo della lavagna (T43/T44),
  // privato del motore: non è l'editor vero della porta (`CardEditor` del
  // contratto) e non esce dai file del motore.
  "engine-parts.ts CardEditor": "il campo aperto su una scheda di testo, privato del motore",
};

/// I nomi che l'ospite esporta: tipi, funzioni, costanti, classi.
function exportedNames(sources: Record<string, string>): Set<string> {
  const names = new Set<string>();
  const declaration = /^export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|class|interface|enum|type|const|let)\s+([A-Za-z_$][\w$]*)/gm;
  for (const text of Object.values(sources)) {
    for (const match of text.matchAll(declaration)) names.add(match[1]);
  }
  return names;
}

/// Le dichiarazioni di `name` in `text`, esportate o no (non i nomi dentro un `import`).
function declares(text: string, name: string): boolean {
  const n = name.replace(/\$/g, "\\$");
  const pattern = new RegExp(
    `^\\s*(?:export\\s+)?(?:declare\\s+)?(?:` +
      `(?:async\\s+)?function\\*?\\s+${n}\\b|(?:abstract\\s+)?class\\s+${n}\\b|interface\\s+${n}\\b|enum\\s+${n}\\b|` +
      `type\\s+${n}\\s*[<=]|(?:const|let|var)\\s+${n}\\s*[:=])`,
    "m",
  );
  return pattern.test(text);
}

/// `../../canvas/chrome/inspector.ts` → `chrome/inspector.ts`.
function canvasFile(key: string): string {
  return key.replace(/^\.\.\/\.\.\/canvas\//, "");
}

describe("l'ospite delle schede", () => {
  it("ha il contratto, la porta e le specie in editors/core/cards/", () => {
    expect(Object.keys(host).sort()).toEqual(
      expect.arrayContaining(["./contract.ts", "./editor-port.ts", "./kinds/note.ts"]),
    );
  });

  it("non torna nei vecchi posti della lavagna e dello stato", () => {
    const old = [
      ...Object.keys(canvas)
        .map(canvasFile)
        .filter((file) => file === "cards.ts" || file.startsWith("cards/")),
      ...Object.keys(state).filter((key) => key.endsWith("/card-editors.ts")),
    ];
    expect(old, "file dell'ospite fuori da editors/core/cards/").toEqual([]);
  });

  it("nessun file della lavagna ne ridefinisce un nome", () => {
    const names = exportedNames(host);
    // Il controllo vede davvero l'ospite: senza questi nomi la guardia non guarderebbe niente.
    for (const name of ["CardRenderer", "CardRegistry", "createCardRegistry", "liveCardIds", "createCardEditorPort", "noteCardRenderer"]) {
      expect(names.has(name), name).toBe(true);
    }
    const copies: string[] = [];
    for (const [key, text] of Object.entries(canvas)) {
      const file = canvasFile(key);
      for (const name of names) {
        if (declares(text, name) && !(`${file} ${name}` in SAME_NAME_ELSEWHERE)) copies.push(`${file}: ${name}`);
      }
    }
    expect(copies, "nomi dell'ospite dichiarati di nuovo in editors/canvas/").toEqual([]);
  });

  it("nessun file della lavagna lo riesporta", () => {
    const reexport = /^\s*export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s*from\s*["'][^"']*core\/cards\//m;
    const offenders = Object.entries(canvas)
      .filter(([, text]) => reexport.test(text))
      .map(([key]) => canvasFile(key));
    expect(offenders, "rimandi all'ospite da editors/canvas/").toEqual([]);
  });

  it("la guardia riconosce una copia", () => {
    expect(declares("export interface CardRenderer {\n}", "CardRenderer")).toBe(true);
    expect(declares("function createCardRegistry(r) {}", "createCardRegistry")).toBe(true);
    expect(declares("const liveCardIds = () => [];", "liveCardIds")).toBe(true);
    expect(declares("type CardMode = string;", "CardMode")).toBe(true);
    expect(declares("import {\n  type CardMode,\n} from \"x\";", "CardMode")).toBe(false);
  });
});
