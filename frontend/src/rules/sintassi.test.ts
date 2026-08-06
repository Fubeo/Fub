import { describe, expect, it } from "vitest";
import {
  delimitatoriInline,
  marcatoreSuccessivo,
  parseWikilinkInner,
  recintiDichiarati,
  tagInCorso,
  tratti,
  voceDiLista,
  wikilink,
} from "./sintassi";
import { SINTASSI_MARKDOWN } from "./sintassi.generated";

// I casi di questo file sono, per metà, le **divergenze misurate** dalla §4.4:
// righe su cui i tre moduli della shell rispondevano tre cose diverse, o su cui
// la shell rispondeva diverso dal modello. Non sono esempi: sono i punti in cui
// si vedeva il difetto, e vanno letti come tali.

describe("la dichiarazione, interpretata", () => {
  it("`==` non è scritto nella shell: viene dal trigger di HighlightRule", () => {
    expect(delimitatoriInline()).toEqual([
      { nome: "fub:highlight", open: "==", close: "==" },
    ]);
    // E la prova che è *generato* e non copiato: cambiando la dichiarazione
    // cambia il risultato, senza toccare una riga di questo modulo.
    expect(
      delimitatoriInline([{ name: "terzi:spoiler", trigger: { inline: { open: "||", close: "||" } } }]),
    ).toEqual([{ nome: "terzi:spoiler", open: "||", close: "||" }]);
  });

  it("i recinti dichiarati sono quelli delle regole, non un elenco di qua", () => {
    expect(recintiDichiarati()).toContain("mermaid");
    expect(recintiDichiarati()).toContain("math");
  });

  it("una sintassi senza trigger non produce niente da interpretare", () => {
    // È il confine che il tipo dichiara: `fub:wikilinks` è una grammatica del
    // provider, e chi decora se la riscrive. Se un giorno guadagnasse un
    // trigger, comparirebbe qui — ed è il segnale che la regex si può togliere.
    const nomi = SINTASSI_MARKDOWN.filter((f) => f.trigger === null).map((f) => f.name);
    expect(nomi).toContain("fub:wikilinks");
    expect(delimitatoriInline().map((d) => d.nome)).not.toContain("fub:wikilinks");
  });
});

describe("i tratti fra delimitatori", () => {
  const t = (riga: string) => tratti(riga).map((x) => [x.from, x.to, x.contenutoDa, x.contenutoA]);

  it("due tratti sulla stessa riga sono due", () => {
    expect(t("==a== e ==b==")).toEqual([
      [0, 5, 2, 3],
      [8, 13, 10, 11],
    ]);
  });

  it("un contenuto vuoto non è un tratto, e non mangia quello vero", () => {
    expect(t("====")).toEqual([]);
    expect(t("====testo====")).toEqual([[2, 11, 4, 9]]);
  });

  it("un delimitatore non chiuso non aggancia niente", () => {
    expect(t("==aperto e basta")).toEqual([]);
  });
});

describe("i wikilink", () => {
  it("il punto che il link nomina non si butta via", () => {
    expect(parseWikilinkInner("Nota#Sezione^blocco|Alias")).toEqual({
      page: "Nota",
      heading: "Sezione",
      block: "blocco",
      alias: "Alias",
    });
    expect(parseWikilinkInner("#SoloSezione")).toEqual({
      page: "",
      heading: "SoloSezione",
      block: null,
      alias: null,
    });
    expect(parseWikilinkInner("Nota")).toEqual({
      page: "Nota",
      heading: null,
      block: null,
      alias: null,
    });
  });

  it("il bersaglio è ciò che sta scritto, senza ri-serializzarlo", () => {
    const [w] = wikilink("vedi [[ Nota#Sez ^b |Alias]] qui");
    expect(w.bersaglio).toBe(" Nota#Sez ^b ");
    expect(w.page).toBe("Nota");
    expect(w.alias).toBe("Alias");
  });

  it("l'embed porta il `!` dentro il match e non dentro il bersaglio", () => {
    const [w] = wikilink("![[Foto]]");
    expect([w.embed, w.from, w.to, w.internoDa, w.internoA, w.bersaglio]).toEqual([
      true,
      0,
      9,
      3,
      7,
      "Foto",
    ]);
  });
});

describe("il tag che si sta scrivendo", () => {
  it("segue la regola del contratto, non una più stretta", () => {
    // Le tre righe su cui `completions.ts` e `livepreview.ts` rispondevano
    // diverso, e su cui una delle due rispondeva diverso dal modello.
    expect(tagInCorso("vedi.#ta")).toEqual({ from: 5, query: "ta" });
    expect(tagInCorso("_#ta")).toEqual({ from: 1, query: "ta" });
    expect(tagInCorso("##do")).toEqual({ from: 1, query: "do" });
    expect(tagInCorso("a#b")).toBeNull();
  });

  it("un `#` nudo è un tag che comincia, non un tag", () => {
    expect(tagInCorso("prima #")).toEqual({ from: 6, query: "" });
    expect(tagInCorso("nessun cancelletto")).toBeNull();
  });

  it("non attraversa un a capo", () => {
    expect(tagInCorso("#tag\naltro")).toBeNull();
  });
});

describe("la voce di lista", () => {
  it("riconosce i tipi e dove finisce il marcatore", () => {
    expect(voceDiLista("  - [x] fatto")).toMatchObject({
      indent: "  ",
      kind: "bullet",
      symbol: "x",
      markerEnd: 8,
      content: "fatto",
    });
    expect(voceDiLista("3) voce")).toMatchObject({ kind: "ordered", number: 3, bullet: ")" });
    expect(voceDiLista("> citazione")).toMatchObject({ kind: "quote", content: "citazione" });
    expect(voceDiLista("testo - non lista")).toBeNull();
    expect(voceDiLista("-niente spazio")).toBeNull();
  });

  // ── Le due divergenze misurate fra live preview e comandi ──────────────────

  it("una todo dentro una citazione È una todo", () => {
    const v = voceDiLista("> - [ ] x");
    expect(v).toMatchObject({ quote: "> ", kind: "bullet", symbol: " ", content: "x" });
    // Ed è la riga che prima leggeva `kind: "quote"`, quindi `Mod-Enter` non la
    // spuntava mentre la live preview le disegnava una casella.
    expect(v!.kind).not.toBe("quote");
  });

  it("due spazi dopo il pallino sono ancora una todo", () => {
    expect(voceDiLista("-  [ ] x")).toMatchObject({ kind: "bullet", symbol: " " });
  });

  it("uno stato personalizzato è una casella, non testo", () => {
    // `relaxed_tasklist_matching` è acceso di là: `[/]` è una task nel modello.
    // La shell accettava solo `[ xX]`, quindi `taskChecked` — che esiste apposta
    // per gli stati personalizzati — non poteva riceverne nemmeno uno.
    expect(voceDiLista("- [/] in corso")).toMatchObject({ symbol: "/", content: "in corso" });
    expect(voceDiLista("- [>] rimandata")).toMatchObject({ symbol: ">" });
  });

  it("la casella si trova per posizione, non contando all'indietro", () => {
    const v = voceDiLista("- [x] fatto")!;
    expect([v.boxFrom, v.boxTo]).toEqual([2, 5]);
    // A fine riga non c'è lo spazio dopo `]`: contare quattro caratteri
    // all'indietro dal marcatore avrebbe indicato il posto sbagliato.
    const nudo = voceDiLista("- [x]")!;
    expect([nudo.boxFrom, nudo.boxTo, nudo.content]).toEqual([2, 5, ""]);
  });

  it("continuare una citazione annidata la lascia annidata", () => {
    expect(marcatoreSuccessivo(voceDiLista("> > citata")!)).toBe("> > ");
  });

  it("continuare una todo la fa nascere non spuntata", () => {
    expect(marcatoreSuccessivo(voceDiLista("  - [x] fatto")!)).toBe("  - [ ] ");
    expect(marcatoreSuccessivo(voceDiLista("> 3. [ ] x")!)).toBe("> 4. [ ] ");
  });
});
