// @vitest-environment happy-dom
//
// **I due spazi di nomi** (§5.3): la shell e il contenuto di una nota vivono
// nello stesso documento, e `id` è globale. Qui si prova la cosa nei **due
// versi**, perché il difetto e la sua riparazione sbagliata hanno la stessa
// faccia da un lato solo:
//
//   1. una nota non ruba un elemento della shell;
//   2. l'ancora di blocco **funziona ancora** — il legame interno arriva dove
//      deve.
//
// La seconda è quella che si dimentica, ed è quella che rompe l'utente: un
// prefisso messo solo sugli `id` spegne ogni `[testo](#sezione)` di ogni nota,
// e nessuno dei test del primo verso se ne accorgerebbe.
//
// Il cammino sul DOM si prova qui e non in `sanitize.test.ts` perché
// l'ambiente è **per file**: quel file gira senza DOM ed è la politica pura.
import { describe, expect, it } from "vitest";

import html from "../../index.html?raw";
import { inContentSpace, sanitizeFragment } from "./sanitize";

function mountHtml(htmlContent: string): HTMLElement {
  const where = document.createElement("div");
  document.body.appendChild(where);
  where.appendChild(sanitizeFragment(htmlContent));
  return where;
}

describe("l'id del contenuto non è l'id della shell", () => {
  it("una nota che porta il nome di un elemento della shell non se lo prende", () => {
    // L'ordine è quello **cattivo** di proposito: il contenuto entra per primo,
    // quindi in ordine di documento viene prima della barra di stato. Se il
    // nome fosse lo stesso, `getElementById` — che restituisce il primo —
    // darebbe il paragrafo della nota. Con l'ordine inverso questo presidio
    // passerebbe anche senza riparazione, e sarebbe un presidio finto.
    mountHtml('<p id="save-state">quello che la nota vorrebbe essere</p>');
    const actualElement = document.createElement("div");
    actualElement.id = "save-state";
    document.body.appendChild(actualElement);

    expect(document.getElementById("save-state")).toBe(actualElement);
  });

  it("vale per ogni nome, non per quello che avevamo in mente", () => {
    for (const name of ["context-menu", "toast", "activity-panel", "key-pending", "albero-1"]) {
      const where = mountHtml(`<div id="${name}">x</div>`);
      const el = where.firstElementChild!;
      expect(el.id).not.toBe(name);
      expect(el.id).toBe(inContentSpace(name));
    }
  });
});

describe("l'ancora di blocco funziona ancora", () => {
  it("un link interno atterra sul blocco che nomina", () => {
    // Da capo a fondo, con la regola del browser: il frammento dopo il `#` si
    // confronta con gli `id` della pagina. Se le due metà divergessero, qui non
    // ci sarebbe nessun elemento da trovare.
    const where = mountHtml('<p id="blocco-1">il paragrafo ancorato</p><a href="#blocco-1">vai</a>');
    const link = where.querySelector("a")!;
    const fragment = link.getAttribute("href")!.slice(1);
    const landing = document.getElementById(decodeURIComponent(fragment));

    expect(landing).not.toBeNull();
    expect(landing!.textContent).toBe("il paragrafo ancorato");
  });

  it("lo slug di un titolo è un'ancora come le altre", () => {
    const where = mountHtml('<h2 id="una-sezione">Una sezione</h2><a href="#una-sezione">su</a>');
    const fragment = where.querySelector("a")!.getAttribute("href")!.slice(1);
    expect(document.getElementById(fragment)!.tagName).toBe("H2");
  });

  it("il `#` nudo del segnaposto wikilink resta nudo", () => {
    // `href="#"` è ciò che il provider markdown emette sui wikilink, con la
    // navigazione presa dai `data-*`: prefissarlo lo farebbe puntare a un
    // blocco inesistente, e il click salterebbe in cima alla pagina.
    const where = mountHtml('<a class="wikilink" data-wikilink-page="Nota" href="#">Nota</a>');
    expect(where.querySelector("a")!.getAttribute("href")).toBe("#");
  });
});

// # Il conto
//
// I due presidi qui sopra provano il **comportamento**; questo prova che la
// premessa su cui poggiano è ancora vera — che nessun nome della shell viva
// sotto il prefisso del contenuto. È un conto e non un test di comportamento
// perché la domanda è su un **elenco**, ed è la divisione della 0110.
//
// La lista non è scritto a mano: si legge `index.html` e ogni modulo della
// shell, e si tirano fuori i nomi da tutte le forme in cui la shell ne
// pronuncia uno. Un elenco scritto a mano invecchierebbe al primo pannello
// nuovo, ed è esattamente il modo in cui il difetto era nato: il campione
// diceva quattro nomi, e non era il censimento.
describe("il censimento dei nomi della shell", () => {
  const modules = import.meta.glob("../**/*.ts", { query: "?raw", import: "default", eager: true });

  function namesOfShell(): Set<string> {
    const names = new Set<string>();
    const add = (text: string, re: RegExp, suffix = ""): void => {
      for (const m of text.matchAll(re)) names.add(m[1] + suffix);
    };
    add(html, /\bid="([^"]+)"/g);
    for (const [path, source] of Object.entries(modules)) {
      if (path.endsWith(".test.ts")) continue;
      const s = source as string;
      add(s, /getElementById\("([^"]+)"\)/g);
      add(s, /querySelector(?:All)?(?:<[^>]*>)?\("#([A-Za-z0-9_-]+)/g);
      add(s, /\.id = "([^"]+)"/g);
      add(s, /_ID = "([^"]+)"/g);
      // Le famiglie generate: `identificatore("albero")` dà `albero-1`,
      // `albero-2`, … e sono nomi della shell quanto gli altri.
      add(s, /\bidentificatore\("([^"]+)"\)/g, "-1");
    }
    return names;
  }

  it("nessun nome della shell vive nello spazio del contenuto", () => {
    const names = namesOfShell();
    // Se il conto smettesse di trovare i nomi — un `?raw` che non risolve, una
    // forma nuova che le espressioni non vedono — passerebbe a vuoto, e un
    // presidio che non può fallire è peggio di nessun presidio.
    expect(names.size).toBeGreaterThan(50);
    const inside = [...names].filter((n) => n.startsWith(inContentSpace("")));
    expect(inside, "un nome della shell è finito sotto il prefisso del contenuto").toEqual([]);
  });
});
