// Il presidio della chiave di apertura: **solo `state/document-session.ts`
// apre e chiude un documento nell'host**.
//
// Una chiave di apertura tiene nell'host il modello di un documento di
// videoscrittura finché qualcuno non la chiude. La shell ne crea una per ogni
// `DocumentSession`, e la chiude da un'uscita sola quando la sessione esce: è
// l'unico modo di essere sicuri che ogni documento aperto si chiuda. Un
// pannello che aprisse da sé (`openDocument`), chiudesse da sé
// (`documentClosed`) o scrivesse sotto una chiave (`writeDocument` col quinto
// argomento) terrebbe chiavi che nessuno chiude, o chiuderebbe quelle di una
// sessione ancora aperta. Chi legge e basta usa `readDocument`.
//
// Il presidio cerca le **chiamate**, non la parola: `"documentClosed"` è anche
// un motivo di fine di una sessione live (`LiveEndReason`), e la definizione
// delle porte in `host/` non è una chiamata. I sorgenti si leggono con
// `import.meta.glob` di Vite e si analizzano col compilatore TypeScript.
import ts from "typescript";
import { describe, expect, it } from "vitest";

/// Tutti i `.ts` di `src/`, contenuto compreso. Le chiavi sono path relativi a
/// questo file (`../panels/search.ts`, `./document-session.ts`).
const SOURCES = import.meta.glob<string>("../**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

/// L'unico proprietario delle chiavi.
const OWNER = "./document-session.ts";

/// Le porte che aprono o chiudono.
const KEYED = new Set(["openDocument", "documentClosed"]);

/// Il nome della porta chiamata: `api.x(…)`, `api?.x(…)`, `api["x"](…)`. Una
/// funzione libera `openDocument(doc)` è l'apertura di una scheda della shell,
/// un'altra cosa, e non conta.
function calleeName(expression: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression)) {
    return expression.argumentExpression.text;
  }
  return null;
}

/// Le chiamate che aprono, chiudono o scrivono sotto una chiave, come
/// `riga: testo`.
function keyedCalls(path: string, source: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      // Un argomento sparso può portare la chiave in quinta posizione senza
      // che si veda: conta come una chiave.
      const keyedWrite =
        name === "writeDocument" &&
        (node.arguments.length >= 5 || node.arguments.some((argument) => ts.isSpreadElement(argument)));
      if ((name !== null && KEYED.has(name)) || keyedWrite) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
        found.push(`${path}:${line + 1}: ${node.getText(file).split("\n")[0]}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/// I sorgenti dell'app: i banchi chiamano le porte del finto per provarle.
const APP = Object.entries(SOURCES).filter(
  ([path]) => !path.endsWith(".test.ts") && !path.endsWith(".d.ts"),
);

describe("la chiave di apertura ha un solo proprietario", () => {
  it("legge davvero i sorgenti, e il proprietario apre e chiude", () => {
    expect(APP.length).toBeGreaterThan(100);
    expect(APP.map(([path]) => path)).toContain("../panels/search.ts");
    const owner = keyedCalls(OWNER, SOURCES[OWNER]!);
    expect(owner.some((call) => call.includes(".openDocument("))).toBe(true);
    expect(owner.some((call) => call.includes(".documentClosed("))).toBe(true);
    expect(owner.some((call) => call.includes(".writeDocument("))).toBe(true);
  });

  // Analizzare tutti i sorgenti col compilatore costa qualche secondo, e sotto
  // il giro completo dei banchi supera il tetto di default.
  it("nessun altro modulo apre, chiude o scrive sotto una chiave", { timeout: 30_000 }, () => {
    const offenders = APP.filter(([path]) => path !== OWNER).flatMap(([path, source]) => keyedCalls(path, source));
    expect(offenders).toEqual([]);
  });

  it("riconosce le chiamate e non la parola", () => {
    const sample = [
      `const reason: LiveEndReason = "documentClosed";`,
      `const api = { openDocument: (id: string, open: string) => read(id, open) };`,
      `void api.writeDocument(id, text, base, vault);`,
      `void api.readDocument(id, vault);`,
      `openDocument(doc);`,
    ].join("\n");
    expect(keyedCalls("esempio.ts", sample)).toEqual([]);
    const keyed = [
      `void api.openDocument(id, key);`,
      `void host["documentClosed"](key);`,
      `void api.writeDocument(id, text, base, vault, key);`,
      `void api.writeDocument(id, text, base, ...rest);`,
    ].join("\n");
    expect(keyedCalls("esempio.ts", keyed)).toHaveLength(4);
  });
});
