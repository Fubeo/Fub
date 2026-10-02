// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./render";

function content(source: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderMarkdown(source).html;
  return root;
}

describe("contenuto Markdown reso", () => {
  it("mostra una task una sola volta, conservando le voci annidate", () => {
    const root = content("- [ ] Da fare\n  - dettaglio\n- [x] Fatto\n");
    expect(Array.from(root.querySelectorAll("li.task"), (item) => item.textContent)).toEqual(["Da faredettaglio", "Fatto"]);
    expect(Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'), (box) => box.checked)).toEqual([false, true]);
  });

  it("legge come paragrafo, con la sua casella, un `[ ]` che non apre la voce", () => {
    const root = content("- [ ] a\n\n  [x] *b* ^id\n\n  [ ] $$x$$\n- c\n\n  [ ] d\n- [ ] $$y$$\n");
    const items = Array.from(root.querySelector("ul")!.children);
    expect(items.map((item) => item.querySelectorAll('input[type="checkbox"]').length)).toEqual([1, 0, 1]);
    expect(Array.from(items[0]!.querySelectorAll("p"), (p) => p.textContent)).toEqual(["[x] b", "[ ] x"]);
    expect(items[0]!.querySelector("p")?.id).toBe("id");
    expect(items[0]!.querySelector("p em")?.textContent).toBe("b");
    expect(items[0]!.querySelector("p .math-inline")?.getAttribute("data-tex")).toBe("x");
    expect(items[0]!.querySelector(".math-block")).toBeNull();
    expect(Array.from(items[1]!.querySelectorAll("p"), (p) => p.textContent)).toEqual(["c", "[ ] d"]);
    expect(items[2]!.querySelector(".math-block")?.getAttribute("data-tex")).toBe("y");
  });

  it("legge il corpo di una nota di una parola sola, con le righe che lo seguono", () => {
    const root = content("a[^1] b[^2] c[^3]\n\n[^1]: **b**\n\n[^2]: [[Nota]]\nseguito #tag\n\n[^3]: $x$\n---\n");
    const notes = Array.from(root.querySelectorAll(".block-footnote-definition"));
    expect(notes.map((note) => note.id)).toEqual(["fn-1", "fn-2", "fn-3"]);
    expect(notes[0]!.querySelector("strong")?.textContent).toBe("b");
    expect(notes[1]!.querySelector("a.wikilink")?.getAttribute("data-wikilink-page")).toBe("Nota");
    expect(notes[1]!.querySelector(".tag")?.getAttribute("data-tag")).toBe("tag");
    expect(notes[2]!.querySelector(".math-inline")?.getAttribute("data-tex")).toBe("x");
    // La riga dopo una definizione resta nella nota; i trattini no.
    expect(root.querySelectorAll(":scope > p")).toHaveLength(1);
    expect(root.querySelector(":scope > hr")).not.toBeNull();
  });

  it("riconosce una definizione di nota con la regola di comrak", () => {
    const root = content("a[^a] b[^b c] [^]\n\n[^a]:x\n\n[^b c]: y\n\n[^]: z\n\n> [^]: w\n");
    expect(Array.from(root.querySelectorAll(".block-footnote-definition"), (note) => note.textContent?.trim())).toEqual(["1. x ↩"]);
    // Le altre due sono indirizzi: non si vedono, e il richiamo con lo spazio
    // è un link che le usa.
    expect(root.textContent).not.toMatch(/[zw]/);
    expect(root.querySelector("blockquote")?.innerHTML).toBe("");
    expect(root.querySelector("a.internal-path")?.getAttribute("href")).toBe("y");
  });

  it("rimuove i marcatori di citazione senza spezzare l'enfasi multilinea", () => {
    const root = content("> **prima\n> seconda**\n");
    expect(root.querySelector("blockquote")?.textContent?.replace(/\s+/g, " ").trim()).toBe("prima seconda");
    expect(root.querySelector("blockquote strong")?.textContent?.replace(/\s+/g, " ").trim()).toBe("prima seconda");
  });

  it("riconosce gli embed senza attivarli dentro il codice", () => {
    const root = content("![[Nota]]\n\n`![[Nota]]`");
    expect(root.querySelectorAll(".embed")).toHaveLength(1);
    expect(root.querySelector(".embed")?.getAttribute("data-embed-page")).toBe("Nota");
    expect(root.querySelector("code")?.textContent).toBe("![[Nota]]");
  });

  it("espone formule inline e a blocco allo stesso idratatore", () => {
    const root = content("Prima $x^2 + y$ dopo\n\n$$\n\\\\frac{a}{b}\n$$\n\n`$non-matematica$`");
    const inline = root.querySelector<HTMLElement>(".math-inline");
    const block = root.querySelector<HTMLElement>(".math-block");
    expect(inline?.dataset.tex).toBe("x^2 + y");
    expect(inline?.textContent).toBe("x^2 + y");
    expect(block?.dataset.tex).toBe("\\\\frac{a}{b}");
    expect(block?.textContent).toBe("\\\\frac{a}{b}");
    expect(root.querySelector("code")?.textContent).toBe("$non-matematica$");
  });

  it("legge le formule per paragrafo, con la regola del provider", () => {
    // `$x$2` non chiude, una formula va a capo anche citata, e `$$…$$` in mezzo
    // al testo resta in riga: le tre forme su cui shell e stampa divergevano.
    const root = content("vale $x$2 e $a\nb$\n\n> cita $c\n> d$\n\ndopo $$e$$ qui\n");
    expect(Array.from(root.querySelectorAll<HTMLElement>(".math-inline"), (math) => math.dataset.tex)).toEqual(["a b", "c d", "e"]);
    expect(root.querySelector(".math-block")).toBeNull();
    expect(root.querySelector("blockquote")?.textContent).toBe("cita c d");
  });

  it("una formula che attraversa un'enfasi la scioglie, e il TeX con escape resta intero", () => {
    const root = content("*a $b* c$ e $\\{x\\}$\n");
    expect(root.querySelector("em")).toBeNull();
    expect(root.querySelector("p")?.textContent).toBe("*a b* c e \\{x\\}");
    expect(Array.from(root.querySelectorAll<HTMLElement>(".math-inline"), (math) => math.dataset.tex)).toEqual(["b* c", "\\{x\\}"]);
  });

  it("legge le formule in un titolo di ogni forma", () => {
    const sources = [1, 2, 3, 4, 5, 6].map((level) => `${"#".repeat(level)} t $x$`);
    for (const source of [...sources, "t $x$\n===", "t $x$\n---"]) {
      expect(content(source).querySelector(".math-inline")?.getAttribute("data-tex"), source).toBe("x");
    }
  });

  it("un'enfasi che contiene una formula resta un'enfasi", () => {
    const root = content("*a $x$ b*\n");
    expect(root.querySelector("em .math-inline")?.getAttribute("data-tex")).toBe("x");
  });

  it("un paragrafo fatto di una sola formula `$$` è un blocco anche citato, in una voce con casella o con un ID", () => {
    const root = content("> $$x$$\n\n- [ ] $$y$$\n\n$$z$$ ^abc\n\n$$a$$ b $$c$$\n");
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(".math-block"));
    expect(blocks.map((block) => [block.dataset.tex, block.id])).toEqual([["x", ""], ["y", ""], ["z", "abc"]]);
    expect(blocks[0]?.closest("blockquote")).not.toBeNull();
    expect(blocks[1]?.closest("li.task")).not.toBeNull();
    expect(Array.from(root.querySelectorAll<HTMLElement>(".math-inline"), (math) => math.dataset.tex)).toEqual(["a", "c"]);
  });

  it("lascia letterali dollari escapati e formule incomplete", () => {
    const root = content(String.raw`Costo \$5 e formula $incompleta`);
    expect(root.querySelector(".math-inline")).toBeNull();
    expect(root.textContent).toBe("Costo $5 e formula $incompleta");
  });

  it("rende la nota inline sul proprio span e conserva la formattazione senza HTML attivo", () => {
    const source = "Été ^[nota **forte** & <script>alert(1)</script>] fine";
    const root = content(source);
    const note = root.querySelector<HTMLElement>("sup.footnote-inline");
    expect(note?.getAttribute("data-md-from")).toBe(String(source.indexOf("^[")));
    expect(note?.getAttribute("data-md-to")).toBe(String(source.indexOf("] fine") + 1));
    expect(note?.querySelector("strong")?.textContent).toBe("forte");
    expect(note?.querySelector("script")).toBeNull();
    expect(note?.textContent).toContain("alert(1)");
  });

  it("non interpreta note inline escapate, nel codice o in HTML a blocco", () => {
    const root = content("Normale ^[sì] ed \\^[escape] e `^[code]`\n\n<div>\n^[html]\n</div>\n");
    expect(Array.from(root.querySelectorAll("sup.footnote-inline"), (node) => node.textContent)).toEqual(["sì"]);
    expect(root.querySelector("code")?.textContent).toBe("^[code]");
  });

  it("nasconde un commento senza toccare il resto della riga", () => {
    const root = content("Prima %%segreto%% dopo ==sì==");
    expect(root.textContent).toBe("Prima  dopo sì");
    expect(root.querySelector("mark")?.textContent).toBe("sì");
  });

  it("evidenziato e commento stanno in un testo del modello, come nel provider", () => {
    // Un wikilink o un tag spezzano il testo, e un evidenziato si legge prima
    // di un commento: di questo commento non resta niente.
    const root = content("Prima %%segreto [[Altra]] #tag ==no==%% dopo ==sì==");
    expect(root.textContent).toBe("Prima %%segreto Altra #tag no%% dopo sì");
    expect(root.querySelector(".wikilink")?.textContent).toBe("Altra");
    expect(root.querySelector(".tag")?.textContent).toBe("#tag");
    expect(Array.from(root.querySelectorAll("mark"), (mark) => mark.textContent)).toEqual(["no", "sì"]);
  });

  it("evidenziato, commento e nota in riga non attraversano un inline del provider", () => {
    // Il primo paragrafo, scritto in chiaro: `=(…)=` un evidenziato, `^(…)` una
    // nota in riga, `*…*` un'enfasi, `[…]` un link, `[[…]]` un wikilink e
    // `$…$` una formula. Un commento sparisce.
    const write = (node: Node): string => {
      if (!(node instanceof HTMLElement)) return node.textContent ?? "";
      const inner = Array.from(node.childNodes, write).join("");
      if (node.matches("mark")) return `=(${inner})=`;
      if (node.matches("sup.footnote-inline")) return `^(${inner})`;
      if (node.matches("em")) return `*${inner}*`;
      if (node.matches("strong")) return `**${inner}**`;
      if (node.matches(".math-inline")) return `$${node.dataset.tex}$`;
      if (node.matches("a.wikilink")) return `[[${inner}]]`;
      if (node.matches("a")) return `[${inner}]`;
      return inner;
    };
    // Ogni esito è quello dell'anteprima del provider con le regole di
    // `fub.blocks` innestate.
    for (const [source, expected] of [
      ["==a *b* c== z", "==a *b* c== z"],
      ["*a ==b* c== z", "*a ==b* c== z"],
      ["==a *b== c* z", "==a *b== c* z"],
      ["**a ==b c** d== z", "**a ==b c** d== z"],
      ["==a $b$ c== z", "==a $b$ c== z"],
      ["==a #b c== z", "==a #b c== z"],
      ["==a [l](u) c== z", "==a [l] c== z"],
      ["==a <b>x</b> c== z", "==a <b>x</b> c== z"],
      ["==a [^1] c== z\n\n[^1]: n", "==a [1] c== z"],
      ["==a [^no] c== z", "==a [^no] c== z"],
      ["%%a *b* c%% z", "%%a *b* c%% z"],
      ["*a %%b* c%% z", "*a %%b* c%% z"],
      ["%%a *b%% c* z", "%%a *b%% c* z"],
      ["%%a [[b]] c%% z", "%%a [[b]] c%% z"],
      ["[[a %%b]] c%% z", "[[a %%b]] c%% z"],
      ["%%a [[b%% c]] z", "%%a [[b%% c]] z"],
      ["%%a $b$ c%% z", "%%a $b$ c%% z"],
      ["%%a #b c%% z", "%%a #b c%% z"],
      ["^[a $b] c$ z", "^[a $b] c$ z"],
      ["^[a](u) z", "^[a] z"],
      ["==a ^[b== c] z", "==a ^(b== c) z"],
      ["^[a ==b] c== z", "^(a ==b) c== z"],
      ["%%a ^[b%% c] z", "%%a ^(b%% c) z"],
      ["^[a %%b] c%% z", "^(a %%b) c%% z"],
      // Escape, entità e URL nudi sono testo; ciò che sta in un'enfasi o in
      // un link ha il suo testo.
      ["==a \\* c== z", "=(a * c)= z"],
      ["==a &amp; c== z", "=(a & c)= z"],
      ["==a https://e.it c== z", "=(a https://e.it c)= z"],
      ["*a ==b== c* z", "*a =(b)= c* z"],
      ["[==a==](u) z", "[=(a)=] z"],
      ["*a* ^[b] z", "*a* ^(b) z"],
      // Ogni regola cerca in ogni testo, e l'evidenziato viene prima.
      ["==a *b* c== d== z", "==a *b* c=( d)= z"],
      ["==a\nb== c== z", "==a\nb=( c)= z"],
      ["==a %%b%% c== z", "=(a %%b%% c)= z"],
      ["%%a ==b== c%% z", "%%a =(b)= c%% z"],
      ["==a %%b== c%% z", "=(a %%b)= c%% z"],
      // Il dollaro che un wikilink ha preso non apre una formula.
      ["[[a$]] ==b$ c== z", "[[a$]] =(b$ c)= z"],
      // Anche dentro un'enfasi un inline spezza il testo, e un nodo che
      // attraversa una formula non c'è. Una nota che sta nel testo di
      // un'enfasi regge; una il cui `[` apre un link no.
      ["*a ==b `c` d== e* z", "*a ==b c d== e* z"],
      ["==a *b== $c* d$ z", "=(a *b)= $c* d$ z"],
      ["*a ^[b] c* z", "*a ^(b) c* z"],
      ["*a ==b ^[c] d== e* z", "*a ==b ^(c) d== e* z"],
      ["^[a] z\n\n[a]: u", "^[a] z"],
      // Anche un wikilink che non nomina niente è un nodo del provider.
      ["==a [[ ]] b== z", "==a [[ ]] b== z"],
      // Senza destinazione `[b]` è testo; una nota attraversata da una formula
      // non c'è, e i suoi delimitatori sono testo.
      ["==a [b] c== z", "=(a [b] c)= z"],
      ["==a ^[b== $c] d$ z", "=(a ^[b)= $c] d$ z"],
    ] as const) {
      expect(write(content(source).querySelector("p")!), source).toBe(expected);
    }
  });

  it("legge la dimensione di un embed e mostra il bersaglio, non il numero", () => {
    const root = content("![[foto.png|120]] e ![[schema.png|200x100]] e ![[Nota|alias]]");
    const embeds = Array.from(root.querySelectorAll<HTMLElement>(".embed"));
    expect(embeds.map((e) => [e.textContent, e.dataset.embedSize])).toEqual([
      ["foto.png", "120"],
      ["schema.png", "200x100"],
      ["alias", undefined],
    ]);
  });

  it("applica dimensioni esplicite alle immagini senza includerle nell'alt", () => {
    const root = content("![Schema|640x360](assets/schema.png)\n\n![Logo|128](logo.png)");
    const images = root.querySelectorAll("img");
    expect(images[0]?.getAttribute("alt")).toBe("Schema");
    expect(images[0]?.getAttribute("width")).toBe("640");
    expect(images[0]?.getAttribute("height")).toBe("360");
    expect(images[1]?.getAttribute("alt")).toBe("Logo");
    expect(images[1]?.getAttribute("width")).toBe("128");
    expect(images[1]?.hasAttribute("height")).toBe(false);
  });
});
