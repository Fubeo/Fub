// Il vault del banco: **fisso**, e fisso è una decisione.
//
// Un banco visivo confronta due immagini, quindi tutto ciò che entra nella
// prima deve entrare identico nella seconda. Il corpus è la prima delle sei
// cose che il §31.1 dichiara stabili (le altre cinque le tiene il fotografo:
// caratteri attesi, ora congelata, moto ridotto, soglia del diff, baseline solo
// Linux) — e sta qui, versionato, invece di essere una cartella su disco che
// qualcuno popola: una nota in più aggiunta per provare una cosa sposta ogni
// baseline di ogni scena, e va vista nel diff del commit come si vede il resto.
//
// **Copre per costruzione, non per campione.** Ogni costrutto che il renderer
// del kernel sa emettere compare almeno una volta in `Guida/Sintassi di Fub.md`,
// e la resa che il banco serve (`RESA`) è scritto nelle forme esatte di
// `crates/fub-format-markdown/src/render.rs` — `<li class="task">` con la
// casella disabilitata, `<div class="callout" data-callout="…">`, `<a
// class="wikilink" data-wikilink-page="…" href="#">`, `<span class="tag"
// data-tag="…">`. Se quel file cambia forma, questa smette di essere la resa
// vera: è il limite del banco, ed è dichiarato qui perché nessuno lo deduca.
//
// La nota lunga si **genera** invece di stare scritto: diecimila parole
// versionate sarebbero mezzo megabyte di prosa finta nel repo, e ciò che serve
// al banco non è quel testo — è che ce ne sia tanto e che sia sempre lo stesso.
// Il generatore è deterministico e non usa `Math.random`.

/// I file del vault: path → sorgente. Le cartelle si deducono dai path, come
/// sul disco e come nell'host finto.
export const CORPUS: Record<string, string> = {
  "Benvenuto.md": [
    "# Benvenuto in Fub",
    "",
    "Questa è la nota che il banco apre per prima. Serve a fotografare lo stato",
    "normale: un titolo, due paragrafi di prosa, un elenco e un paio di",
    "riferimenti — cioè quello che si vede il novantanove per cento del tempo.",
    "",
    "La sintassi per intero sta in [[Sintassi di Fub]], i colori dei linguaggi",
    "in [[Frammenti di codice]]. #tema #banco",
    "",
    "- Un elenco corto",
    "- con tre voci",
    "- e nient'altro dentro",
    "",
    "> Ciò che non si guarda non si migliora.",
  ].join("\n"),

  "Guida/Sintassi di Fub.md": [
    "# Sintassi di Fub",
    "",
    "## Titoli",
    "",
    "### Terzo livello",
    "",
    "#### Quarto livello",
    "",
    "##### Quinto livello",
    "",
    "###### Sesto livello",
    "",
    "## Testo",
    "",
    "Prosa normale, con **grassetto**, *corsivo*, ~~barrato~~, `codice in riga`,",
    "==evidenziato==, un^apice^ e una nota a piè di pagina[^1].",
    "",
    "[^1]: E questa è la nota.",
    "",
    "## Riferimenti",
    "",
    "Un wikilink risolto: [[Benvenuto]]. Uno con alias: [[Frammenti di codice|i",
    "frammenti]]. Un tag: #sintassi. Un link esterno:",
    "[la specifica](https://commonmark.org).",
    "",
    "## Elenchi",
    "",
    "1. Primo",
    "2. Secondo",
    "3. Terzo",
    "",
    "- [ ] Da fare",
    "- [x] Fatto",
    "",
    "## Citazione",
    "",
    "> Un paragrafo citato, che va a capo",
    "> e continua sulla riga dopo.",
    "",
    "## Callout",
    "",
    "> [!note] Una nota",
    "> Il corpo del callout.",
    "",
    "> [!warning] Un avvertimento",
    "> Il corpo del secondo.",
    "",
    "## Tabella",
    "",
    "| Strato | Di chi è | Si sostituisce |",
    "| --- | :---: | ---: |",
    "| struttura | della scocca | no |",
    "| foglio | del tema | sì |",
    "| pelle | del tema | sì |",
    "",
    "## Codice",
    "",
    "```rust",
    "pub fn contrasto(a: &str, b: &str) -> f64 {",
    "    let (x, y) = (luminanza(a), luminanza(b));",
    "    (x.max(y) + 0.05) / (x.min(y) + 0.05)",
    "}",
    "```",
    "",
    "---",
    "",
    "E una riga dopo la linea.",
  ].join("\n"),

  "Guida/Frammenti di codice.md": [
    "# Frammenti di codice",
    "",
    "I dieci colori della tavolozza di sintassi, uno per volta.",
    "",
    "```typescript",
    'import { monta } from "./loader";',
    "",
    "/// Monta uno strato a sostituzione.",
    'export function applica(testo: string, strato: "foglio" | "pelle"): void {',
    "  const n = 1024;",
    "  monta(testo, strato);",
    "  if (!testo) throw new Error(`lo strato ${strato} è vuoto`);",
    "}",
    "```",
    "",
    "```css",
    ":root {",
    "  --accent: #6ea8fe;",
    "  --text: #e6e6e6;",
    "}",
    "```",
  ].join("\n"),

  "Diario/2026-08-19.md": [
    "# 19 agosto",
    "",
    "Il banco vede. Le scene sono diciotto e le luci due.",
    "",
    "- [x] Il secondo ingresso",
    "- [ ] I caratteri",
  ].join("\n"),

  "Diario/2026-08-18.md": [
    "# 18 agosto",
    "",
    "Contati i token: ottantatré per foglio, gemelli.",
  ].join("\n"),

  "Progetti/Il banco che vede.md": [
    "# Il banco che vede",
    "",
    "La voce [[31.1]] della seduta trentuno. Vedi anche [[Sintassi di Fub]] e una",
    "nota che non esiste: [[Questa non c'è]].",
    "",
    "#seduta-31",
  ].join("\n"),

  "Progetti/Archivio/Prima idea.md": [
    "# Prima idea",
    "",
    "Archiviata. Serve al banco per avere una cartella a due livelli.",
  ].join("\n"),

  // Un file che **non** è un documento: l'host finto decide la specie
  // dall'estensione, come il §14.1 dice che si decide, e l'esploratore deve
  // saperlo disegnare accanto alle note.
  "Risorse/schema.png": "(byte di un'immagine finta)",
};

// ---------------------------------------------------------------------------
// La nota lunga, generata.
// ---------------------------------------------------------------------------

/// Un generatore deterministico a 32 bit (xorshift). **Non** `Math.random`: due
/// corse dello stesso banco devono produrre lo stesso testo, o il diff fra una
/// foto e la sua baseline non misura più il CSS.
function seed(s: number): () => number {
  let x = s >>> 0;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x100000000;
  };
}

const WORDS = [
  "foglio", "pelle", "struttura", "banco", "scena", "luce", "token", "contrasto",
  "soglia", "baseline", "corpus", "moto", "gradino", "ombra", "velo", "fondo",
  "inchiostro", "misura", "cancello", "presidio", "verbale", "seduta", "voce",
  "riquadro", "cornice", "margine", "ritmo", "scala", "carattere", "riga",
];

/// Diecimila parole in paragrafi da quaranta. Il numero non è tondo per vezzo:
/// è l'ordine di grandezza di una nota vera che qualcuno abbia scritto per un
/// anno, cioè il caso in cui una misura di larghezza sbagliata si vede e una
/// nota di prova da dieci righe non la mostrerebbe mai.
function longNote(): string {
  const rnd = seed(31_1);
  const rows: string[] = ["# Una nota lunga", ""];
  let words = 0;
  let section = 1;
  while (words < 10_000) {
    if (words > 0 && words % 1_000 < 40) {
      rows.push(`## Sezione ${section}`, "");
      section += 1;
    }
    const n = 40;
    const p: string[] = [];
    for (let i = 0; i < n; i += 1) p.push(WORDS[Math.floor(rnd() * WORDS.length)]!);
    p[0] = p[0]!.charAt(0).toUpperCase() + p[0]!.slice(1);
    rows.push(`${p.join(" ")}.`, "");
    words += n;
  }
  return rows.join("\n");
}

CORPUS["Guida/Nota lunga.md"] = longNote();

// ---------------------------------------------------------------------------
// La resa: l'HTML che il kernel emetterebbe.
// ---------------------------------------------------------------------------

/// Ciò che `render_preview` risponde, per i documenti che una scena legge in
/// modalità Lettura. Chi non è qui dentro si rende come paragrafo unico —
/// l'host finto sa già farlo, ed è la risposta onesta per una nota che nessuna
/// scena fotografa resa.
export const OUTPUT: Record<string, string> = {
  "Benvenuto.md": [
    "<h1>Benvenuto in Fub</h1>",
    "<p>Questa è la nota che il banco apre per prima. Serve a fotografare lo",
    "stato normale: un titolo, due paragrafi di prosa, un elenco e un paio di",
    "riferimenti — cioè quello che si vede il novantanove per cento del tempo.</p>",
    '<p>La sintassi per intero sta in <a class="wikilink" data-wikilink-page="Sintassi di Fub" href="#">Sintassi di Fub</a>,',
    'i colori dei linguaggi in <a class="wikilink" data-wikilink-page="Frammenti di codice" href="#">Frammenti di codice</a>.',
    '<span class="tag" data-tag="tema">#tema</span> <span class="tag" data-tag="banco">#banco</span></p>',
    "<ul><li>Un elenco corto</li><li>con tre voci</li><li>e nient'altro dentro</li></ul>",
    "<blockquote><p>Ciò che non si guarda non si migliora.</p></blockquote>",
  ].join("\n"),

  "Guida/Sintassi di Fub.md": [
    "<h1>Sintassi di Fub</h1>",
    "<h2>Titoli</h2>",
    "<h3>Terzo livello</h3>",
    "<h4>Quarto livello</h4>",
    "<h5>Quinto livello</h5>",
    "<h6>Sesto livello</h6>",
    "<h2>Testo</h2>",
    "<p>Prosa normale, con <strong>grassetto</strong>, <em>corsivo</em>,",
    "<del>barrato</del>, <code>codice in riga</code>,",
    '<span class="inline-highlight">evidenziato</span>, un<sup>apice</sup> e una',
    'nota a piè di pagina<sup class="footnote-ref" data-label="1">1</sup>.</p>',
    "<h2>Riferimenti</h2>",
    '<p>Un wikilink risolto: <a class="wikilink" data-wikilink-page="Benvenuto" href="#">Benvenuto</a>.',
    'Uno con alias: <a class="wikilink" data-wikilink-page="Frammenti di codice" href="#">i frammenti</a>.',
    'Un tag: <span class="tag" data-tag="sintassi">#sintassi</span>. Un link esterno:',
    '<a href="https://commonmark.org">la specifica</a>.</p>',
    "<h2>Elenchi</h2>",
    "<ol><li>Primo</li><li>Secondo</li><li>Terzo</li></ol>",
    '<ul><li class="task" data-task=" "><input type="checkbox" disabled>Da fare</li>',
    '<li class="task" data-task="x"><input type="checkbox" disabled checked>Fatto</li></ul>',
    "<h2>Citazione</h2>",
    "<blockquote><p>Un paragrafo citato, che va a capo e continua sulla riga dopo.</p></blockquote>",
    "<h2>Callout</h2>",
    '<div class="callout" data-callout="note"><div class="callout-title">Una nota</div>',
    "<p>Il corpo del callout.</p></div>",
    '<div class="callout" data-callout="warning"><div class="callout-title">Un avvertimento</div>',
    "<p>Il corpo del secondo.</p></div>",
    "<h2>Tabella</h2>",
    "<table><thead><tr><th>Strato</th><th>Di chi è</th><th>Si sostituisce</th></tr></thead>",
    '<tbody><tr><td style="text-align:left">struttura</td><td style="text-align:center">della scocca</td><td style="text-align:right">no</td></tr>',
    '<tr><td style="text-align:left">foglio</td><td style="text-align:center">del tema</td><td style="text-align:right">sì</td></tr>',
    '<tr><td style="text-align:left">pelle</td><td style="text-align:center">del tema</td><td style="text-align:right">sì</td></tr></tbody></table>',
    "<h2>Codice</h2>",
    '<pre><code class="language-rust">pub fn contrasto(a: &amp;str, b: &amp;str) -&gt; f64 {',
    "    let (x, y) = (luminanza(a), luminanza(b));",
    "    (x.max(y) + 0.05) / (x.min(y) + 0.05)",
    "}",
    "</code></pre>",
    "<hr>",
    "<p>E una riga dopo la linea.</p>",
  ].join("\n"),
};
