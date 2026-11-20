// Gli scorrevoli che WebKitGTK ridipingeva a ogni passo restano un piano a sé.
//
// Su WebKitGTK 2.54 alcuni contenitori con `overflow: auto` non hanno lo
// scorrimento composto: a ogni passo la pagina ridipinge la parte visibile e
// lo scorrimento perde la frequenza dello schermo. `isolation: isolate` lo fa
// diventare un piano a sé senza cambiare l'aspetto. Chromium, dove girano i
// banchi, compone ogni scorrevole e non vede la differenza: questo presidio
// tiene la proprietà accanto all'`overflow` che la richiede, così una pelle
// riscritta o una regola spostata non la perde in silenzio. I numeri e il modo
// di misurare stanno in docs/architecture/desktop-webview.md, «Gli scorrevoli».
import { describe, expect, it } from "vitest";

import skin from "./skin.css?raw";
import structure from "./structure.css?raw";

/// Lo scorrevole, il file che dichiara il suo `overflow` e la misura che l'ha
/// messo qui (ridisegni in 5 s di scorrimento, prima e dopo).
const SCORREVOLI = [
  { selector: ".settings-scroll", file: "skin", css: skin, misura: "16 544 → 1 037" },
  { selector: "#sidebar", file: "structure", css: structure, misura: "albero 1 465 → 34, ricerca 563 → 52" },
] as const;

/// Il primo blocco di primo livello con quel selettore, commenti tolti: un
/// `isolation` citato in una spiegazione non conta.
function block(css: string, selector: string): string {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const closed = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = new RegExp(`^${closed}\\s*\\{([\\s\\S]*?)\\n\\}`, "m").exec(plain);
  if (!found) throw new Error(`«${selector}» non è un blocco del file`);
  return found[1]!;
}

describe("gli scorrevoli composti da WebKitGTK", () => {
  for (const { selector, file, css, misura } of SCORREVOLI) {
    it(`${selector} (${file}) scorre ed è un piano a sé (${misura})`, () => {
      const body = block(css, selector);
      expect(body).toMatch(/\boverflow(-y)?\s*:\s*[^;]*\bauto\b/);
      expect(body).toMatch(/\bisolation\s*:\s*isolate\s*;/);
    });
  }
});
