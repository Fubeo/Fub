// Il presidio del confine dell'inchiostro: **`src/ink/` non conosce i prodotti
// che lo usano**.
//
// L'inchiostro (campioni, ruoli, pressione, stabilizzatore, ciclo di vita del
// tratto, pennello) è un componente di sistema che più superfici e più prodotti
// devono poter riusare: FubDraw è il primo consumatore, non il proprietario. Se
// un solo modulo di qui importa l'editor dei disegni, la shell, lo stato o un
// formato, il componente non è più riusabile e la penna di un prodotto futuro
// dovrebbe copiarsi o trascinarsi dietro FubDraw. Per questo la regola si
// presidia leggendo i sorgenti, che è l'unico modo che non dipende da chi la
// ricorda (come `host/no-tauri-outside-host.test.ts`).
//
// Le regole:
//
// - un modulo di `src/ink/` importa soltanto moduli di `src/ink/`, il pacchetto
//   del contorno (`perfect-freehand`) e, dall'unico adattatore del browser
//   (`dom/`), il gestore di ciclo di vita dei listener (`ui/lifetime`), che è
//   un'utilità e non un prodotto;
// - il nucleo (`input/`, il pennello, il formato dei campioni) non importa
//   l'adattatore e non usa globali del DOM: gira anche senza browser;
// - niente `@tauri-apps`, `@codemirror`, né un modulo il cui nome dica PDF: il
//   componente non porta con sé una modalità di prodotto.
//
// I sorgenti si leggono con `import.meta.glob` di Vite e non con `node:fs`
// perché `tsconfig.json` dichiara `types` senza Node: un presidio della
// portabilità non deve essere il primo a rinunciarci.
import { describe, expect, it } from "vitest";

/// Tutti i `.ts` sotto `src/ink/`, contenuto compreso. Le chiavi sono path
/// relativi a questo file (`./input/session.ts`).
const sources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/// I moduli fuori da `src/ink/` che l'adattatore del browser può importare.
const ALLOWED_OUTSIDE = new Set(["ui/lifetime"]);

/// I pacchetti che il componente usa: il calcolo del contorno (`pf1`).
const ALLOWED_PACKAGES = new Set(["perfect-freehand"]);

/// Il modulo di un `import`/`export … from` o `import(...)`: la stringa, non la
/// riga, così un `import type` su più righe conta come uno normale.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

/// Un file come path da `src/`: `./input/session.ts` → `ink/input/session.ts`.
function fromSrc(key: string): string {
  return `ink/${key.slice(2)}`;
}

/// Il path da `src/` di ciò che `specifier` nomina, visto dal file `file`
/// (anch'esso da `src/`); `null` per un pacchetto.
function resolve(file: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const parts = file.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }
  return parts.join("/");
}

function specifiers(text: string): string[] {
  return [...text.matchAll(SPECIFIER)].map((match) => match[1]!);
}

/// Il codice senza i commenti di riga, che qui spiegano ciò che il modulo non fa
/// e nominano il DOM e il PDF a ragion veduta.
function code(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

const modules = Object.entries(sources)
  .filter(([key]) => !key.endsWith(".test.ts"))
  .map(([key, text]) => ({ file: fromSrc(key), text }));

const core = modules.filter(({ file }) => !file.startsWith("ink/dom/"));

describe("il confine dell'inchiostro", () => {
  it("legge davvero i sorgenti", () => {
    // Un glob che non trova più nulla fa passare ogni presidio.
    const files = modules.map(({ file }) => file);
    expect(files.length).toBeGreaterThan(8);
    for (const expected of [
      "ink/input/session.ts",
      "ink/input/stabilizer.ts",
      "ink/dom/pointer-adapter.ts",
      "ink/sample.ts",
    ]) {
      expect(files).toContain(expected);
    }
  });

  it("importa soltanto se stesso, e dal browser solo le utilità elencate", () => {
    const offenders: string[] = [];
    for (const { file, text } of modules) {
      for (const specifier of specifiers(code(text))) {
        const target = resolve(file, specifier);
        if (target === null) {
          if (!ALLOWED_PACKAGES.has(specifier)) offenders.push(`${file}: pacchetto ${specifier}`);
        } else if (!target.startsWith("ink/") && !(file.startsWith("ink/dom/") && ALLOWED_OUTSIDE.has(target))) {
          offenders.push(`${file}: ${specifier}`);
        }
      }
    }
    expect(offenders, "moduli di src/ink/ che importano fuori dal confine").toEqual([]);
  });

  it("il nucleo non importa l'adattatore del browser", () => {
    const offenders = core.flatMap(({ file, text }) =>
      specifiers(code(text))
        .filter((specifier) => resolve(file, specifier)?.startsWith("ink/dom/"))
        .map((specifier) => `${file}: ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });

  it("il nucleo non usa globali del DOM: gira anche senza browser", () => {
    const dom = /\b(?:document|window|navigator|HTMLElement|PointerEvent|addEventListener|requestAnimationFrame)\b/;
    const offenders = core.filter(({ text }) => dom.test(code(text))).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("non porta con sé un prodotto né una modalità di prodotto", () => {
    const product = /pdf|fubdraw|@tauri-apps|@codemirror/i;
    const offenders = modules
      .filter(({ text }) => specifiers(code(text)).some((specifier) => product.test(specifier)))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
